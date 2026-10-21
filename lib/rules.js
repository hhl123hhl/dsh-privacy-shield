// lib/rules.js — 规则包：导入 / 导出 / 校验 + 词表文件读取（零依赖，只用 node: 内置模块）。
//
// 规则包是"可携带的配置"：词表 + 实体开关。它的用途是让一台机器上调好的脱敏规则
// 能原样搬到另一台机器（或另一个人的 DSH）上，而不必手工抄词表。
//
// 铁律：规则包**永远不含还原表（vault）里的真值**。
//   - 导出侧：buildRulesPack() 只接收词表行与实体名，不碰 vault。
//   - 导入侧：validateRulesPack() 一旦发现 vault / values / secrets 之类的字段就直接拒绝，
//     防止有人把"还原表"误当成规则包转发出去。

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { ENTITY_LABELS, LIMITS, RULES_SCHEMA, TERM_DEFAULT_LABEL } from './constants.js'
import { normalizeForMatch, parseTermLine } from './terminology.js'

/** 单个规则包的字节上限：规则包只是文本配置，超过这个大小一定是搞错了。 */
export const MAX_PACK_BYTES = 4_000_000

/** 明确拒绝的字段名（出现即认为误传了敏感数据）。 */
const FORBIDDEN_KEYS = Object.freeze(['vault', 'values', 'secrets', 'plaintext', 'restore'])

/**
 * 规则文件的默认目录：`$DSH_HOME/shield`（未设置 DSH_HOME 时退到 `~/.dsh/shield`）。
 * @param {Record<string, string|undefined>} [env] 环境变量。
 * @returns {string} 目录绝对路径。
 */
export function rulesRoot(env = process.env) {
  const home = typeof env?.DSH_HOME === 'string' && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'shield')
}

/**
 * 解析用户给的路径：绝对路径原样，相对路径落在规则目录下。
 * @param {string} input 用户输入。
 * @param {Record<string, string|undefined>} [env] 环境变量。
 * @returns {string|null} 绝对路径或 null。
 */
export function resolveRulesPath(input, env = process.env) {
  if (typeof input !== 'string') return null
  const raw = input.trim().replace(/^"(.*)"$/u, '$1').replace(/^'(.*)'$/u, '$1')
  if (raw === '') return null
  return isAbsolute(raw) ? resolve(raw) : resolve(rulesRoot(env), raw)
}

/**
 * 默认导出路径：`<rulesRoot>/shield-rules-<时间戳>.json`。
 * @param {Record<string, string|undefined>} [env] 环境变量。
 * @param {Date} [stamp] 时间。
 * @returns {string} 绝对路径。
 */
export function defaultRulesPath(env = process.env, stamp = new Date()) {
  const iso = stamp.toISOString().replace(/[:.]/gu, '-')
  return join(rulesRoot(env), `shield-rules-${iso.slice(0, 19)}.json`)
}

/**
 * 把词表条目规范成一行可携带的文本。
 * @param {string|{value?: string, label?: string, category?: string|null}} entry 条目。
 * @returns {string} 规范行（无法识别时返回空串）。
 */
export function canonicalTermLine(entry) {
  if (typeof entry === 'string') {
    const parsed = parseTermLine(entry)
    if (parsed === null) return ''
    return parsed.category === null || parsed.category === undefined
      ? parsed.value
      : `${parsed.value} @${parsed.category}`
  }
  if (entry !== null && typeof entry === 'object' && typeof entry.value === 'string') {
    const label = entry.category ?? entry.label ?? TERM_DEFAULT_LABEL
    const tag = String(label).replace(/^@/u, '')
    return `${entry.value} @${tag}`
  }
  return ''
}

/**
 * 组装规则包（不含任何真值）。
 * @param {{version?: string, entities?: string[], terms?: Array<string|object>, notes?: string}} input 输入。
 * @returns {object} 规则包对象。
 */
export function buildRulesPack(input = {}) {
  const terms = []
  for (const entry of Array.isArray(input.terms) ? input.terms : []) {
    const line = canonicalTermLine(entry)
    if (line !== '') terms.push(line)
    if (terms.length >= LIMITS.MAX_TERMS) break
  }
  return {
    schema: RULES_SCHEMA,
    exportedAt: new Date().toISOString(),
    plugin: { name: 'dsh-privacy-shield', version: typeof input.version === 'string' ? input.version : '0.0.0' },
    entities: (Array.isArray(input.entities) ? input.entities : []).filter(
      (entity) => typeof entity === 'string' && Object.prototype.hasOwnProperty.call(ENTITY_LABELS, entity),
    ),
    terms,
    notes: typeof input.notes === 'string' ? input.notes.slice(0, 2000) : '',
  }
}

/**
 * 序列化规则包。
 * @param {object} pack 规则包。
 * @returns {string} JSON 文本。
 */
export function serializeRulesPack(pack) {
  return `${JSON.stringify(pack, null, 2)}\n`
}

/**
 * 校验并归一化一个规则包对象。
 * @param {unknown} raw 待校验对象。
 * @returns {{ok: boolean, pack: object|null, errors: string[], warnings: string[]}} 结果。
 */
