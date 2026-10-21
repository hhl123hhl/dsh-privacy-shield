// lib/runtime.js — 插件运行时：引擎、还原表、统计（零依赖）。
//
// 一条不变量：模型可见面被改写，本地记录面永不改写。
// 因此这里所有函数都是"纯副本"语义：入参对象绝不被就地修改。

import { ENTITY_LABELS, MODES, SURFACE_KEYS } from './constants.js'
import { MaskEngine, countPlaceholders, restoreText } from './engine.js'
import { StreamRestorer, Vault } from './vault.js'
import { canonicalTermLine, mergeTermLines } from './rules.js'
import { normalizeForMatch, parseTermLine } from './terminology.js'
import { legacyPlaceholder, makePlaceholderHasher } from './crypto.js'

/** 消息 role → surface 事件类型。 */
const ROLE_SURFACE = Object.freeze({
  system: 'system/message',
  developer: 'developer/message',
  user: 'user/message',
  assistant: 'assistant/message',
  tool: 'tool/result',
})

/**
 * 统计累加器：只存计数与标签分布，永不存明文。
 */
class Stats {
  constructor() {
    this.maskedTexts = 0
    this.byLabel = Object.create(null)
    this.sessions = new Set()
    this.streamCalls = 0
    this.restoredValues = 0
    this.outboundRequests = 0
    this.outboundPlaceholders = 0
    this.outboundByLabel = Object.create(null)
    this.violations = 0
    this.lastViolation = null
    this.errors = []
  }

  addHits(hits) {
    for (const hit of hits) {
      this.byLabel[hit.label] = (this.byLabel[hit.label] ?? 0) + 1
    }
  }

  noteError(where, error) {
    const message = error instanceof Error ? error.message : String(error)
    this.errors.push({ where, message, at: Date.now() })
    if (this.errors.length > 50) this.errors.shift()
  }

  snapshot() {
    return {
      maskedTexts: this.maskedTexts,
      byLabel: { ...this.byLabel },
      sessions: this.sessions.size,
      streamCalls: this.streamCalls,
      restoredValues: this.restoredValues,
      outboundRequests: this.outboundRequests,
      outboundPlaceholders: this.outboundPlaceholders,
      outboundByLabel: { ...this.outboundByLabel },
      violations: this.violations,
      lastViolation: this.lastViolation,
      errors: this.errors.slice(-10),
    }
  }
}

/**
 * 运行时。
 */
export class ShieldRuntime {
  /**
   * @param {object} config 已归一化的配置（见 lib/config.js）。
   * @param {Record<string, string|undefined>} [env] 环境变量（测试可注入临时 DSH_HOME）。
   */
  constructor(config, env = process.env) {
    this.config = config
    /** 环境变量快照（测试注入临时 DSH_HOME 时，路径解析要用它而不是 process.env）。 */
    this.env = env
    /** @type {Vault} */
    this.vault = new Vault({ maxEntries: config.maxVaultEntries })
    /** 词表原始行（导出规则包时用它，保留用户原始大小写）。 */
    this.termLines = []
    /** 占位符哈希器（HMAC 优先，密钥本地托管；见 lib/crypto.js）。 */
    const hasherInfo = makePlaceholderHasher(config, env)
    /** @type {(label: string, value: string) => string} */
    this.placeholderHasher = hasherInfo.hasher
    this.placeholderHashMode = hasherInfo.mode
    this.keySource = hasherInfo.keySource
    /** 词表版本：每次 replaceTerms +1（治理与审计用）。 */
    this.termsVersion = 0
    // 词表原始行先落档（toggleTermLabel 等重建引擎时以它为准）。
    this.termLines = []
    for (const entry of Array.isArray(config.terms) ? config.terms : []) {
      const line = canonicalTermLine(entry)
      if (line !== '') this.termLines.push(line)
    }
    /** @type {MaskEngine} */
    this.engine = this.buildEngine(this.termLines)
    this.stats = new Stats()
    this.enforcing = config.mode === MODES.ENFORCE
    /** 运行时开关（/shield on|off）。 */
    this.active = true
    /** 词表/引擎代际：重建引擎时 +1，derive 补丁缓存据此失效。 */
    this.maskEpoch = 0
    /** derive 脱敏补丁是否已装上（installDerivePatch 成功置 true）。 */
    this.derivePatchInstalled = false
    /** 候选专名池（scan-doc / learn 产出；30 分钟过期；adopt 确认后才入词表）。 */
    this.candidates = []
    this.candidateStamp = 0
    this.candidateTtlMs = 30 * 60 * 1000
    this.warnings = []
    if (hasherInfo.warning !== null) this.warnings.push(hasherInfo.warning)
  }

