// lib/constants.js — 词汇表、默认值、边界（零依赖）。
//
// 这里定义的是"协议"：占位符标签、实体名、默认启用集合、上限。
// 任何其它模块都从这里取词汇，避免字面量散落。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件 id（同时用于日志前缀）。 */
export const PLUGIN_NAME = 'shield'

/** 命令行名称（/shield ...）。 */
export const COMMAND_NAME = 'shield'

/** 模型可调用的自检工具名。 */
export const TOOL_SCAN = 'shield_scan'

/** 实体名 → 占位符标签。标签只含大写字母与数字，进占位符 <LABEL_hash>。 */
export const ENTITY_LABELS = Object.freeze({
  'phone-cn': 'PHONE',
  'landline-cn': 'TEL',
  email: 'EMAIL',
  'id-card-cn': 'IDCARD',
  'bank-card': 'BANKCARD',
  uscc: 'USCC',
  'case-no': 'CASENO',
  'plate-cn': 'PLATE',
  'passport-cn': 'PASSPORT',
  wechat: 'WECHAT',
  qq: 'QQ',
  ipv4: 'IP',
  ipv6: 'IPV6',
  'api-key': 'KEY',
  jwt: 'JWT',
  'cn-org': 'ORG',
  'cn-project': 'PROJ',
  'cn-system': 'SYS',
  'cn-address': 'ADDR',
  'cn-person': 'PERSON',
  'cn-id': 'IDNO',
  money: 'MONEY',
  term: 'TERM',
  'social-insurance': 'SOCIAL',
  'housing-fund': 'HOUSING',
  'student-id': 'STUDENT',
  'medical-record': 'MEDICAL',
  imei: 'IMEI',
  'mac-address': 'MAC',
})

/**
 * locale/zh.json 是显示名的唯一来源：
 *   - host 侧（CLI/报告/doctor）在模块加载时直接读它；
 *   - Web UI 侧的镜像由 `node tools/sync-client.mjs` 生成到 client.js。
 * 读不到就退化成空表：显示名回退成协议 id，绝不让插件起不来。
 */
function loadLocaleZh() {
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'locale', 'zh.json'), 'utf8'))
  } catch {
    return {}
  }
}

const LOCALE_ZH = loadLocaleZh()

/** 实体名 → 中文显示名（只用于 CLI/报告/文档文案；协议与占位符仍用 id / ENTITY_LABELS）。 */
export const ENTITY_NAMES_ZH = Object.freeze({ ...(LOCALE_ZH.entities ?? {}) })

/** 敏感度分级 → 中文显示名（报告用）。 */
export const SENSITIVITY_NAMES_ZH = Object.freeze({ ...(LOCALE_ZH.sensitivity ?? {}) })

/** 覆盖 surface 键 → 中文显示名（报告用）。 */
export const SURFACE_NAMES_ZH = Object.freeze({ ...(LOCALE_ZH.surfaces ?? {}) })

/** 取实体的中文显示名（未知 id 原样返回，绝不抛错）。 */
export function entityNameZh(id) {
  return Object.prototype.hasOwnProperty.call(ENTITY_NAMES_ZH, id) ? ENTITY_NAMES_ZH[id] : String(id)
}

/** 取 surface 的中文显示名（未知键原样返回）。 */
export function surfaceNameZh(key) {
  return Object.prototype.hasOwnProperty.call(SURFACE_NAMES_ZH, key) ? SURFACE_NAMES_ZH[key] : String(key)
}

/** 默认启用的实体：中文专有名词/编号默认开，IPv4/IPv6 默认关（技术文本误报高）。 */
export const DEFAULT_ENTITIES = Object.freeze([
  'phone-cn',
  'landline-cn',
  'email',
  'id-card-cn',
  'bank-card',
  'uscc',
  'case-no',
  'plate-cn',
  'passport-cn',
  'wechat',
  'qq',
  'api-key',
  'jwt',
  'cn-org',
  'cn-project',
  'cn-system',
  'cn-address',
  'cn-person',
  'cn-id',
  'term',
  'social-insurance',
  'housing-fund',
  'student-id',
  'medical-record',
  'imei',
  'mac-address',
])

