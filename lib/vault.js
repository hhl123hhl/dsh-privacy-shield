// lib/vault.js — 还原表与流式还原器（零依赖）。
//
// 还原表：占位符 → 原文。默认只驻内存；由于真值本来就在本地会话日志里，
// 这张表随时可以由日志重建（见 lib/rebuild.js 的计划），因此不是"额外的明文副本"。
//
// 流式还原器：模型回话是分 chunk 到的，占位符可能被切在 chunk 边界（`<OR` + `G_ab12cd34>`），
// 所以必须把"可能是半个占位符"的尾巴先扣住，等后续 chunk 补齐或块结束时再放行。

import { PARTIAL_PLACEHOLDER_RE, PLACEHOLDER_RE } from './constants.js'

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
   * 还原一段文本（不做跨块保留）。
   * @param {string} text 输入。
   * @returns {string} 还原结果。
   */
  restore(text) {
    if (typeof text !== 'string' || text === '') return text ?? ''
    return text.replace(PLACEHOLDER_RE, (whole) => {
      const value = this.lookup(whole)
      if (value === undefined) return whole
      this.stats.restored += 1
      return value
    })
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
    // 尾巴看起来像"还没收全的占位符"就先扣住。
    if (tail.length <= MAX_PLACEHOLDER_LEN && PARTIAL_PLACEHOLDER_RE.test(tail)) {
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