  /**
   * 构建引擎（占位符哈希器、停用标签、地址粒度统一从这里走）。
   * @param {string[]} terms 词表行。
   * @returns {MaskEngine} 引擎。
   */
  buildEngine(terms) {
    return new MaskEngine({
      entities: this.config.entities,
      terms,
      disabledLabels: new Set(this.config.disabledLabels ?? []),
      hasher: this.placeholderHasher,
      addressStreetOnly: this.config.addressLevel === 'street',
      onEntry: (placeholder, value, label) => {
        this.vault.record(placeholder, value, label)
        // 同时登记 legacy 占位符别名：旧版本（FNV）生成的占位符也能还原。
        if (this.placeholderHashMode !== 'legacy') {
          const alias = legacyPlaceholder(label, value)
          if (alias !== placeholder) this.vault.record(alias, value, label)
        }
      },
    })
  }

  /** 当前模式字符串。 */
  get mode() {
    return this.enforcing ? MODES.ENFORCE : MODES.OBSERVE
  }

  /** 切换模式。 */
  setEnforcing(value) {
    this.enforcing = value === true
  }

  /** pause 到期时间戳（0 = 未暂停）。 */
  pausedUntil = 0

  /** pause 自动恢复的计时器。 */
  pauseTimer = null

  /**
   * 按字符串设置模式。
   * @param {string} mode 'enforce' | 'observe'。
   * @returns {boolean} 是否被接受。
   */
  setMode(mode) {
    if (mode !== MODES.ENFORCE && mode !== MODES.OBSERVE) return false
    this.setEnforcing(mode === MODES.ENFORCE)
    return true
  }

  /**
   * 护盾是否处于启用状态（全局开关，`/shield on|off`）。
   * 说明：DSH 的投影 API 不区分会话，所以这里是全局开关而不是会话过滤器。
   * @returns {boolean} 是否启用。
   */
  isActive() {
    return this.active === true
  }

  /**
   * 是否正在真正改写（= 启用且 enforce 且未暂停）。`/shield off`、observe、pause 期间都为 false。
   * 投影与手搓请求兜底都以它为准。
   * @returns {boolean} 是否改写。
   */
  get protecting() {
    return this.active === true && this.enforcing === true && !this.isPaused()
  }

  /**
   * 临时放行（/shield pause <分钟>）：期间不改写模型可见面，到期自动恢复。
   * @param {number} minutes 分钟数（1–720）。
   * @returns {{pausedRemainingMin: number}} 剩余分钟。
   */
  pause(minutes) {
    const min = Math.min(720, Math.max(1, Math.floor(Number(minutes) || 0)))
    this.pausedUntil = Date.now() + min * 60 * 1000
    if (this.pauseTimer !== undefined && this.pauseTimer !== null) clearTimeout(this.pauseTimer)
    this.pauseTimer = setTimeout(() => {
      this.pausedUntil = 0
      this.pauseTimer = null
    }, min * 60 * 1000)
    if (typeof this.pauseTimer.unref === 'function') this.pauseTimer.unref()
    return { pausedRemainingMin: min }
  }

  /** 立即恢复（到期自动恢复之外的提前恢复入口）。 */
  resume() {
    this.pausedUntil = 0
    if (this.pauseTimer !== undefined && this.pauseTimer !== null) {
      clearTimeout(this.pauseTimer)
      this.pauseTimer = null
    }
  }

  /** 是否处于 pause 放行窗口。 */
  isPaused() {
    return typeof this.pausedUntil === 'number' && this.pausedUntil > Date.now()
  }

  /** pause 剩余分钟（0 = 未暂停）。 */
  pausedRemaining() {
    if (!this.isPaused()) return 0
    return Math.max(1, Math.ceil((this.pausedUntil - Date.now()) / 60000))
  }

  /**
   * 某会话是否被覆盖。DSH 的投影 API 不区分会话，因此只取决于全局开关。
   * 保留 sessionId 形参以兼容浏览器半边（client-rpc.js）的调用约定。
   * @param {string} [_sessionId] 会话 id（忽略）。
   * @returns {boolean} 是否覆盖。
   */
  sessionAllowed(_sessionId) {
    return this.active === true
  }

  /** 某类 surface 是否在覆盖范围内。 */
  surfaceWanted(eventType) {
    return this.config.surfaces[eventType] === true
  }

