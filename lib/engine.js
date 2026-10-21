// lib/engine.js — 脱敏引擎：归一化、检测、重叠消解、确定性占位符、还原（零依赖）。
//
// 设计要点（为什么这样做）：
// 1. 占位符是"值的确定性函数"：<LABEL_8位十六进制>，哈希覆盖 (label, 原文)。
//    这样占位符无需任何跨调用状态即可保持稳定 —— 同一原文在整段会话、fork 出来的
//    会话、重启后的重新派生中都是同一个占位符，也意味着提示词前缀缓存不会被搅乱。
//    （自增计数做不到这一点：消息投影可能在"日志尾部"被增量调用，计数会漂移。）
// 2. 所有检测器都在"归一化检索文本"（NFKC + 小写）上跑，命中范围再映射回原文，
//    这样全角数字/大小写不敏感等场景天然覆盖，而替换仍然精确落回原文位置。
// 3. 重叠消解：起点升序 → 置信度降序 → 长者优先；先到先得，其后被覆盖的丢弃。
// 4. 已存在的占位符区域会被"中和"，避免二次脱敏把 <ORG_ab12cd34> 内部当成新实体。

import { ENTITY_LABELS, LIMITS, LOOSE_PLACEHOLDER_RE, PLACEHOLDER_RE, TERM_DEFAULT_LABEL } from './constants.js'
import { luhnValid, patternsFor } from './patterns.js'
import { detectChinese } from './detectors-cn.js'
import { compileTerms, detectTerms, normalizeForMatch, parseTermLine } from './terminology.js'

/** 检索文本里的占位符形态（检索文本已小写化）。 */
const SCRATCH_PLACEHOLDER_RE = /<[a-z][a-z0-9]{0,15}_[0-9a-f]{8}>/g

/** FNV-1a 32 位哈希。 */
export function fnv1a32(input) {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** 8 位十六进制摘要。 */
export function hash8(input) {
  return fnv1a32(input).toString(16).padStart(8, '0')
}

/**
 * 生成确定性占位符。
 * @param {string} label 占位符标签（大写）。
 * @param {string} value 原文。
 * @returns {string} `<LABEL_xxxxxxxx>`。
 */
export function makePlaceholder(label, value) {
  return `<${label}_${hash8(`${label}\u0000${value}`)}>`
}

/**
 * 构造归一化检索文本。
 * 长度不变时返回恒等映射（null），否则返回"检索下标 → 原文下标"的映射表。
 * @param {string} text 原文。
 * @returns {{scratch: string, map: number[]|null}} 检索文本与映射。
 */
export function buildScratch(text) {
  const normalized = text.normalize('NFKC')
  const lowered = normalized.toLowerCase()
  if (normalized.length === text.length && lowered.length === text.length) {
    return { scratch: lowered, map: null }
  }
  const chars = []
  const map = []
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index)
    const size = codePoint > 0xffff ? 2 : 1
    const piece = text.slice(index, index + size).normalize('NFKC').toLowerCase()
    for (const ch of piece) {
      chars.push(ch)
      map.push(index)
    }
    index += size
  }
  return { scratch: chars.join(''), map }
}

/** 中和检索文本里已存在的占位符区域（保持长度，偏移不失真）。 */
function neutralizePlaceholders(scratch) {
  if (!scratch.includes('_')) return scratch
  return scratch.replace(SCRATCH_PLACEHOLDER_RE, (match) => '\u0000'.repeat(match.length))
}

/**
 * 重叠消解：起点升序 → 置信度降序 → 长者优先；先到先得。
 * @param {Array<object>} matches 原始 matches。
 * @returns {Array<object>} 消解后的 matches。
 */
export function resolveOverlaps(matches) {
  if (matches.length === 0) return []
  const sorted = [...matches].sort(
    (left, right) => left.start - right.start || right.score - left.score || right.end - left.end,
  )
  const out = []
  let lastEnd = -1
  for (const match of sorted) {
    if (match.start >= lastEnd && match.end > match.start) {
      out.push(match)
      lastEnd = match.end
    }
  }
  return out
}

/**
 * 脱敏引擎。
 *
 * @typedef {object} Hit
 * @property {string} entity 实体名。
 * @property {string} label 占位符标签。
 * @property {number} start 原文起点。
 * @property {number} end 原文终点（不含）。
 * @property {string} value 原文片段。
 * @property {string} placeholder 占位符。
 * @property {number} score 置信度。
 */
