// lib/vault.js — 还原表与流式还原器（零依赖）。
//
// 还原表：占位符 → 原文。默认只驻内存；由于真值本来就在本地会话日志里，
// 这张表随时可以由日志重建（见 lib/rebuild.js 的计划），因此不是"额外的明文副本"。
//
// 流式还原器：模型回话是分 chunk 到的，占位符可能被切在 chunk 边界（`<OR` + `G_ab12cd34>`），
// 所以必须把"可能是半个占位符"的尾巴先扣住，等后续 chunk 补齐或块结束时再放行。

import { LOOSE_PARTIAL_PLACEHOLDER_RE, LOOSE_PLACEHOLDER_RE, PARTIAL_PLACEHOLDER_RE, PLACEHOLDER_RE } from './constants.js'

/** 占位符最长可能长度（`<` + 16 标签 + `_` + 8 哈希 + `>`）。 */
const MAX_PLACEHOLDER_LEN = 16 + 1 + 8 + 2

/**
 * 还原表：有界 LRU 顺序（按写入先后逐出最旧）。
 */
export class Vault {
  /**
   * @param {object} [options] 选项。
   * @param {number} [options.maxEntries] 条目上限。
   */
  constructor(options = {}) {
    this.maxEntries = Math.max(16, options.maxEntries ?? 5000)
    /** @type {Map<string, {value: string, label: string}>} */
    this.entries = new Map()
  }

  /**
   * 记录一条映射（同一占位符重复记录只更新时间顺序）。
   * @param {string} placeholder 占位符。
   * @param {string} value 原文。
   * @param {string} [label] 标签。
   * @returns {void}
   */
  record(placeholder, value, label = '') {
    if (typeof placeholder !== 'string' || placeholder === '' || typeof value !== 'string') return
    if (this.entries.has(placeholder)) this.entries.delete(placeholder)
    this.entries.set(placeholder, { value, label })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      this.entries.delete(oldest)
    }
  }

  /**
   * 查表。
   * @param {string} placeholder 占位符。
   * @returns {string|undefined} 原文，未命中为 undefined。
   */
  lookup(placeholder) {
    return this.entries.get(placeholder)?.value
  }

  /** 条目数。 */
  get size() {
    return this.entries.size
  }

  /** 按标签统计条目数（审计用，不含明文）。 */
  countByLabel() {
    const out = Object.create(null)
    for (const entry of this.entries.values()) out[entry.label || '-'] = (out[entry.label || '-'] ?? 0) + 1
    return { ...out }
  }

  /** 读取一条（受控用途：导出/自检）。 */
  get(placeholder) {
    return this.entries.get(placeholder)
  }

  /** 遍历（受控用途）。 */
  all() {
    return [...this.entries.entries()].map(([placeholder, entry]) => ({ placeholder, ...entry }))
  }

  /** 清空。 */
  clear() {
    this.entries.clear()
  }
}

/**
 * 流式还原器：逐块喂入，输出"确定不再变化的"还原文本。
 */
export class StreamRestorer {
  /**
   * @param {object} options 选项。
   * @param {(placeholder: string) => string|undefined} options.lookup 查表函数。
   */
  constructor(options) {
    this.lookup = options.lookup
    this.pending = ''
    this.stats = { restored: 0 }
  }

  /**
   * 还原一段文本（不做跨块保留）。两遍：先精确形态，再宽松兜底
   * （2026-10-21 回灌：模型改写大小写/分隔符时；归一成规范 key 再查，不串还原）。
   */
  restore(text) {
    if (typeof text !== 'string' || text === '') return text ?? ''
    let out = text.replace(PLACEHOLDER_RE, (whole) => {
      const value = this.lookup(whole)
      if (value === undefined) return whole
      this.stats.restored += 1
      return value
    })
    out = out.replace(LOOSE_PLACEHOLDER_RE, (whole, label, hash) => {
      const value = this.lookup('<' + label.toUpperCase() + '_' + hash.toLowerCase() + '>')
      if (value === undefined) return whole
      this.stats.restored += 1
      return value
    })
    return out
  }

  /**
   * 喂入一个 chunk，返回可以立即发出的文本。
   * @param {string} chunk 文本增量。
   * @returns {string} 可立即发出的文本（可能为空串）。
   */
  push(chunk) {
    if (typeof chunk !== 'string' || chunk === '') return ''
    this.pending += chunk
    const lastOpen = this.pending.lastIndexOf('<')
    if (lastOpen === -1) {
      const out = this.restore(this.pending)
      this.pending = ''
      return out
    }
    const tail = this.pending.slice(lastOpen)
    // 扣留条件（2026-10-21 修复）：尾巴可能是"还没收全的占位符"。
    //
    // 旧实现只认 PARTIAL_PLACEHOLDER_RE，而该正则要求 `<` 后至少一个大写字母，
    // 于是当某个 chunk 正好以 `<` 结尾时（模型把 `<` 单独分片，DeepSeek 线上实况），
    // 裸 `<` 被判为"不是占位符"立即放行 → 占位符被切成两半，之后再也不会拼齐。
    // 该缺陷由 KTest 平台 P0 探针按 1/3/7/16 字符粒度切片复现。
    //
    // 修法：把"裸 `<`"也纳入扣留；其余仍走原正则，保持"普通尖括号文本即时放行"的
    // 既有时序语义（不引入额外延迟）。2026-10-21 再回灌宽松尾串：模型若把占位符
    // 改写成小写/连字符形态（<phone_…>），旧 PARTIAL 正则同样漏判，故并列纳入。
    const looksPartial = tail === '<'
      || (tail.length <= MAX_PLACEHOLDER_LEN
          && (PARTIAL_PLACEHOLDER_RE.test(tail) || LOOSE_PARTIAL_PLACEHOLDER_RE.test(tail)))
    if (looksPartial) {
      const head = this.pending.slice(0, lastOpen)
      this.pending = tail
      return this.restore(head)
    }
    const out = this.restore(this.pending)
    this.pending = ''
    return out
  }

  /**
   * 冲刷剩余文本（块结束/流结束/中止时调用）。
   * @returns {string} 剩余还原文本。
   */
  flush() {
    if (this.pending === '') return ''
    const out = this.restore(this.pending)
    this.pending = ''
    return out
  }
}