  /** 重新编译词表（/shield terms reload、导入规则包、启动载入词表后调用）。 */
  replaceTerms(terms) {
    const lines = []
    for (const entry of Array.isArray(terms) ? terms : []) {
      const line = canonicalTermLine(entry)
      if (line !== '') lines.push(line)
    }
    this.termLines = lines
    this.config.terms = lines
    this.engine = this.buildEngine(lines)
    this.maskEpoch += 1
    this.termsVersion += 1
    return lines.length
  }

  /** 兼容旧名。 */
  reloadTerms(terms) {
    return this.replaceTerms(terms)
  }

  /**
   * 应用一个规则包（实体开关 + 词表）。只影响本进程，不写回配置文件。
   * @param {{entities?: string[], terms?: string[]}} pack 规则包。
   * @returns {{entities: number, terms: number}} 生效后的规模。
   */
  applyRules(pack) {
    const entities = Array.isArray(pack?.entities)
      ? pack.entities.filter((entity) => Object.prototype.hasOwnProperty.call(ENTITY_LABELS, entity))
      : []
    if (entities.length > 0) this.config.entities = entities
    const terms = this.replaceTerms(pack?.terms ?? [])
    return { entities: this.config.entities.length, terms }
  }

  /** 写入候选池（scan-doc / learn 共用）。 */
  setCandidates(candidates) {
    this.candidates = Array.isArray(candidates) ? candidates : []
    this.candidateStamp = Date.now()
  }

  /** 候选池是否仍有效（30 分钟）。 */
  candidatesAlive() {
    return this.candidates.length > 0 && Date.now() - this.candidateStamp <= this.candidateTtlMs
  }

  /**
   * 确认采纳候选入词表（/shield terms adopt <序号…|all>）。
   * @param {string[]} ids 序号（1 起）或 ['all']。
   * @returns {{adopted: number, terms: number, stale: boolean}} 结果。
   */
  adoptCandidates(ids) {
    if (!this.candidatesAlive()) return { adopted: 0, terms: this.engine.termCount, stale: true }
    const wantAll = ids.includes('all')
    const picked = new Set(ids.map((id) => Number(id)))
    const lines = []
    this.candidates.forEach((candidate, index) => {
      if (!wantAll && !picked.has(index + 1)) return
      const label = typeof candidate.label === 'string' && /^[A-Z][A-Z0-9]{0,15}$/.test(candidate.label)
        ? candidate.label
        : 'TERM'
      lines.push(`${candidate.value} @${label}`)
    })
    if (lines.length === 0) return { adopted: 0, terms: this.engine.termCount, stale: false }
    const merged = mergeTermLines(this.termLines, lines)
    this.replaceTerms(merged.terms)
    return { adopted: merged.added, terms: this.engine.termCount, stale: false }
  }

  /**
   * 按标签批量启停词表条目（/shield terms label off|on LABEL）。
   * 只影响本进程；持久化请改 cordis.patch.yml 的 disabledLabels。
   * @param {string} label 占位符标签（大小写不敏感）。
   * @param {boolean} disable true=停用，false=恢复。
   * @returns {{label: string, disabled: boolean, terms: number}} 结果。
   */
  toggleTermLabel(label, disable) {
    const normalized = String(label ?? '').toUpperCase().replace(/[^A-Z0-9]/gu, '')
    if (!/^[A-Z][A-Z0-9]{0,15}$/.test(normalized)) {
      return { label: String(label ?? ''), disabled: false, terms: this.engine.termCount }
    }
    const set = new Set(this.config.disabledLabels ?? [])
    if (disable) set.add(normalized)
    else set.delete(normalized)
    this.config.disabledLabels = [...set]
    this.engine = this.buildEngine(this.termLines)
    this.maskEpoch += 1
    return { label: normalized, disabled: set.has(normalized), terms: this.engine.termCount }
  }

  /**
   * 设置生效实体集合（Web UI 设置页；立即重建引擎）。
   * @param {string[]} entities 实体 id 列表。
   * @returns {{entities: number}} 生效实体数。
   */
  setEntities(entities) {
    const valid = (Array.isArray(entities) ? entities : [])
      .filter((entity) => typeof entity === 'string' && Object.prototype.hasOwnProperty.call(ENTITY_LABELS, entity))
    if (valid.length === 0) throw new Error('没有可用的实体 id')
    this.config.entities = [...new Set(valid)]
    this.engine = this.buildEngine(this.termLines)
    this.maskEpoch += 1
    return { entities: this.engine.entities.length }
  }

