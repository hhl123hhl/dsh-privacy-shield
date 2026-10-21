// lib/patterns.js — 通用 PII 正则检测器集合（零依赖）。
//
// 每条 pattern：{ entity, source(带 g 的正则), score(0-1 置信度), group?(取哪个捕获组) }。
// 说明：
// - 检测统一在"归一化文本"（NFKC + 小写）上跑，命中后按偏移映射回原文，见 lib/engine.js。
// - score 参与重叠消解：同起点取高分；先到先得的前提下，18 位身份证会赢过 16-19 位银行卡。
// - 这里只放"模式明确"的检测器；中文机构/项目/人名等需要回溯与引导词的放在 lib/detectors-cn.js。

/** 通用 PII / 凭证正则。 */
export const BUILTIN_PATTERNS = Object.freeze([
  // --- 身份与联系
  { entity: 'phone-cn', source: /(?<!\d)1[3-9]\d{9}(?!\d)/g, score: 0.95 },
  { entity: 'landline-cn', source: /(?<!\d)0\d{2,3}[-‐\s]?\d{7,8}(?:[-‐]\d{1,6})?(?!\d)/g, score: 0.8 },
  { entity: 'id-card-cn', source: /(?<!\d)\d{17}[\dXx](?!\d)/g, score: 0.92 },
  { entity: 'uscc', source: /(?<![0-9a-hj-npqrtuwxy])[0-9a-hj-npqrtuwxy]{18}(?![0-9a-hj-npqrtuwxy])/g, score: 0.75 },
  { entity: 'bank-card', source: /(?<!\d)\d{16,19}(?!\d)/g, score: 0.65 },
  { entity: 'email', source: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, score: 0.9 },
  { entity: 'passport-cn', source: /(?<![a-z0-9])[ekgdsph]\d{8}(?![a-z0-9])/g, score: 0.6 },
  { entity: 'plate-cn', source: /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][a-hj-np-z][a-hj-np-z0-9]{4,5}[a-hj-np-z0-9挂学警港澳]/g, score: 0.85 },
  { entity: 'case-no', source: /[（(]\d{4}[）)][\u4e00-\u9fa5a-z0-9]{0,12}?号/g, score: 0.9 },
  { entity: 'wechat', source: /(?:微信号|微信|wechat|weixin|wx)\s*[:：]\s*[a-z][-_a-z0-9]{5,19}/g, score: 0.9 },
  { entity: 'qq', source: /(?:qq|企鹅号)\s*[:：]?\s*[1-9]\d{4,11}/g, score: 0.7 },
  // --- 网络
  { entity: 'ipv4', source: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, score: 0.85 },
  { entity: 'ipv6', source: /(?<![0-9a-f:])(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}(?![0-9a-f:])/g, score: 0.8 },
  // --- 凭证与密钥
  { entity: 'api-key', source: /sk-[a-z0-9_-]{16,}/g, score: 0.95 },
  { entity: 'api-key', source: /gh[pousr]_[a-z0-9]{16,}/g, score: 0.95 },
  { entity: 'api-key', source: /xox[baprs]-[a-z0-9-]{10,}/g, score: 0.9 },
  { entity: 'api-key', source: /akia[0-9a-z]{16}/g, score: 0.9 },
  { entity: 'api-key', source: /bearer[ \t]+[a-z0-9._~+/=-]{8,}/g, score: 0.9 },
  { entity: 'api-key', source: /-----begin[^-]{0,40}private key-----[\s\S]*?-----end[^-]{0,40}private key-----/g, score: 0.99 },
  { entity: 'jwt', source: /eyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}/g, score: 0.9 },
  // --- 证件 / 账号 / 设备（v0.3.0 新增；引导词取组，只替换编号本体）
  { entity: 'social-insurance', source: /(?:社保|社会保障)号?(?:码)?\s*[:：]?\s*(\d{6,18})/g, score: 0.9, group: 1 },
  { entity: 'housing-fund', source: /公积金(?:账号|帐号|号)?\s*[:：]?\s*(\d{6,18})/g, score: 0.9, group: 1 },
  { entity: 'student-id', source: /(?:学号|学籍号|学生证号)\s*[:：]?\s*([a-z0-9]{4,20})/g, score: 0.9, group: 1 },
  { entity: 'medical-record', source: /(?:病历号|病案号|就诊卡号|住院号)\s*[:：]?\s*([a-z0-9]{4,20})/g, score: 0.9, group: 1 },
  { entity: 'imei', source: /(?:imei|设备号|序列号)\s*[:：]?\s*(\d{15})/g, score: 0.9, group: 1 },
  { entity: 'mac-address', source: /(?<![0-9a-f])[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}(?![0-9a-f])/g, score: 0.7 },
])

/** Luhn 校验（银行卡号验证，剔除正则误报）。 */
export function luhnValid(digits) {
  if (typeof digits !== 'string' || !/^\d{12,19}$/.test(digits)) return false
  let sum = 0
  let doubleIt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48
    if (doubleIt) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubleIt = !doubleIt
  }
  return sum % 10 === 0
}

/** 实体 → 该实体的 pattern 子集（按启用集合过滤。 */
export function patternsFor(entities) {
  const enabled = new Set(entities)
  return BUILTIN_PATTERNS.filter((pattern) => enabled.has(pattern.entity))
}