/** 实体敏感度分级（供 minLevel 收敛处理范围）。 */
export const ENTITY_SENSITIVITY = Object.freeze({
  // 高：直接可识别自然人/金融账户/凭证。
  'id-card-cn': 'high',
  'bank-card': 'high',
  'phone-cn': 'high',
  'passport-cn': 'high',
  'social-insurance': 'high',
  'housing-fund': 'high',
  imei: 'high',
  'api-key': 'high',
  jwt: 'high',
  // 中：间接识别或场景敏感。
  email: 'medium',
  'landline-cn': 'medium',
  'case-no': 'medium',
  'plate-cn': 'medium',
  wechat: 'medium',
  qq: 'medium',
  ipv4: 'medium',
  ipv6: 'medium',
  'mac-address': 'medium',
  'student-id': 'medium',
  'medical-record': 'medium',
  'cn-address': 'medium',
  'cn-person': 'medium',
  money: 'medium',
  // 低：组织/项目/系统级专有名词。
  uscc: 'low',
  'cn-org': 'low',
  'cn-project': 'low',
  'cn-system': 'low',
  'cn-id': 'low',
  term: 'low',
})

/** 敏感度取值与比较序。 */
export const SENSITIVITY = Object.freeze({ LOW: 'low', MEDIUM: 'medium', HIGH: 'high' })
export const SENSITIVITY_ORDER = Object.freeze({ low: 0, medium: 1, high: 2 })

/** 需要在文档里注明"默认关闭"的实体。 */
export const OPT_IN_ENTITIES = Object.freeze(['ipv4', 'ipv6'])

/** 表面（surface）消息类型 → 投影类型。 */
export const SURFACE_TYPES = Object.freeze([
  'system/message',
  'developer/message',
  'user/message',
  'assistant/message',
  'tool/result',
])

/** `surfaces` 配置键 → 事件类型。 */
export const SURFACE_KEYS = Object.freeze({
  system: 'system/message',
  developer: 'developer/message',
  user: 'user/message',
  assistant: 'assistant/message',
  tool: 'tool/result',
})

/**
 * 占位符形态：`<LABEL_8位小写十六进制>`。
 * 标签 1-16 个大写字母/数字；哈希固定 8 位，便于流式还原时判断"可能是半个占位符"。
 */
export const PLACEHOLDER_RE = /<([A-Z][A-Z0-9]{0,15})_([0-9a-f]{8})>/g

/** 可能是"尚未收全的占位符"的尾串（流式还原的保留判定）。 */
export const PARTIAL_PLACEHOLDER_RE = /^<[A-Z][A-Z0-9]{0,15}(?:_[0-9a-f]{0,8})?$/

/**
 * 宽松占位符形态：大小写/分隔符容错（2026-10-21 自 privacy-shield 回灌）。
 *
 * 模型可能改写占位符格式（`<phone_…>`、`<PHONE …>`），精确匹配会漏还原。
 * 归一化（label 大写 + hash 小写 + 统一 `_`）后再查表——只折叠大小写与空白，
 * 不同真值的 HMAC 哈希不同，不会串还原到别的实体；查不到则原样保留。
 */
export const LOOSE_PLACEHOLDER_RE = /<\s*([A-Za-z][A-Za-z0-9]{0,15})[\s\-_]+([0-9a-fA-F]{8})\s*>/g

/** 宽松版"未收全的占位符"尾串（流式扣留判定）。
 *  与 LOOSE_PLACEHOLDER_RE 严格对齐：必须已有"标签 + 分隔符"才算候选——
 *  裸 `<world` 这类普通尖括号文本不扣留（保持即时放行的时序语义）；
 *  十六进制部分允许 0-8 位（还没收全）；完整形态以 `>` 结尾，不匹配本正则，
 *  会直接走 restore 的宽松匹配即时还原。 */
