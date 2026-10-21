// lib/terminology.js — 专有名词词表：解析、归一、匹配（零依赖）。
//
// 这是满足"公司名/项目名/系统名/编号/专有名词都要替换"的核心模块。
//
// 词表行格式（每行一条，支持注释与分类标签）：
//   # 公司名称
//   某某科技有限公司          @company
//   Project Bluebird        @project
//   天枢计划                 @project
//   XX核心交易系统            @system
//   HT-2024-001             @id
//
// - `@category` 可省略，省略时用 TERM 标签。
// - 词条本身可以含空格（英文项目名），因此分类标签一律从"行尾"解析。
// - 匹配在"归一化检索文本"（NFKC + 小写）上进行；词条在编译期做同样归一。
// - 同一起点最长优先；同一词条在整段文本里复用同一个占位符（由确定性哈希保证）。

import { LIMITS, TERM_CATEGORIES, TERM_DEFAULT_LABEL } from './constants.js'

/** 与 engine 的检索文本保持一致的归一化。 */
export function normalizeForMatch(input) {
  const text = typeof input === 'string' ? input : String(input)
  return text.normalize('NFKC').toLowerCase()
}

/**
 * 解析一行词表。
 * @param {string} line 原始行。
 * @returns {{value: string, label: string, category: string|null}|null} 条目或 null。
 */
export function parseTermLine(line) {
  if (typeof line !== 'string') return null
  let text = line.trim()
  if (text === '' || text.startsWith('#') || text.startsWith('//')) return null
  // 行内注释：值里不允许出现 ` #`。
  const commentAt = text.indexOf(' #')
  if (commentAt !== -1) text = text.slice(0, commentAt).trim()
  if (text === '') return null

  let category = null
  const tagMatch = /\s+@([A-Za-z][A-Za-z0-9_-]{0,15})$/.exec(text)
  if (tagMatch !== null) {
    category = tagMatch[1].toLowerCase()
    text = text.slice(0, tagMatch.index).trim()
  }
  // 也允许 `value | @category` 与 `value @category` 两种分隔写法。
  const pipeAt = text.indexOf('|')
  if (pipeAt !== -1) {
    const tail = text.slice(pipeAt + 1).trim()
    const pipeTag = /^@?([A-Za-z][A-Za-z0-9_-]{0,15})$/.exec(tail)
    if (pipeTag !== null) {
      category = pipeTag[1].toLowerCase()
      text = text.slice(0, pipeAt).trim()
    }
  }
  if (text === '' || text.length > LIMITS.MAX_TERM_LENGTH) return null

  const label = labelForCategory(category)
  if (text.startsWith('re:')) return { value: text, label, category, regex: true }
  return { value: text, label, category }
}

/** 分类 → 占位符标签。 */
export function labelForCategory(category) {
  if (category === null || category === undefined || category === '') return TERM_DEFAULT_LABEL
  const mapped = TERM_CATEGORIES[category]
  if (mapped !== undefined) return mapped
  // 允许直接写占位符标签：@ORG / @proj 等。
  const upper = String(category).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (/^[A-Z][A-Z0-9]{0,15}$/.test(upper)) return upper
  return TERM_DEFAULT_LABEL
}

/**
 * 解析多行词表文本。
 * @param {string} text 词表全文。
 * @returns {Array<{value:string,label:string,category:string|null}>} 条目列表。
 */
export function parseTermText(text) {
  if (typeof text !== 'string' || text === '') return []
  const out = []
  for (const line of text.split(/\r?\n/u)) {
    const entry = parseTermLine(line)
    if (entry !== null) out.push(entry)
  }
  return out
}