export function validateRulesPack(raw) {
  const errors = []
  const warnings = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, pack: null, errors: ['规则包必须是一个 JSON 对象'], warnings }
  }
  for (const key of FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      errors.push(`规则包里出现了 "${key}" 字段：规则包只允许携带词表与实体开关，绝不携带还原表（真值）`)
    }
  }
  if (raw.schema !== RULES_SCHEMA) {
    errors.push(`规则包 schema 必须是 "${RULES_SCHEMA}"，实际是 ${JSON.stringify(raw.schema ?? null)}`)
  }
  const entities = []
  if (raw.entities !== undefined) {
    if (!Array.isArray(raw.entities)) errors.push('entities 必须是字符串数组')
    else {
      for (const entity of raw.entities) {
        if (typeof entity !== 'string') {
          warnings.push(`忽略非字符串实体：${JSON.stringify(entity)}`)
          continue
        }
        if (!Object.prototype.hasOwnProperty.call(ENTITY_LABELS, entity)) {
          warnings.push(`忽略未知实体：${entity}`)
          continue
        }
        if (!entities.includes(entity)) entities.push(entity)
      }
    }
  }
  const terms = []
  if (raw.terms !== undefined) {
    if (!Array.isArray(raw.terms)) errors.push('terms 必须是字符串数组')
    else {
      for (const line of raw.terms) {
        if (typeof line !== 'string') {
          warnings.push('忽略非字符串词表条目')
          continue
        }
        const parsed = parseTermLine(line)
        if (parsed === null) {
          warnings.push(`忽略无法解析的词表行：${line.slice(0, 40)}`)
          continue
        }
        if (terms.length >= LIMITS.MAX_TERMS) {
          warnings.push(`词表超过上限 ${LIMITS.MAX_TERMS} 条，多余部分被忽略`)
          break
        }
        terms.push(canonicalTermLine(parsed))
      }
    }
  }
  if (errors.length > 0) return { ok: false, pack: null, errors, warnings }
  return {
    ok: true,
    pack: {
      schema: RULES_SCHEMA,
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null,
      plugin: raw.plugin !== null && typeof raw.plugin === 'object' ? raw.plugin : null,
      entities,
      terms,
      notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 2000) : '',
    },
    errors,
    warnings,
  }
}

/**
 * 解析并校验规则包文本。
 * @param {string} text 文件内容。
 * @returns {{pack: object, warnings: string[]}} 结果。
 * @throws {Error} 解析或校验失败时抛出（消息可直接展示给用户）。
 */
export function parseRulesPackText(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('规则包内容为空')
  if (text.length > MAX_PACK_BYTES) throw new Error(`规则包过大（${text.length} 字节 > ${MAX_PACK_BYTES}）`)
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new Error(`规则包不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
  const result = validateRulesPack(raw)
  if (!result.ok) throw new Error(`规则包校验失败：${result.errors.join('；')}`)
  return { pack: result.pack, warnings: result.warnings }
}

/**
 * 合并词表：保留已有条目，追加新条目（按归一化后去重）。
 * @param {string[]} existing 已有词表行。
 * @param {string[]} incoming 新词表行。
 * @returns {{terms: string[], added: number, duplicates: number}} 合并结果。
 */
export function mergeTermLines(existing, incoming) {
  const terms = []
  const seen = new Set()
  for (const line of Array.isArray(existing) ? existing : []) {
    const parsed = parseTermLine(typeof line === 'string' ? line : canonicalTermLine(line))
    if (parsed === null) continue
    const key = normalizeForMatch(parsed.value)
    if (seen.has(key)) continue
    seen.add(key)
    terms.push(canonicalTermLine(parsed))
  }
  const base = terms.length
  let duplicates = 0
  for (const line of Array.isArray(incoming) ? incoming : []) {
    const parsed = parseTermLine(typeof line === 'string' ? line : canonicalTermLine(line))
    if (parsed === null) continue
    const key = normalizeForMatch(parsed.value)
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    if (terms.length >= LIMITS.MAX_TERMS) break
    seen.add(key)
    terms.push(canonicalTermLine(parsed))
  }
  return { terms, added: terms.length - base, duplicates }
}

/**
 * 读取文本文件。
 * @param {string} path 绝对路径。
 * @returns {string} 内容。
 * @throws {Error} 读取失败时抛出。
 */
export function readTextFile(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`读取失败 ${path}：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 写文本文件（自动创建上级目录）。
 * @param {string} path 绝对路径。
 * @param {string} text 内容。
 * @returns {void}
 * @throws {Error} 写入失败时抛出。
 */
export function writeTextFile(path, text) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text, 'utf8')
  } catch (error) {
    throw new Error(`写入失败 ${path}：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 把"词表文件"文本解析成词表行（`#` 与 `//` 开头为注释）。
 * @param {string} text 文件内容。
 * @returns {{terms: string[], skipped: number}} 词表行。
 */
export function parseTermsFileText(text) {
  const terms = []
  let skipped = 0
  for (const line of String(text ?? '').split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const parsed = parseTermLine(trimmed)
    if (parsed === null) {
      skipped += 1
      continue
    }
    if (terms.length >= LIMITS.MAX_TERMS) break
    terms.push(canonicalTermLine(parsed))
  }
  return { terms, skipped }
}

/**
 * 追加一行 JSON（用于出境审计 JSONL；自动创建上级目录）。
 * 失败时返回 false，绝不抛出——审计落盘失败不能影响模型通路。
 * @param {string} path 绝对路径。
 * @param {object} value 可序列化对象（调用方保证不含真值）。
 * @returns {boolean} 是否写入成功。
 */
export function appendJsonLine(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${JSON.stringify(value)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}
