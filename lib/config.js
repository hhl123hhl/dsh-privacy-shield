// lib/config.js — 配置归一化（零依赖）。
//
// 配置来自 cordis.patch.yml；这里做"宽容读取 + 严格默认"：缺省字段一律用安全默认值，
// 非法值降级而不是抛错（抛错会让整个 profile 起不来）。
//
// 关于"按会话开关"：DSH 的消息投影 API 是**会话无关**的——sessions 服务只持有一个
// 投影数组，`project(event, context)` 的 context 只有 `{nodes, events, baseSeq, messages}`，
// 拿不到 sessionId（源码：dsh-session-index.js:426-436、:1611）。因此护盾只能全局生效，
// 早先设计的 sessionFilter 已移除；需要临时豁免请用 `/shield off`。

import {
  DEFAULTS,
  ENTITY_LABELS,
  ENTITY_SENSITIVITY,
  LIMITS,
  MEDIA_POLICIES,
  MODES,
  SENSITIVITY,
  SENSITIVITY_ORDER,
  SURFACE_KEYS,
} from './constants.js'

/** 把任意值收敛为字符串数组。 */
function toStringArray(value, fallback = []) {
  if (value === undefined || value === null) return [...fallback]
  if (typeof value === 'string') return value === '' ? [] : [value]
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item !== '')
  return [...fallback]
}

/** 把任意值收敛为布尔。 */
function toBool(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

/** 把任意值收敛为整数。 */
function toInt(value, fallback, min, max) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  const int = Math.trunc(num)
  if (int < min) return min
  if (int > max) return max
  return int
}

/**
 * 归一化配置。
 * @param {object|undefined} raw 原始配置。
 * @returns {object} 归一化后的配置。
 */
export function resolveConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  // 敏感度收敛阈值：只处理 ≥ 该级别的实体（仅在未显式配置 entities 时生效；
  // 显式列表视为用户意志，原样尊重）。
  const minLevel = Object.values(SENSITIVITY).includes(input.minLevel) ? input.minLevel : DEFAULTS.MIN_LEVEL
  const minOrder = SENSITIVITY_ORDER[minLevel]
  const defaultEntities = DEFAULTS.ENTITIES.filter(
    (entity) => (SENSITIVITY_ORDER[ENTITY_SENSITIVITY[entity] ?? 'low'] ?? 0) >= minOrder,
  )
  const entities = toStringArray(input.entities, defaultEntities)
    .filter((entity) => Object.prototype.hasOwnProperty.call(ENTITY_LABELS, entity))
  const surfacesInput = input.surfaces !== null && typeof input.surfaces === 'object' ? input.surfaces : {}
  const surfaces = {}
  for (const [key, type] of Object.entries(SURFACE_KEYS)) {
    surfaces[key] = toBool(surfacesInput[key], true)
    surfaces[type] = surfaces[key]
  }
  const filterInput = input.sessionFilter !== null && typeof input.sessionFilter === 'object' ? input.sessionFilter : {}
  const auditInput = input.audit !== null && typeof input.audit === 'object' ? input.audit : {}
  /** 配置层面的提示（不阻断启动）。 */
  const notices = []
  if (Object.keys(filterInput).length > 0) {
    notices.push('sessionFilter 已被忽略：DSH 的消息投影 API 不区分会话，护盾只能全局生效；'
      + '需要临时豁免请用 /shield off。')
  }
  // 缺省 → 默认模式（enforce）；显式写了但不认识 → observe（拼错时宁可少改写，也不要悄悄多改写）。
  const mode = input.mode === undefined || input.mode === null
    ? DEFAULTS.MODE
    : (input.mode === MODES.ENFORCE ? MODES.ENFORCE : MODES.OBSERVE)
  return {
    enabled: toBool(input.enabled, DEFAULTS.ENABLED),
    mode,
    notices,
    entities: entities.length > 0 ? entities : [...defaultEntities],
    terms: toStringArray(input.terms, []),
    termsFile: typeof input.termsFile === 'string' && input.termsFile !== '' ? input.termsFile : null,
    rulesPack: typeof input.rulesPack === 'string' && input.rulesPack !== '' ? input.rulesPack : null,
    surfaces,
    mediaPolicy: input.mediaPolicy === MEDIA_POLICIES.STRIP ? MEDIA_POLICIES.STRIP : MEDIA_POLICIES.PASS,
    placeholderHash: input.placeholderHash === 'legacy' ? 'legacy' : DEFAULTS.PLACEHOLDER_HASH,
    minLevel,
    addressLevel: input.addressLevel === 'street' ? 'street' : DEFAULTS.ADDRESS_LEVEL,
    disabledLabels: toStringArray(input.disabledLabels, DEFAULTS.DISABLED_LABELS)
      .map((label) => label.toUpperCase()),
    audit: {
      jsonl: toBool(auditInput.jsonl, DEFAULTS.AUDIT_JSONL),
      jsonlPath: typeof auditInput.jsonlPath === 'string' && auditInput.jsonlPath !== '' ? auditInput.jsonlPath : null,
      verifyOutbound: auditInput.verifyOutbound === 'off'
        ? 'off'
        : (auditInput.verifyOutbound === 'sample' ? 'sample' : 'full'),
      maxVerifyChars: toInt(auditInput.maxVerifyChars, 2_000_000, 10_000, 20_000_000),
      retentionDays: toInt(auditInput.retentionDays, DEFAULTS.AUDIT_RETENTION_DAYS, 0, 3650),
    },
    onUnmaskable: input.onUnmaskable === 'block' ? 'block' : DEFAULTS.ON_UNMASKABLE,
    registerProjections: toBool(input.registerProjections, DEFAULTS.REGISTER_PROJECTIONS),
    registerCommand: toBool(input.registerCommand, DEFAULTS.REGISTER_COMMAND),
    registerTools: toBool(input.registerTools, DEFAULTS.REGISTER_TOOLS),
    maxVaultEntries: toInt(input.maxVaultEntries, DEFAULTS.MAX_VAULT_ENTRIES, LIMITS.MIN_VAULT_ENTRIES, LIMITS.MAX_VAULT_ENTRIES),
  }
}