export class MaskEngine {
  /**
   * @param {object} options 配置。
   * @param {string[]} [options.entities] 启用的实体。
   * @param {Array<object>} [options.terms] 词表条目（字符串或 {value,label,category}；`re:` 前缀为正则项）。
   * @param {Set<string>} [options.disabledLabels] 停用标签（大写），命中的词表条目不参与编译。
   * @param {(label: string, value: string) => string} [options.hasher] 占位符哈希（默认 legacy FNV-1a；
   *   生产由 runtime 注入 HMAC 版，见 lib/crypto.js）。
   * @param {boolean} [options.addressStreetOnly] 中文地址只保留到街道/路（抹掉门牌号）。
   * @param {(placeholder: string, value: string, label: string) => void} [options.onEntry] 记录回调（写入还原表）。
   */
  constructor(options = {}) {
    const entities = options.entities ?? Object.keys(ENTITY_LABELS)
    this.entities = [...entities]
    this.patterns = patternsFor(entities)
    this.cnEntities = this.entities.filter((entity) => entity.startsWith('cn-'))
    this.terms = compileTerms((options.terms ?? []).map(normalizeTermEntry).map(toTermEntry), {
      disabledLabels: options.disabledLabels,
    })
    this.termCount = this.terms.count
    this.termsEnabled = this.entities.includes('term')
    this.hasher = typeof options.hasher === 'function' ? options.hasher : (label, value) => hash8(`${label}\u0000${value}`)
    this.addressStreetOnly = options.addressStreetOnly === true
    this.onEntry = options.onEntry ?? null
    this.stats = { masked: 0, byLabel: Object.create(null) }
    // 词表命中计数（归一化 value → 次数）：只统计"实际被替换"的词条，进程内累计，绝不含明文。
    this.termHits = Object.create(null)
  }

  /**
   * 只检测不替换。
   * @param {string} text 原文。
   * @returns {Hit[]} 命中列表（按起点升序，互不重叠）。
   */
  detect(text) {
    const raw = typeof text === 'string' ? text : String(text ?? '')
    if (raw === '' || raw.length > LIMITS.MAX_TEXT_LENGTH) return []
    const { scratch: rawScratch, map } = buildScratch(raw)
    const scratch = neutralizePlaceholders(rawScratch)
    const matches = []
    for (const pattern of this.patterns) {
      for (const match of scratch.matchAll(pattern.source)) {
        const whole = match[0]
        let start = match.index
        let end = start + whole.length
        if (pattern.group !== undefined) {
          const value = match[pattern.group]
          if (value === undefined || value === '') continue
          const offset = whole.lastIndexOf(value)
          if (offset === -1) continue
          start = match.index + offset
          end = start + value.length
        }
        matches.push({
          entity: pattern.entity,
          label: ENTITY_LABELS[pattern.entity] ?? pattern.entity.toUpperCase(),
          start,
          end,
          score: pattern.score,
        })
      }
    }
    for (const match of detectChinese(scratch, this.cnEntities, LIMITS.MAX_ORG_PREFIX)) matches.push(match)
    if (this.termsEnabled) for (const match of detectTerms(scratch, this.terms)) matches.push(match)

    const hits = []
    for (const match of resolveOverlaps(matches)) {
      let start = map === null ? match.start : (map[match.start] ?? 0)
      let end = map === null ? match.end : (match.end < map.length ? map[match.end] : raw.length)
      if (end <= start) continue
      let value = raw.slice(start, end)
      // 含 NUL 中和位说明这段落在既有占位符内部，跳过。
      if (value.includes('\u0000')) continue
      // 银行卡：Luhn 校验剔除正则误报（随机 16-19 位数字不等于银行卡号）。
      if (match.entity === 'bank-card' && !luhnValid(value.replace(/\D/gu, ''))) continue
      // 中文地址：street 粒度只保留到街/路/道/巷/弄/里，抹掉门牌号。
      if (match.entity === 'cn-address' && this.addressStreetOnly) {
        const cutAt = Math.max(
          value.lastIndexOf('街'), value.lastIndexOf('路'), value.lastIndexOf('道'),
          value.lastIndexOf('巷'), value.lastIndexOf('弄'), value.lastIndexOf('里'),
        ) + 1
        if (cutAt > 0 && cutAt < value.length) {
          end = start + cutAt
          value = raw.slice(start, end)
        }
      }
      hits.push({
        entity: match.entity,
        label: match.label,
        start,
        end,
        value,
        placeholder: `<${match.label}_${this.hasher(match.label, value)}>`,
        score: match.score,
      })
    }
    return hits
  }

