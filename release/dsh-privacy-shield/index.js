// index.js — dsh-privacy-shield 宿主半边（Host half）。
//
// 职责：
//   1. 给 Session.deriveEventMessage 打 derive 补丁 → 模型可见面脱敏，本地记录面不动。
//   2. 拦截 llm/stream → 响应流占位符还原成真值 + 手搓请求兜底 + 出境审计。
//   3. 注册 /shield 命令（状态、自检、开关、词表、规则包导入导出）与 shield_scan 工具。
// 浏览器半边见 client.js。

import { createRequire } from 'node:module'

import {
  COMMAND_NAME,
  MODES,
  PLUGIN_NAME,
  RULES_SCHEMA,
  TOOL_SCAN,
} from './lib/constants.js'
import { resolveConfig } from './lib/config.js'
import { ShieldRuntime } from './lib/runtime.js'
import { installDerivePatch } from './lib/derive-patch.js'
import { createStreamHandler } from './lib/stream.js'
import { createScanTool } from './lib/tool.js'
import { scanDocument } from './lib/scan-doc.js'
import { learnFromSessions } from './lib/learn.js'
import { formatDoctor, formatHelp, formatRules, formatStatus, formatVerify } from './lib/report.js'
import {
  aggregateAudit,
  auditPath,
  auditToCsv,
  enforceAuditRetention,
  formatAuditReport,
  readAuditEntries,
} from './lib/audit.js'
import { decryptPackText, isEncryptedPackText, encryptPackText } from './lib/pack-crypto.js'
import {
  appendJsonLine,
  buildRulesPack,
  defaultRulesPath,
  mergeTermLines,
  parseRulesPackText,
  parseTermsFileText,
  readTextFile,
  resolveRulesPath,
  serializeRulesPack,
  writeTextFile,
} from './lib/rules.js'

const require = createRequire(import.meta.url)

