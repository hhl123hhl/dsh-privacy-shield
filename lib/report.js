// lib/report.js — /shield 命令的输出渲染（零依赖）。
//
// 硬规则：这里渲染的任何内容都不得包含原文。
// 只输出计数、标签分布、占位符化的文本。

import { MODES, RULES_SCHEMA, entityNameZh, surfaceNameZh, SENSITIVITY_NAMES_ZH } from './constants.js'
import { countPlaceholders } from './engine.js'

/** 把 {LABEL: n} 渲染成一行。 */
function labelLine(byLabel) {
  const entries = Object.entries(byLabel ?? {})
  if (entries.length === 0) return '  （无）'
  return entries
    .sort((left, right) => right[1] - left[1])
    .map(([label, count]) => `  ${label}: ${count}`)
    .join('\n')
}

/**
 * 状态总览。
 * @param {import('./runtime.js').ShieldRuntime} runtime 运行时。
 * @param {object} config 归一化配置。
 * @param {string} sessionId 当前会话 id。
 * @returns {string} 文本。
 */
export function formatStatus(runtime, config, sessionId) {
  const snap = runtime.snapshot()
  const lines = [
    `【隐私护盾 dsh-privacy-shield】模式=${snap.mode === 'enforce' ? 'enforce（改写）' : 'observe（仅统计）'} 护盾=${snap.active ? '开' : '关'}${snap.pausedRemainingMin > 0 ? `　⏸ 暂停放行中（剩余 ${snap.pausedRemainingMin} 分钟，到期自动恢复）` : ''}　生效范围=所有会话（全局）`,
    `当前会话：${sessionId === '' || sessionId === undefined ? '（未知）' : sessionId}（仅用于审计标注）`,
    `实体：${config.entities.length} 类（${config.entities.map((id) => entityNameZh(id)).join('、')}）`,
    `覆盖 surface：${snap.surfaces.map((key) => surfaceNameZh(key)).join('、') || '（无）'}`,
    `模型可见面脱敏（derive 补丁）：${snap.derivePatchInstalled ? '已装' : '未装'}${snap.mode === 'enforce' && snap.active ? '（模型只见占位符）' : '（未改写，只审计）'}`,
    `词表：${snap.terms} 条（字面 ${snap.termKinds?.literal ?? snap.terms} + 正则 ${snap.termKinds?.regex ?? 0}，版本 v${snap.termsVersion ?? 0}）　还原表：${snap.vault} 条`,
    `词表标签分布：\n${labelLine(snap.termsByLabel)}`,
    `引擎：哈希=${snap.placeholderHash === 'hmac' ? `HMAC-SHA256（密钥：${snap.keySource === 'file' ? '本地文件' : '内存'}）` : 'legacy FNV-1a（可猜值确认，慎用）'}　分级≥${SENSITIVITY_NAMES_ZH[snap.minLevel] ?? snap.minLevel}　地址=${snap.addressLevel}${(snap.disabledLabels ?? []).length > 0 ? `　停用标签：${snap.disabledLabels.join(',')}` : ''}`,
    `媒体策略：${config.mediaPolicy}（图片不做内容识别：本插件不负责图片内容的隐私保护）`,
    `未脱敏兜底：${snap.onUnmaskable}　出境复核：${config.audit.verifyOutbound}`,
    `审计落盘：${config.audit.jsonl ? (config.audit.jsonlPath ?? '（默认路径）') : '关闭'}`,
    '',
    '—— 统计（只含计数，不含明文）——',
    `改写文本片段：${snap.maskedTexts}`,
    `按类型分布：\n${labelLine(snap.byLabel)}`,
    `模型调用拦截：${snap.streamCalls} 次　出境请求审计：${snap.outboundRequests} 次`,
    `出境占位符合计：${snap.outboundPlaceholders}\n${labelLine(snap.outboundByLabel)}`,
    `响应还原次数：${snap.restoredValues}`,
    `明文残留告警：${snap.violations}`,
  ]
  if (snap.lastViolation !== null) {
    lines.push(`最近一次残留：${new Date(snap.lastViolation.at).toLocaleString()} `
      + `session=${snap.lastViolation.sessionId ?? '-'} 类型=${snap.lastViolation.labels.join(',')} `
      + `手搓请求=${snap.lastViolation.handBuilt ? '是' : '否'}`)
  }
  if (!snap.active) lines.push('提示：当前 /shield off，模型可见面未脱敏。')
  if (runtime.warnings.length > 0) {
    lines.push('', '—— 警告 ——')
    for (const warning of runtime.warnings.slice(-5)) lines.push(`  ${warning}`)
  }
  if (snap.errors.length > 0) {
    lines.push('', '—— 最近错误 ——')
    for (const error of snap.errors.slice(-5)) lines.push(`  [${error.where}] ${error.message}`)
  }
  lines.push(
    '',
    '运维提示：本插件用 derive 补丁改写"模型可见面"；改动插件后必须重启 profile，',
    '不要在会话进行中热关插件（热关后模型可见面恢复明文，重开后重新脱敏）。',
  )
  return lines.join('\n')
}