  /**
   * 追加词表行（Web UI 词表管理；立即生效，本进程内）。
   * @param {string[]} lines 词表行（"值 @标签" 或 "re:正则 @标签"）。
   * @returns {{added: number, terms: number}} 结果。
   */
  addTermLines(lines) {
    const merged = mergeTermLines(this.termLines, Array.isArray(lines) ? lines : [])
    this.replaceTerms(merged.terms)
    return { added: merged.added, terms: this.engine.termCount }
  }

  /**
   * 按值移除词表条目（Web UI 词表管理；立即生效，本进程内）。
   * @param {string[]} values 要移除的词条值（大小写/全半角不敏感）。
   * @returns {{removed: number, terms: number}} 结果。
   */
  removeTermValues(values) {
    const drop = new Set((Array.isArray(values) ? values : []).map((value) => normalizeForMatch(String(value ?? ''))))
    const kept = []
    let removed = 0
    for (const line of this.termLines) {
      const parsed = parseTermLine(line)
      if (parsed !== null && drop.has(normalizeForMatch(parsed.value))) { removed += 1; continue }
      kept.push(line)
    }
    if (removed > 0) this.replaceTerms(kept)
    return { removed, terms: this.engine.termCount }
  }

  /** 词表条目的标签分布（只给计数，不给词条原文）。 */
  termsByLabel() {
    const byLabel = Object.create(null)
    for (const item of this.engine.terms.items ?? []) {
      byLabel[item.label] = (byLabel[item.label] ?? 0) + 1
    }
    return byLabel
  }

  /**
   * 生成脱敏副本消息；无需改动时返回 null。
   * @param {object} message 原始消息。
   * @returns {object|null} 脱敏副本。
   */
  maskMessage(message) {
    if (message === null || typeof message !== 'object') return null
    if (!Array.isArray(message.content)) return null
    const content = []
    let changed = false
    for (const block of message.content) {
      const next = this.maskBlock(block)
      if (next !== block) changed = true
      content.push(next)
    }
    if (!changed) return null
    return { ...message, content }
  }

  /**
   * 生成脱敏副本内容块；无需改动时原样返回。
   * @param {object} block 内容块。
   * @returns {object} 内容块（可能是副本）。
   */
  maskBlock(block) {
    if (block === null || typeof block !== 'object') return block
    if (block.type === 'text' || block.type === 'reasoning') {
      if (typeof block.text !== 'string' || block.text === '') return block
      const { text, hits } = this.engine.mask(block.text)
      if (hits.length === 0) return block
      this.stats.maskedTexts += 1
      this.stats.addHits(hits)
      return { ...block, text }
    }
    if (block.type === 'tool-call') {
      if (typeof block.arguments !== 'string' || block.arguments === '') return block
      const { text, hits } = this.engine.mask(block.arguments)
      if (hits.length === 0) return block
      this.stats.maskedTexts += 1
      this.stats.addHits(hits)
      return { ...block, arguments: text }
    }
    if (block.type === 'file') {
      // 文本类文件块：attachment（或块自身）里内联的文本字段送模型前脱敏。
      // 结构是宿主的 FileReceipt 引用：有内联文本就改写，纯引用/二进制数据则原样放行。
      const target = block.attachment !== null && typeof block.attachment === 'object' ? block.attachment : block
      const mime = typeof target.mimeType === 'string' ? target.mimeType : ''
      const textLike = mime === '' || /^(text\/|application\/(json|xml|javascript|x-yaml)|image\/svg)/u.test(mime)
      let maskedTarget = null
      if (textLike && typeof target.text === 'string' && target.text !== '') {
        const { text, hits } = this.engine.mask(target.text)
        if (hits.length > 0) {
          this.stats.maskedTexts += 1
          this.stats.addHits(hits)
          maskedTarget = { ...target, text }
        }
      } else if (textLike && typeof target.content === 'string' && target.content !== '' && typeof target.data !== 'string') {
        // content 可能是 base64：只在不存在 data 字段时把它当文本处理（启发式，保守）。
        const head = target.content.slice(0, 200)
        const looksBase64 = /^[A-Za-z0-9+\/]+={0,2}$/.test(head.replace(/\s/gu, ''))
        if (!looksBase64 || target.content.includes(' ')) {
          const { text, hits } = this.engine.mask(target.content)
          if (hits.length > 0) {
            this.stats.maskedTexts += 1
            this.stats.addHits(hits)
            maskedTarget = { ...target, content: text }
          }
        }
      }
      if (maskedTarget === null) return block
      return block.attachment !== null && typeof block.attachment === 'object'
        ? { ...block, attachment: maskedTarget }
        : maskedTarget
    }
    // image / tool-addition / tool-removal：按 mediaPolicy=pass 放行（本插件不做图片内容识别）。
    return block
  }