/** 读取自身版本号（用于规则包与状态展示）。 */
export function pluginVersion() {
  try {
    return require('./package.json').version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** 简易日志封装：优先用宿主 logger，退化到 console。 */
function makeLogger(ctx) {
  const logger = ctx?.logger
  const wrap = (level) => (message) => {
    try {
      if (typeof logger?.[level] === 'function') logger[level](`[${PLUGIN_NAME}] ${message}`)
      else if (typeof console?.[level] === 'function') console[level](`[${PLUGIN_NAME}] ${message}`)
    } catch { /* 日志失败不影响主流程 */ }
  }
  return { info: wrap('info'), warn: wrap('warn'), error: wrap('error') }
}

/**
 * 从配置源（rulesPack → termsFile → terms）收集启动词表。
 * 任何失败都降级为警告消息，绝不让 profile 起不来。
 * @param {object} config 归一化配置。
 * @param {object} log 日志。
 * @returns {{terms: string[], messages: string[]}} 合并后的词表与提示。
 */
function collectStartupTerms(config, log) {
  let terms = []
  const messages = []
  let packEntities = null
  if (config.rulesPack !== null) {
    try {
      const path = resolveRulesPath(config.rulesPack)
      const { pack, warnings } = parseRulesPackText(readTextFile(path))
      terms = [...pack.terms]
      if (pack.entities.length > 0) {
        packEntities = pack.entities
        messages.push(`规则包指定实体 ${pack.entities.length} 类`)
      }
      for (const warning of warnings) messages.push(`规则包：${warning}`)
      messages.push(`已载入规则包 ${path}（词表 ${pack.terms.length} 条）`)
    } catch (error) {
      messages.push(`规则包载入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (config.termsFile !== null) {
    try {
      const path = resolveRulesPath(config.termsFile)
      const parsed = parseTermsFileText(readTextFile(path))
      const merged = mergeTermLines(terms, parsed.terms)
      terms = merged.terms
      messages.push(`已载入词表文件 ${path}（新增 ${merged.added} 条，跳过 ${parsed.skipped} 行）`)
    } catch (error) {
      messages.push(`词表文件载入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  void log
  const merged = mergeTermLines(terms, config.terms)
  return { terms: merged.terms, messages, packEntities }
}

/**
 * 启动期载入词表（见 collectStartupTerms）。热重载复用同一函数，保证语义一致。
 * @param {ShieldRuntime} runtime 运行时。
 * @param {object} config 归一化配置。
 * @param {object} log 日志。
 * @returns {void}
 */
function loadStartupRules(runtime, config, log) {
  const { terms, messages, packEntities } = collectStartupTerms(config, log)
  if (Array.isArray(packEntities)) runtime.config.entities = packEntities
  for (const message of messages) {
    runtime.warnings.push(message)
    log.info(message)
  }
  runtime.replaceTerms(terms)
}

/**
 * 词表文件热重载（fs.watch 防抖）：文件变化后用与启动一致的源重建词表。
 * 注意：这是"配置源重建"，进程内新增（UI/命令 adopt 等）会被配置源覆盖——日志里明示。
 * @param {ShieldRuntime} runtime 运行时。
 * @param {object} config 归一化配置。
 * @param {object} log 日志。
 * @returns {(() => void)|undefined} disposer。
 */
function watchTermsFile(runtime, config, log) {
  if (config.termsFile === null) return undefined
  const { watch } = require('node:fs')
  let path
  try {
    path = resolveRulesPath(config.termsFile)
  } catch {
    return undefined
  }
  if (path === null) return undefined
  let timer = null
  let watcher = null
  let disposed = false
  const reload = () => {
    try {
      const { terms, messages, packEntities } = collectStartupTerms(config, log)
      if (Array.isArray(packEntities)) runtime.config.entities = packEntities
      const before = runtime.engine.termCount
      runtime.replaceTerms(terms)
      log.info(`词表热重载：${before} → ${runtime.engine.termCount} 条（按配置源重建；进程内新增已被覆盖）`)
      for (const message of messages) log.info(message)
    } catch (error) {
      log.warn(`词表热重载失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const schedule = () => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; reload() }, 300)
    if (typeof timer.unref === 'function') timer.unref()
  }
  const start = () => {
    if (disposed) return
    try {
      watcher = watch(path, { persistent: false }, () => schedule())
      watcher.on('error', () => {
        // 文件被删/换名等：稍后重试挂 watcher。
        try { watcher?.close() } catch { /* 忽略 */ }
        watcher = null
        const retry = setTimeout(start, 2000)
        if (typeof retry.unref === 'function') retry.unref()
      })
    } catch {
      watcher = null
      if (!disposed) {
        const retry = setTimeout(start, 2000)
        if (typeof retry.unref === 'function') retry.unref()
      }
    }
  }
  start()
  return () => {
    disposed = true
    if (timer !== null) clearTimeout(timer)
    try { watcher?.close() } catch { /* 忽略 */ }
  }
}

/**
 * 出境审计落盘（JSONL：每行一条，**不含任何真值**）。
 * @param {object} config 归一化配置。
 * @param {object} log 日志。
 * @returns {(record: object) => void} 写入函数。
 */
function makeAuditSink(config, log) {
  if (!config.audit.jsonl) return () => {}
  const path = config.audit.jsonlPath !== null
    ? resolveRulesPath(config.audit.jsonlPath)
    : resolveRulesPath('audit.jsonl')
  enforceAuditRetention(path, config.audit.retentionDays)
  let warned = false
  return (record) => {
    const ok = appendJsonLine(path, { plugin: 'dsh-privacy-shield', version: pluginVersion(), ...record })
    if (!ok && !warned) {
      warned = true
      log.warn(`出境审计写入失败：${path}`)
    }
  }
}

/**
 * 插件入口。
 * @param {object} ctx Cordis 上下文。
 * @param {object} rawConfig 来自 cordis.patch.yml 的配置。
 * @returns {ShieldRuntime|undefined} 运行时（便于测试/诊断）。
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  if (!config.enabled) return undefined

  const runtime = new ShieldRuntime(config)
  const log = makeLogger(ctx)
  loadStartupRules(runtime, config, log)
  const auditSink = makeAuditSink(config, log)

  // ---- 0.5 词表文件热重载（配置热更新仍要求重启 profile，见文档）----
  try {
    const disposeWatcher = watchTermsFile(runtime, config, log)
    if (typeof disposeWatcher === 'function' && typeof ctx.effect === 'function') {
      ctx.effect(() => disposeWatcher, 'dsh-privacy-shield:terms-watch')
    }
  } catch (error) {
    log.warn(`词表热重载不可用：${error instanceof Error ? error.message : String(error)}`)
  }

  // ---- 1. 模型可见面脱敏（derive 补丁；不用 registerMessageProjection，见 lib/derive-patch.js 头注）----
  if (!config.registerProjections) {
    runtime.warnings.push('registerProjections=false：只做审计，不改写模型可见面')
  } else {
    const installDerive = (sessionCtx) => {
      const patchFromSession = (session) => {
        try {
          if (installDerivePatch(session?.constructor, runtime, log)) {
            runtime.derivePatchInstalled = true
          } else {
            runtime.warnings.push('derive 脱敏补丁未装上：Session 结构不符合预期')
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          runtime.warnings.push(`derive 补丁安装失败：${message}`)
          log.warn(`derive 补丁安装失败：${message}`)
        }
      }
      sessionCtx.effect(() => {
        // 已在店的会话直接补（恢复/续跑场景可能早于插件注入）。
        try {
          const store = sessionCtx.sessions?.store
          if (store instanceof Map) for (const session of store.values()) patchFromSession(session)
        } catch { /* store 不可读就算了，还有事件兜底 */ }
        // 之后新建的会话走 session/created 事件。
        const off = typeof sessionCtx.on === 'function'
          ? sessionCtx.on('session/created', patchFromSession)
          : undefined
        return () => { if (typeof off === 'function') off() }
      }, 'dsh-privacy-shield:derive-patch')
    }
    if (typeof ctx.inject === 'function') ctx.inject(['sessions'], installDerive)
    else if (ctx.sessions !== undefined) installDerive(ctx)
  }

  // ---- 2. llm/stream：响应还原 + 手搓请求兜底 + 出境审计 ----
  ctx.on('llm/stream', createStreamHandler(runtime, { onAudit: auditSink }))

  // ---- 3. 命令 ----
  if (config.registerCommand) {
    const installCommand = (commandCtx) => {
      commandCtx.effect(() => commandCtx.commands.register({
        name: COMMAND_NAME,
        description: '隐私护盾：本地脱敏 / 云端只见占位符 / 展示真值（状态、自检、开关、词表、规则包）',
        input: { hint: 'status | on | off confirm | enforce | observe confirm | pause <分钟> | doctor | verify [文本] | terms [label off|on LABEL | adopt <序号…|all>] | scan-doc <路径> | learn | audit [天数] | audit export <路径> | vault | rules | export [路径] [--encrypt 口令] | import <路径> [--pass 口令] [replace confirm] | help' },
        handler: (invocation) => runCommand(invocation, { runtime, config, log }),
      }), 'dsh-privacy-shield:command')
    }
    if (typeof ctx.inject === 'function') ctx.inject(['commands'], installCommand)
    else if (ctx.commands !== undefined) installCommand(ctx)
  }

  // ---- 4. shield_scan 工具 ----
  if (config.registerTools) {
    const installTools = (toolCtx) => {
      toolCtx.effect(() => {
        try {
          return toolCtx.tools.register(createScanTool(runtime))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          runtime.warnings.push(`工具 ${TOOL_SCAN} 注册失败：${message}`)
          log.warn(`工具 ${TOOL_SCAN} 注册失败：${message}`)
          return () => {}
        }
      }, 'dsh-privacy-shield:tool')
    }
    if (typeof ctx.inject === 'function') ctx.inject(['tools'], installTools)
    else if (ctx.tools !== undefined) installTools(ctx)
  }

  // ---- 5. 浏览器半边（可选；缺失时安静跳过）----
  // client-rpc 是可选增强：没有它 UI 只显示"状态不可用"，不影响脱敏主链路。
  // 该模块自己负责 `ctx.inject(['connection'])` / `ctx.inject(['webServer'])`，这里只挂一次。
  wireClientRpc(ctx, runtime, log)

  for (const notice of config.notices ?? []) {
    runtime.warnings.push(notice)
    log.warn(notice)
  }
  log.info(`已挂载：模式=${runtime.mode}，实体=${config.entities.length} 类，`
    + `词表=${runtime.engine.termCount} 条，derive 补丁=${runtime.derivePatchInstalled ? '已装' : '未装'}，`
    + `护盾开关=${runtime.active ? '开' : '关'}（全局）`)

  return runtime
}

/**
 * 可选：把状态暴露给浏览器半边。缺失 client-rpc 模块时安静降级。
 * @param {object} ctx 上下文。
 * @param {ShieldRuntime} runtime 运行时。
 * @param {object} log 日志。
 * @returns {void}
 */
function wireClientRpc(ctx, runtime, log) {
  if (typeof ctx?.inject !== 'function') return
  import('./lib/client-rpc.js').then((mod) => {
    try {
      if (typeof mod?.registerClientRpc !== 'function') return
      // 模块内部用 ctx.inject + ctx.effect 自行管理生命周期（随 fiber 卸载），
      // 因此这里不重复包一层 effect；返回的 disposer 交给 fiber 即可。
      const dispose = mod.registerClientRpc(ctx, runtime, runtime.config)
      if (typeof dispose === 'function') ctx.effect(() => dispose, 'dsh-privacy-shield:client-rpc')
    } catch (error) {
      log.warn(`浏览器半边注册失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }).catch(() => { /* 浏览器半边不可用：不影响脱敏 */ })
}

/**
 * /shield 命令分发。
 * @param {object} invocation 命令调用。
 * @param {{runtime: ShieldRuntime, config: object, log: object}} deps 依赖。
 * @returns {object} 命令结果。
 */
function runCommand(invocation, deps) {
  const { runtime, config, log } = deps
  const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : ''
  const sessionId = invocation?.agent?.id ?? ''
  const [sub, ...rest] = raw === '' ? ['status'] : raw.split(/\s+/u)
  const argument = rest.join(' ')

  switch (sub) {
    case 'status':
      return { kind: 'success', text: formatStatus(runtime, config, sessionId) }
    case 'on':
      runtime.active = true
      runtime.setEnforcing(true)
      return {
        kind: 'success',
        text: '隐私护盾已开启：模型可见面使用脱敏副本（enforce），本地日志与界面仍是真值。',
      }
    case 'off': {
      if (!rest.includes('confirm')) {
        return {
          kind: 'error',
          text: '关闭护盾会让送云端的文本恢复明文。如确认，请执行：/shield off confirm',
        }
      }
      runtime.active = false
      return {
        kind: 'success',
        text: '隐私护盾已关闭：不再改写送云端的文本（本地内容本来就未被改写）。',
      }
    }
    case 'enforce':
      runtime.active = true
      runtime.setEnforcing(true)
      return { kind: 'success', text: '已切换到 enforce：模型可见面使用脱敏副本。' }
    case 'observe': {
      if (!rest.includes('confirm')) {
        return {
          kind: 'error',
          text: 'observe 模式不改写模型可见面，敏感文本将以明文出境。如确认，请执行：/shield observe confirm',
        }
      }
      runtime.active = true
      runtime.setEnforcing(false)
      return { kind: 'success', text: '已切换到 observe：只统计与自检，不改写模型可见面。' }
    }
    case 'audit':
      return runAuditCommand(runtime, config, argument)
    case 'verify':
      return { kind: 'success', text: formatVerify(runtime, argument) }
    case 'terms': {
      const parts = argument.trim().split(/\s+/u).filter((item) => item !== '')
      if (parts[0] === 'label' && parts.length >= 3
        && (parts[1] === 'off' || parts[1] === 'on')) {
        const result = runtime.toggleTermLabel(parts[2], parts[1] === 'off')
        if (!/^[A-Z][A-Z0-9]{0,15}$/.test(result.label)) {
          return { kind: 'error', text: `无效标签：${parts[2]}（应为占位符标签，如 ORG / PHONE / TERM）` }
        }
        return {
          kind: 'success',
          text: `标签 ${result.label} 已${result.disabled ? '停用（该类词表条目不再参与脱敏）' : '恢复'}，`
            + `当前词表 ${result.terms} 条。仅本进程生效；持久化请改 cordis.patch.yml 的 disabledLabels。`,
        }
      }
      if (parts[0] === 'adopt') {
        if (parts.length < 2) {
          return { kind: 'error', text: '用法：/shield terms adopt <序号…|all>（先用 scan-doc / learn 生成候选）' }
        }
        const result = runtime.adoptCandidates(parts.slice(1))
        if (result.stale) {
          return { kind: 'error', text: '候选池已过期（30 分钟有效）：请重新 /shield scan-doc <路径> 或 /shield learn。' }
        }
        if (result.adopted === 0) return { kind: 'error', text: '没有可采纳的候选（序号无效或候选为空）。' }
        return {
          kind: 'success',
          text: `已采纳 ${result.adopted} 条候选入词表（当前共 ${result.terms} 条，立即生效）。`
            + '持久化：/shield export 导出规则包，或写入 cordis.patch.yml 的 terms / termsFile。',
        }
      }
      return { kind: 'success', text: formatTerms(runtime) }
    }
    case 'scan-doc': {
      if (argument.trim() === '') return { kind: 'error', text: '用法：/shield scan-doc <文件路径>（支持 txt/md/csv/json/代码/docx）' }
      const path = resolveRulesPath(argument.trim())
      if (path === null) return { kind: 'error', text: '无效路径。' }
      let result
      try {
        result = scanDocument(path, runtime.engine)
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
      runtime.setCandidates(result.candidates)
      return { kind: 'success', text: formatCandidates(result.candidates, `扫描 ${result.path}（${result.bytes} 字节）`) }
    }
    case 'learn': {
      const result = learnFromSessions(runtime.engine)
      if (result.degraded !== undefined) return { kind: 'error', text: result.degraded }
      runtime.setCandidates(result.candidates)
      return { kind: 'success', text: formatCandidates(result.candidates, `扫描 ${result.scanned} 个会话文件的 ${result.texts} 条用户消息`) }
    }
    case 'vault':
      return { kind: 'success', text: formatVault(runtime) }
    case 'rules':
      return { kind: 'success', text: formatRules(runtime, config, pluginVersion()) }
    case 'pause': {
      const minutes = Number(rest[0])
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return { kind: 'error', text: '用法：/shield pause <分钟>（1–720，到期自动恢复；立即恢复用 /shield enforce）' }
      }
      const result = runtime.pause(minutes)
      return {
        kind: 'success',
        text: `已暂停 ${result.pausedRemainingMin} 分钟：期间不改写模型可见面（明文出境），审计继续记录并标注 paused。`
          + '到期自动恢复 enforce；也可随时 /shield enforce 立即恢复。',
      }
    }
    case 'doctor':
      return { kind: 'success', text: formatDoctor(runtime, config, pluginVersion()) }
    case 'export':
      return exportRules(runtime, config, argument)
    case 'import':
      return importRules(runtime, argument, log)
    case 'help':
    default:
      return { kind: 'success', text: formatHelp() }
  }
}

/**
 * `/shield audit [天数]` / `/shield audit export <路径>`：审计聚合与导出。
 * @param {ShieldRuntime} runtime 运行时。
 * @param {object} config 配置。
 * @param {string} argument 参数。
 * @returns {object} 命令结果。
 */
function runAuditCommand(runtime, config, argument) {
  if (!config.audit.jsonl) {
    return { kind: 'error', text: '审计落盘已关闭（audit.jsonl=false），没有可查询的数据。' }
  }
  const path = auditPath(config)
  if (path === null) return { kind: 'error', text: '审计路径无效。' }
  const parts = argument.trim().split(/\s+/u).filter((item) => item !== '')
  if (parts[0] === 'export') {
    const out = resolveRulesPath(parts.slice(1).join(' '))
    if (out === null) return { kind: 'error', text: '用法：/shield audit export <路径>' }
    const agg = aggregateAudit(readAuditEntries(path))
    try {
      writeTextFile(out, auditToCsv(agg))
    } catch (error) {
      return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
    }
    return { kind: 'success', text: `审计已导出（按天聚合 CSV）：${out}` }
  }
  const days = parts.length > 0 && /^\d+$/.test(parts[0]) ? Number(parts[0]) : 7
  const agg = aggregateAudit(readAuditEntries(path), days)
  return { kind: 'success', text: formatAuditReport(agg, path, days) }
}

/**
 * `/shield export [路径]`：把当前词表与实体开关写成规则包。
 * @param {ShieldRuntime} runtime 运行时。
 * @param {object} config 配置。
 * @param {string} argument 路径参数。
 * @returns {object} 命令结果。
 */
function exportRules(runtime, config, argument) {
  // 参数：[路径] [--encrypt 口令]。口令里不含空格的限制与路径一致（split 后按位置取）。
  const tokens = argument.trim().split(/\s+/u).filter((item) => item !== '')
  let passphrase = null
  const encIdx = tokens.findIndex((item) => item === '--encrypt')
  if (encIdx >= 0) {
    if (encIdx + 1 >= tokens.length) return { kind: 'error', text: '用法：/shield export [路径] --encrypt <口令>' }
    passphrase = tokens[encIdx + 1]
    tokens.splice(encIdx, 2)
  }
  const path = tokens.length === 0 ? defaultRulesPath() : resolveRulesPath(tokens.join(' '))
  if (path === null) return { kind: 'error', text: '请给出导出路径，或省略路径使用默认位置。' }
  const pack = buildRulesPack({
    version: pluginVersion(),
    entities: runtime.config.entities,
    terms: runtime.termLines,
  })
  const body = passphrase === null
    ? serializeRulesPack(pack)
    : encryptPackText(serializeRulesPack(pack), passphrase)
  try {
    writeTextFile(path, body)
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
  return {
    kind: 'success',
    text: [
      `已导出规则包：${path}${passphrase !== null ? '（AES-256-GCM 加密）' : '（明文）'}`,
      `格式：${RULES_SCHEMA}　实体：${pack.entities.length} 类　词表：${pack.terms.length} 条`,
      '规则包只含词表与实体开关，**不含还原表（真值）**；',
      '但词表本身可能含敏感专有名词' + (passphrase !== null ? '，已加密请保管好口令（丢失无法找回）' : '，请按同等密级保管'),
      '对方用法：/shield import <路径>' + (passphrase !== null ? ' --pass <口令>' : '') + ' [replace confirm]，',
      `或在 cordis.patch.yml 里配置 rulesPack: "${path}"。`,
    ].join('\n'),
  }
}

/**
 * `/shield import <路径> [replace]`：载入规则包（默认合并词表，replace 覆盖）。
 * @param {ShieldRuntime} runtime 运行时。
 * @param {string} argument 参数（路径 + 可选 replace）。
 * @param {object} log 日志。
 * @returns {object} 命令结果。
 */
function importRules(runtime, argument, log) {
  const parts = argument.trim().split(/\s+/u).filter((item) => item !== '')
  if (parts.length === 0) return { kind: 'error', text: '用法：/shield import <路径> [--pass 口令] [replace confirm]' }
  let passphrase = null
  const passIdx = parts.findIndex((item) => item === '--pass')
  if (passIdx >= 0) {
    if (passIdx + 1 >= parts.length) return { kind: 'error', text: '用法：/shield import <路径> --pass <口令>' }
    passphrase = parts[passIdx + 1]
    parts.splice(passIdx, 2)
  }
  let replace = parts.length > 1 && parts[parts.length - 1].toLowerCase() === 'replace'
  if (replace) parts.pop()
  if (parts[parts.length - 1]?.toLowerCase() === 'confirm') parts.pop()
  else replace = false
  if (argument.includes('replace') && !argument.includes('confirm')) {
    return {
      kind: 'error',
      text: 'replace 模式会用导入的词表覆盖现有词表。如确认，请执行：/shield import <路径> replace confirm',
    }
  }
  const path = resolveRulesPath(parts.join(' '))
  if (path === null) return { kind: 'error', text: '无效路径。' }
  let pack
  let warnings = []
  try {
    let text = readTextFile(path)
    if (isEncryptedPackText(text)) text = decryptPackText(text, passphrase ?? '')
    const parsed = parseRulesPackText(text)
    pack = parsed.pack
    warnings = parsed.warnings
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
  const before = runtime.engine.termCount
  let terms = pack.terms
  if (!replace) {
    const merged = mergeTermLines(runtime.termLines, pack.terms)
    terms = merged.terms
  }
  const result = runtime.applyRules({ entities: pack.entities, terms })
  log.info(`已导入规则包 ${path}（词表 ${before} → ${result.terms}）`)
  const lines = [
    `已导入规则包：${path}`,
    `模式：${replace ? 'replace（覆盖词表）' : 'merge（与现有词表合并）'}`,
    `词表：${before} → ${result.terms} 条　实体：${result.entities} 类`,
    '生效范围：本进程立即生效（derive 补丁已装的话，下一次模型请求即使用新词表；缓存按引擎代际自动失效）。',
    '持久化：把词表写进 cordis.patch.yml 的 terms / termsFile / rulesPack，重启后自动载入。',
  ]
  for (const warning of warnings.slice(0, 10)) lines.push(`  警告：${warning}`)
  return { kind: 'success', text: lines.join('\n') }
}

/** 候选表格式化（scan-doc / learn 共用；候选词回显——它们来自本地文档，用户本人可见）。 */
function formatCandidates(candidates, headline) {
  const lines = [`候选专名：${headline}，共 ${candidates.length} 条（30 分钟内有效）`]
  if (candidates.length === 0) {
    lines.push('  （没有抽到候选：文档可能太短，或引擎已能覆盖其中片段）')
  }
  for (const [index, item] of candidates.slice(0, 50).entries()) {
    const evidence = Array.isArray(item.evidence) && item.evidence.length > 0
      ? `　证据：${item.evidence.join('；')}`
      : ''
    lines.push(`  ${String(index + 1).padStart(3)}. ${item.value}　×${item.count}　建议 @${item.label}　[${item.source}]${evidence}`)
  }
  if (candidates.length > 50) lines.push(`  …其余 ${candidates.length - 50} 条省略（adopt all 可全部采纳）`)
  lines.push('确认入词表：/shield terms adopt <序号…> 或 /shield terms adopt all')
  return lines.join('\n')
}

/** 词表统计（只显示计数与分类，不回显词条原文）。 */
function formatTerms(runtime) {
  const byLabel = runtime.termsByLabel()
  const lines = [`词表条目：${runtime.engine.termCount} 条`]
  for (const [label, count] of Object.entries(byLabel).sort((left, right) => right[1] - left[1])) {
    lines.push(`  ${label}: ${count}`)
  }
  if (runtime.engine.termCount === 0) {
    lines.push('  （空词表：可在 cordis.patch.yml 的 terms / termsFile / rulesPack 里配置）')
  }
  lines.push('提示：/shield export [路径] 可把当前词表导出成可携带的规则包。')
  return lines.join('\n')
}

/** 还原表统计。 */
function formatVault(runtime) {
  const byLabel = runtime.vault.countByLabel()
  const lines = [`还原表条目：${runtime.vault.size} 条（仅内存，可由本地日志重建）`]
  for (const [label, count] of Object.entries(byLabel).sort((left, right) => right[1] - left[1])) {
    lines.push(`  ${label}: ${count}`)
  }
  lines.push('还原表只在内存里，不落盘、不进规则包、不出境。')
  return lines.join('\n')
}

export { MODES, formatHelp }