/**
 * 自检：无参显示审计结论；带文本则试跑脱敏。
 * @param {import('./runtime.js').ShieldRuntime} runtime 运行时。
 * @param {string} text 可选测试文本。
 * @returns {string} 文本。
 */
export function formatVerify(runtime, text) {
  if (typeof text !== 'string' || text.trim() === '') {
    const snap = runtime.snapshot()
    const lines = [
      '【出境自检】',
      `已审计出境请求：${snap.outboundRequests} 次，占位符合计 ${snap.outboundPlaceholders} 个。`,
      labelLine(snap.outboundByLabel),
      snap.violations === 0
        ? '明文残留：0 处 ✅（enforce 模式下每次出境请求都会重跑检测器复核）'
        : `明文残留：${snap.violations} 处 ⚠️ 见 /shield status 的"最近一次残留"`,
      '',
      '用法：/shield verify <一段文本> 可以试跑脱敏，输出只含占位符化结果，不回显原文。',
    ]
    if (snap.mode === MODES.OBSERVE) {
      lines.push('', '注意：当前是 observe 模式，模型可见面并未被改写，因此出境请求里仍会有明文。')
    }
    return lines.join('\n')
  }
  const { text: masked, hits } = runtime.engine.mask(text)
  const byLabel = Object.create(null)
  for (const hit of hits) byLabel[hit.label] = (byLabel[hit.label] ?? 0) + 1
  const counted = countPlaceholders(masked)
  return [
    `【试跑脱敏】命中 ${hits.length} 处，生成占位符 ${counted.total} 个。`,
    labelLine(byLabel),
    '',
    '脱敏结果（原文不会显示）：',
    masked,
  ].join('\n')
}

/**
 * `/shield help`：命令用法。
 * @returns {string} 文本。
 */
export function formatHelp() {
  return [
    '【隐私护盾 dsh-privacy-shield】命令用法',
    '',
    '/shield                      同 status：模式、覆盖范围、统计、警告',
    '/shield on                   开启：模型可见面使用脱敏副本（enforce）',
    '/shield off confirm          关闭：不再改写送云端的文本（需 confirm）',
    '/shield enforce              切到 enforce：真正改写模型可见面',
    '/shield observe confirm      切到 observe：只统计不改写（需 confirm）',
    '/shield pause <分钟>         临时放行（明文出境），到期自动恢复（1–720）',
    '/shield doctor               逐项体检：补丁/模式/词表/密钥/审计',
    '/shield verify [文本]        无参=出境审计结论；带参=试跑脱敏（不回显原文）',
    '/shield terms                词表条数与标签分布',
    '/shield terms label off|on <LABEL>  按标签停用/恢复词表条目',
    '/shield terms adopt <序号…|all>     采纳 scan-doc/learn 候选（30 分钟内有效）',
    '/shield scan-doc <路径>      扫描本地文档抽候选专名（txt/md/csv/json/代码/docx）',
    '/shield learn                从本地会话历史学习高频未命中片段',
    '/shield vault                还原表条数与标签分布（不显示真值）',
    '/shield rules                规则包格式与当前导出位置',
    '/shield export [路径] [--encrypt <口令>]  导出规则包；--encrypt 用 AES-256-GCM 加密',
    '/shield import <路径> [--pass <口令>] [replace confirm]  导入规则包；默认合并，replace 覆盖词表',
    '/shield audit [天数]         出境审计聚合（只含计数）',
    '/shield audit export <路径>  导出审计聚合 CSV',
    '/shield help                 本说明',
    '',
    '工作方式：本地日志与界面始终是真值；只有送到模型的可见面被替换成',
    '占位符（例如 <ORG_3f9a1c2d>），模型回复里的占位符在本地自动换回真值。',
    '',
    '注意：改动插件后需要重启 profile。热关本插件只是摘掉 derive 补丁，',
    '会话与日志不受影响；重开插件后新请求重新脱敏。',
  ].join('\n')
}