export const LOOSE_PARTIAL_PLACEHOLDER_RE = /^<[A-Za-z][A-Za-z0-9]{0,15}[\s\-_][0-9a-fA-F]{0,8}$/

/** 词表行里的分类标签：`某公司 @company`。 */
export const TERM_CATEGORIES = Object.freeze({
  company: 'ORG',
  org: 'ORG',
  project: 'PROJ',
  system: 'SYS',
  id: 'IDNO',
  address: 'ADDR',
  person: 'PERSON',
  other: 'TERM',
})

/** 词表条目的默认标签（无 @category 时）。 */
export const TERM_DEFAULT_LABEL = 'TERM'

/**
 * 规则包格式版本（导入 / 导出用）。
 * 规则包只含"词表 + 实体开关"这类配置，**永远不含还原表（vault）里的真值**。
 */
export const RULES_SCHEMA = 'dsh-shield.rules/v1'

/** 边界。 */
export const LIMITS = Object.freeze({
  /** 单次检测的最大文本长度：超长文本直接跳过，避免病态输入拖垮一步。 */
  MAX_TEXT_LENGTH: 2_000_000,
  /** 单个词条的最大长度。 */
  MAX_TERM_LENGTH: 200,
  /** 词表条目数上限。 */
  MAX_TERMS: 20_000,
  /** 正则词表项上限（正则比字面词条贵得多）。 */
  MAX_REGEX_TERMS: 500,
  /** 还原表条目上限（超出按最旧逐出）。 */
  MIN_VAULT_ENTRIES: 100,
  MAX_VAULT_ENTRIES: 200_000,
  /** 中文机构名回溯前缀的最大长度。 */
  MAX_ORG_PREFIX: 40,
  /** 学习态条目上限：进程内"已确认真值"的缓存，防病态数据吃满内存。 */
  MAX_LEARNED: 20_000,
})

/** 运行模式。 */
export const MODES = Object.freeze({
  /** 真正改写模型可见面。 */
  ENFORCE: 'enforce',
  /** 只统计与自检，绝不改写（开发期 / 灰度）。 */
  OBSERVE: 'observe',
})

/** 媒体策略。 */
export const MEDIA_POLICIES = Object.freeze({
  PASS: 'pass',
  STRIP: 'strip',
})

/** 默认值。 */
export const DEFAULTS = Object.freeze({
  ENABLED: true,
  /** 默认就真改写：装了不生效的隐私工具比没装更危险。 */
  MODE: MODES.ENFORCE,
  ENTITIES: DEFAULT_ENTITIES,
  MEDIA_POLICY: MEDIA_POLICIES.PASS,
  MAX_VAULT_ENTRIES: 5000,
  REGISTER_COMMAND: true,
  REGISTER_TOOLS: true,
  /** 是否注册消息投影（false = 只审计、不改模型可见面；适合灰度与热更新）。 */
  REGISTER_PROJECTIONS: true,
  /** 出境请求里仍发现明文时的兜底策略。 */
  ON_UNMASKABLE: 'warn',
  /** 审计 JSONL 默认落盘（v0.3.0 起）：只有计数与标签，不含明文。 */
  AUDIT_JSONL: true,
  /** 审计保留天数（0 = 永久保留）。 */
  AUDIT_RETENTION_DAYS: 30,
  /** 占位符哈希：hmac（HMAC-SHA256，需密钥）| legacy（FNV-1a，可猜值确认，勿用于高威胁场景）。 */
  PLACEHOLDER_HASH: 'hmac',
  /** 敏感度收敛阈值：只处理 ≥ 该级别的实体（仅在未显式配置 entities 时生效）。 */
  MIN_LEVEL: 'low',
  /** 中文地址脱敏粒度：full（整段）| street（保留到街道/路，抹掉门牌）。 */
  ADDRESS_LEVEL: 'full',
  DISABLED_LABELS: [],
})