/**
 * 编译词表：归一 + 去重 + 变长优先 + 首字符分桶。
 * 词表行以 `re:` 开头的是正则词条：保留原文、编译进 regexItems，不参与字面分桶。
 * @param {Array<{value:string,label?:string,category?:string|null}>} entries 原始条目。
 * @param {object} [options] 选项。
 * @param {Set<string>} [options.disabledLabels] 停用标签（大写）：命中的条目不参与编译。
 * @returns {{items: Array<object>, buckets: Map<string, Array<object>>, regexItems: Array<object>, count: number, skipped: number, version: string}} 编译结果。
 */
export function compileTerms(entries, options = {}) {
  const disabled = options.disabledLabels ?? null
  const seen = new Set()
  const items = []
  const regexItems = []
  let skipped = 0
  for (const entry of entries) {
    if (entry === null || entry === undefined) continue
    const raw = typeof entry === 'string' ? entry : entry.value
    if (typeof raw !== 'string') continue
    const isRegex = raw.startsWith('re:')
    const value = isRegex ? raw.slice(3).trim() : normalizeForMatch(raw).trim()
    if (value === '' || value.length > LIMITS.MAX_TERM_LENGTH) { skipped += 1; continue }
    const label = typeof entry === 'object' && entry.label !== undefined
      ? entry.label
      : labelForCategory(entry?.category ?? null)
    if (disabled !== null && disabled.has(String(label).toUpperCase())) continue
    if (isRegex) {
      if (regexItems.length >= LIMITS.MAX_REGEX_TERMS) { skipped += 1; continue }
      const key = `re:${value}`
      if (seen.has(key)) continue
      let source = null
      try {
        source = new RegExp(value, 'g')
      } catch {
        skipped += 1
        continue
      }
      seen.add(key)
      regexItems.push({ source, label, category: (typeof entry === 'object' ? entry.category : null) ?? null })
      continue
    }
    if (seen.has(value)) continue
    seen.add(value)
    items.push({ value, label, category: (typeof entry === 'object' ? entry.category : null) ?? null })
    if (items.length >= LIMITS.MAX_TERMS) break
  }
  // 变长优先：同一起点先试长词条。
  items.sort((a, b) => b.value.length - a.value.length)
  const buckets = new Map()
  for (const item of items) {
    const head = item.value[0]
    let bucket = buckets.get(head)
    if (bucket === undefined) {
      bucket = []
      buckets.set(head, bucket)
    }
    bucket.push(item)
  }
  return { items, buckets, regexItems, count: items.length + regexItems.length, skipped, version: String(items.length + regexItems.length) }
}

/**
 * 在检索文本里匹配词表（字面最长优先 + 正则项；各自不重叠，交给引擎统一消解）。
 * @param {string} scratch 归一化检索文本。
 * @param {{buckets: Map<string, Array<object>>, regexItems?: Array<object>}} compiled 编译结果。
 * @returns {Array<{entity:string,label:string,start:number,end:number,score:number}>} matches。
 */
export function detectTerms(scratch, compiled) {
  const out = []
  if (compiled === undefined || compiled === null) return out
  const buckets = compiled.buckets
  if (buckets !== undefined && buckets.size > 0) {
    let index = 0
    while (index < scratch.length) {
      const bucket = buckets.get(scratch[index])
      if (bucket === undefined) {
        index++
        continue
      }
      let matched = null
      for (const item of bucket) {
        if (scratch.startsWith(item.value, index)) {
          matched = item
          break
        }
      }
      if (matched === null) {
        index++
        continue
      }
      out.push({
        entity: 'term',
        label: matched.label,
        start: index,
        end: index + matched.value.length,
        score: 1,
        term: matched.value,
      })
      index += matched.value.length
    }
  }
  for (const item of compiled.regexItems ?? []) {
    item.source.lastIndex = 0
    for (const match of scratch.matchAll(item.source)) {
      const whole = match[0]
      if (whole === '') continue
      out.push({
        entity: 'term',
        label: item.label,
        start: match.index,
        end: match.index + whole.length,
        score: 0.9,
        term: whole,
      })
    }
  }
  return out
}