/**
 * `/shield doctor`：逐项体检，✅ 正常 / ⚠️ 需要关注。
 * @param {import('./runtime.js').ShieldRuntime} runtime 运行时。
 * @param {object} config 归一化配置。
 * @param {string} version 插件版本。
 * @returns {string} 文本。
 */
export function formatDoctor(runtime, config, version) {
  const snap = runtime.snapshot()
  const lines = ['【隐私护盾 doctor】逐项体检（✅ 正常 / ⚠️ 需要关注）', '']
  const push = (ok, name, detail) => lines.push(`  ${ok ? '✅' : '⚠️'} ${name}${detail === '' || detail === undefined ? '' : `：${detail}`}`)

  push(snap.derivePatchInstalled, 'derive 补丁（模型可见面脱敏）', snap.derivePatchInstalled ? '已装，模型只见占位符' : '未装：模型可见面仍是明文')
  push(snap.active, '护盾开关', snap.active ? '开' : '关（/shield on 开启）')
  if (snap.active) {
    push(snap.mode === MODES.ENFORCE, '工作模式', snap.mode === MODES.ENFORCE ? 'enforce（真改写）' : 'observe（明文出境，仅统计）')
  }
  push(snap.pausedRemainingMin === 0, '暂停放行', snap.pausedRemainingMin > 0 ? `进行中，剩余 ${snap.pausedRemainingMin} 分钟` : '未暂停')
  push(snap.placeholderHash === 'hmac', '占位符哈希', snap.placeholderHash === 'hmac'
    ? `HMAC-SHA256（密钥：${snap.keySource === 'file' ? '本地文件' : '内存（进程重启后占位符变化，词表需重新确认）'}）`
    : 'legacy FNV-1a：占位符可被枚举反推，生产环境建议配置 placeholderHash: hmac')
  push(snap.terms > 0, '词表', snap.terms > 0
    ? `${snap.terms} 条（字面 ${snap.termKinds?.literal ?? snap.terms} + 正则 ${snap.termKinds?.regex ?? 0}，版本 v${snap.termsVersion ?? 0}）`
    : '空：默认实体只能盖住通用 PII，专有名词建议 scan-doc/learn 建词表')
  push(config.audit.jsonl === true, '审计落盘', config.audit.jsonl ? (config.audit.jsonlPath ?? '默认路径') : '关闭（audit.jsonl=false，无法追溯出境历史）')
  push(snap.violations === 0, '明文残留告警', snap.violations === 0 ? '0' : `${snap.violations} 处，见 /shield status`)
  push(snap.errors.length === 0, '运行期错误', snap.errors.length === 0 ? '无' : `${snap.errors.length} 条，见 /shield status`)

  lines.push('', `版本：${version}　实体：${config.entities.length} 类　还原表：${snap.vault} 条　会话：${snap.sessions} 个`)
  return lines.join('\n')
}

/**
 * `/shield rules`：规则包格式与位置。
 * @param {import('./runtime.js').ShieldRuntime} runtime 运行时。
 * @param {object} config 归一化配置。
 * @param {string} version 插件版本。
 * @returns {string} 文本。
 */
export function formatRules(runtime, config, version) {
  const terms = runtime.snapshot().terms
  return [
    '【规则包 rules pack】',
    `格式：${RULES_SCHEMA}（JSON，UTF-8）`,
    `插件版本：${version}`,
    `当前实体：${config.entities.length} 类`,
    `当前词表：${terms} 条`,
    `启动期规则包：${config.rulesPack ?? '（未配置）'}`,
    `启动期词表文件：${config.termsFile ?? '（未配置）'}`,
    '',
    '导出：/shield export [路径]（省略路径则写入 $DSH_HOME/shield/ 下的默认文件）',
    '导入：/shield import <路径> [replace]',
    '随插件启动载入：在 cordis.patch.yml 里配置 rulesPack: "<绝对路径>"',
    '',
    '安全边界：规则包**只含词表与实体开关，不含任何还原表/真值**；',
    '但词表本身往往是敏感专有名词（公司名、项目名、系统名、编号前缀），',
    '导出与分享时请按同等密级保管。导入的规则包在导入时校验：',
    '拒绝包含 vault/values/secrets/plaintext/restore 字段的文件。',
  ].join('\n')
}