  /**
   * 脱敏：返回替换后的文本与命中列表。
   * @param {string} text 原文。
   * @returns {{text: string, hits: Hit[]}} 结果。
   */
  mask(text) {
    const source = typeof text === 'string' ? text : String(text ?? '')
    const hits = this.detect(source)
    if (hits.length === 0) return { text: source, hits }
    let out = ''
    let cursor = 0
    for (const hit of hits) {
      out += source.slice(cursor, hit.start) + hit.placeholder
      cursor = hit.end
      this.stats.masked += 1
      this.stats.byLabel[hit.label] = (this.stats.byLabel[hit.label] ?? 0) + 1
      if (hit.entity === 'term') {
        const key = String(hit.value ?? '').normalize('NFKC').toLowerCase()
        if (key !== '') this.termHits[key] = (this.termHits[key] ?? 0) + 1
      }
      if (this.onEntry !== null) this.onEntry(hit.placeholder, hit.value, hit.label)
    }
    out += source.slice(cursor)
    return { text: out, hits }
  }

  /** 累计统计（只含计数与标签分布，绝不含明文）。 */
  statsSnapshot() {
    return { masked: this.stats.masked, byLabel: { ...this.stats.byLabel } }
  }
}

/** 词表条目归一：接受字符串或对象。 */
function normalizeTermEntry(entry) {
  if (typeof entry === 'string') return entry
  if (entry !== null && typeof entry === 'object') return entry
  return null
}

/**
 * 字符串词表条目按"词表行"解析（支持行尾 `@category`、注释）。
 * 不做这一步的话，`某某公司 @company` 会被当成一个含 `@` 的整串词条去匹配，永远匹配不到。
 * @param {unknown} entry 归一后的条目。
 * @returns {object|null} 词表条目。
 */
function toTermEntry(entry) {
  if (typeof entry !== 'string') return entry
  const parsed = parseTermLine(entry)
  if (parsed === null) return null
  return { value: parsed.value, label: parsed.label ?? TERM_DEFAULT_LABEL, category: parsed.category }
}

/**
 * 一次性脱敏（不累计、不记录），供 shield_scan / 自检使用。
 * @param {string} text 原文。
 * @param {object} options 同 MaskEngine。
 * @returns {{text: string, hits: Hit[]}} 结果。
 */
export function maskText(text, options = {}) {
  return new MaskEngine(options).mask(text)
}

/**
 * 用还原表把占位符换回原文。
 * @param {string} text 含占位符的文本。
 * @param {(placeholder: string) => string|undefined} lookup 查表函数。
 * @returns {string} 还原后的文本。
 */
export function restoreText(text, lookup) {
  if (typeof text !== 'string' || text === '') return text ?? ''
  // 两遍：先精确形态，再宽松兜底（2026-10-21 回灌：模型改写大小写/分隔符时，
  // 归一化成规范 key 再查表——只折叠大小写与空白，不会串还原到别的实体）。
  const exact = text.replace(PLACEHOLDER_RE, (whole) => {
    const value = lookup(whole)
    return value === undefined ? whole : value
  })
  return exact.replace(LOOSE_PLACEHOLDER_RE, (whole, label, hash) => {
    const key = '<' + label.toUpperCase() + '_' + hash.toLowerCase() + '>'
    const value = lookup(key)
    return value === undefined ? whole : value
  })
}

/** 统计文本里的占位符（只读，用于出境审计）。 */
export function countPlaceholders(text) {
  if (typeof text !== 'string' || text === '') return { total: 0, byLabel: {} }
  const byLabel = Object.create(null)
  let total = 0
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    total += 1
    byLabel[match[1]] = (byLabel[match[1]] ?? 0) + 1
  }
  return { total, byLabel: { ...byLabel } }
}