  /**
   * 还原文本。
   * @param {string} text 含占位符文本。
   * @returns {string} 还原结果。
   */
  restore(text) {
    return restoreText(text, (placeholder) => {
      const value = this.vault.lookup(placeholder)
      if (value !== undefined) this.stats.restoredValues += 1
      return value
    })
  }

  /** 新建一个流式还原器。 */
  createRestorer() {
    return new StreamRestorer({
      lookup: (placeholder) => {
        const value = this.vault.lookup(placeholder)
        if (value !== undefined) this.stats.restoredValues += 1
        return value
      },
    })
  }

  /**
   * 出境审计：统计一次请求里的占位符/媒体，并按配置校验明文残留。
   * @param {object} options llm/stream 的 GenerateOptions。
   * @param {object} [meta] 附加信息（是否手搓请求等）。
   * @returns {{placeholders: number, byLabel: object, violations: number}} 审计结果。
   */
  auditOutbound(options, meta = {}) {
    const result = { placeholders: 0, byLabel: {}, violations: 0 }
    try {
      const texts = []
      if (typeof options?.system === 'string' && options.system !== '') texts.push(options.system)
      const messages = Array.isArray(options?.messages) ? options.messages : []
      for (const message of messages) {
        if (message === null || typeof message !== 'object') continue
        const content = Array.isArray(message.content) ? message.content : []
        for (const block of content) {
          if (block === null || typeof block !== 'object') continue
          if (block.type === 'text' || block.type === 'reasoning') texts.push(block.text ?? '')
          else if (block.type === 'tool-call') texts.push(block.arguments ?? '')
        }
      }
      const joined = texts.join('\n')
      const counted = countPlaceholders(joined)
      result.placeholders = counted.total
      result.byLabel = counted.byLabel
      this.stats.outboundRequests += 1
      this.stats.outboundPlaceholders += counted.total
      for (const [label, count] of Object.entries(counted.byLabel)) {
        this.stats.outboundByLabel[label] = (this.stats.outboundByLabel[label] ?? 0) + count
      }
      if (typeof options?.sessionId === 'string') this.stats.sessions.add(options.sessionId)

      // 明文残留自检：出境请求里不应再命中任何检测器。
      if (this.enforcing && this.config.audit.verifyOutbound !== 'off'
        && joined.length <= this.config.audit.maxVerifyChars) {
        const hits = this.engine.detect(joined)
        result.violations = hits.length
        if (hits.length > 0) {
          this.stats.violations += hits.length
          this.stats.lastViolation = {
            at: Date.now(),
            sessionId: options?.sessionId ?? null,
            labels: hits.slice(0, 20).map((hit) => hit.label),
            count: hits.length,
            handBuilt: meta.handBuilt === true,
          }
        }
      }
    } catch (error) {
      this.stats.noteError('auditOutbound', error)
    }
    return result
  }

  /** 统计快照。 */
  snapshot() {
    return {
      mode: this.enforcing ? MODES.ENFORCE : MODES.OBSERVE,
      active: this.active,
      entities: this.config.entities,
      entityLabels: Object.keys(ENTITY_LABELS).length,
      terms: this.engine.termCount,
      termsByLabel: this.termsByLabel(),
      termKinds: { literal: this.engine.terms.items.length, regex: this.engine.terms.regexItems?.length ?? 0 },
      termsSkipped: this.engine.terms.skipped ?? 0,
      vault: this.vault.size,
      vaultByLabel: this.vault.countByLabel(),
      registerProjections: this.config.registerProjections === true,
      onUnmaskable: this.config.onUnmaskable,
      derivePatchInstalled: this.derivePatchInstalled === true,
      pausedRemainingMin: this.pausedRemaining(),
      placeholderHash: this.placeholderHashMode,
      keySource: this.keySource,
      minLevel: this.config.minLevel,
      addressLevel: this.config.addressLevel,
      disabledLabels: [...(this.config.disabledLabels ?? [])],
      termsVersion: this.termsVersion,
      surfaces: Object.entries(SURFACE_KEYS)
        .filter(([, type]) => this.config.surfaces[type] === true)
        .map(([key]) => key),
      ...this.stats.snapshot(),
    }
  }
}
