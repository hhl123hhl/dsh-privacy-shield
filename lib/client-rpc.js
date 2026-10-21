// lib/client-rpc.js — dsh-privacy-shield 的 host 侧 RPC 注册模块。
//
// 背景（已查证的 DSH 机制，见报告）：
//   client.js 是"普通 bundle 插件"的浏览器半边，它的工厂只收到 `require`，
//   平台 seed 表只有 react / react-dom / @deepseek-ai/cordis / client-store /
//   ui-slots / ui-primitives / ui-dockkit
//   （证据：dsh-web-frontend/dist/assets/index-*.js 里 `function by(){return{react:…}}`）。
//   因此任务描述里的 `host.call(...)` **拿不到**：`host` 是 cordis-client-runner
//   在 evaluateClientHalf() 里注入给"动态包（cordis_define/cordis_run）"的闭包符号
//   （证据：dsh-cordis-client-runner/lib/client.js:152-181 的 parameters 数组与 call 实现）。
//
// 本模块改用 DSH 公开的通用 RPC 通道（浏览器可直连、自带 Host/Origin 与浏览器鉴权）：
//   host 侧：ctx.connection.rpc.handle(channel, (endpoint, payload, signal) => result)
//            → 证据：dsh-client-connection/lib/index.js:539-551（get rpc()/handle）、
//                    602-618（register：prefix 路由 channel + requestRejection）、
//                    635-664（rpcFetchHandler：POST <channel>/<endpoint>，JSON 信封）
//   client 侧：ctx.connection.rpc.call(channel, endpoint, payload)
//            → 证据：dsh-client-connection/lib/client.js:6194-6223（createWebConnectionRpc）
//
// 容错策略（本模块**绝不抛错**）：
//   1. 优先注册通用 RPC 通道；机制不可用时静默跳过。
//   2. 再尝试注册两条同路径的 webServer 直连路由（同一处理器，包一层 JSON 应答），
//      让"没有 connection 服务"的部署也能用普通 fetch 打通。
//   3. 全部失败 → 返回 undefined，client.js 会显示"状态不可用"。
//
// 硬规则：本模块返回的任何字段都不得包含真实敏感值（只有计数、标签、"是否包含"布尔值）。

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ENTITY_LABELS, ENTITY_SENSITIVITY, MODES, PLUGIN_NAME } from './constants.js'
import { scanDocument } from './scan-doc.js'
import { learnFromSessions } from './learn.js'
import { aggregateAudit, auditPath, readAuditEntries } from './audit.js'
import { resolveRulesPath } from './rules.js'

/** 浏览器侧调用的 RPC 通道名（CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/）。 */
export const RPC_CHANNEL = '/shield'

/** 支持的方法名。 */
export const RPC_METHODS = Object.freeze([
  'status', 'setMode',
  'setEntities', 'termsList', 'termsAdd', 'termsRemove',
  'testMask', 'scanDoc', 'learn', 'adopt', 'auditSummary',
  'clientLog',
])

/** 单次 status() 返回里错误列表的长度上限。 */
const MAX_ERRORS = 8

/** 版本号兜底（package.json 不入 runtime，这里用固定值，避免额外 IO）。 */
const FALLBACK_VERSION = '0.3.3'

/**
 * host 侧真实版本：从 package.json 读（与 client.js 的编译期 CLIENT_VERSION 比对，
 * 用来提示"插件已升级，但界面 bundle 需要重启 DSH 才更新"）。
 * 读不到才回退 FALLBACK_VERSION。
 */
function resolveHostVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))
    if (typeof pkg.version === 'string' && pkg.version !== '') return pkg.version
  } catch {
    /* 读不到就用回退版本 */
  }
  return FALLBACK_VERSION
}

/** 本进程的 host 版本（启动时求值一次）。 */
const HOST_VERSION = resolveHostVersion()

/**
 * 把一个未知值规整为可读字符串（绝不回显对象内容，避免意外带出敏感值）。
 * @param {unknown} value 任意值。
 * @returns {string} 字符串。
 */
function describe(value) {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  try {
    return String(value)
  } catch {
    return 'unknown error'
  }
}

/** 计数累加器（把小对象合成 {label: count}）。 */
function addInto(target, source) {
  if (source === null || typeof source !== 'object') return
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'number' && Number.isFinite(value)) target[key] = (target[key] ?? 0) + value
  }
}

/** 把未知值收敛为整数。 */
function toInt(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * 词表统计：条数 + 分类分布（分类来自词表条目的 category，无分类归 'other'）。
 * @param {object} engine MaskEngine 实例。
 * @returns {{count: number, byCategory: object}} 统计。
 */
function termStats(engine) {
  const items = Array.isArray(engine?.terms?.items) ? engine.terms.items : []
  const byCategory = {}
  for (const item of items) {
    const category = typeof item?.category === 'string' && item.category !== '' ? item.category : 'other'
    byCategory[category] = (byCategory[category] ?? 0) + 1
  }
  return { count: toInt(engine?.termCount) || items.length, byCategory }
}

/**
 * 词表命中计数快照：归一化 value → 次数。
 * 键与词表行一一对应（词表本身已通过 termsList 返回给本机 UI），不新增任何明文信息。
 * @param {object} engine MaskEngine 实例。
 * @returns {object} 计数表（纯 JSON）。
 */
function termHitMap(engine) {
  const source = engine !== null && typeof engine === 'object' && engine.termHits !== null && typeof engine.termHits === 'object'
    ? engine.termHits
    : {}
  const out = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

/**
 * 构造 client 半边需要的状态快照（纯 JSON，绝不含明文）。
 * @param {object} runtime ShieldRuntime 实例。
 * @param {object|undefined} config 归一化配置。
 * @param {string} sessionId 当前会话 id（可为空）。
 * @returns {object} 状态对象。
 */
export function buildStatus(runtime, config, sessionId) {
  const snapshot = runtime !== null && typeof runtime?.snapshot === 'function' ? runtime.snapshot() : {}
  const id = typeof sessionId === 'string' ? sessionId : ''
  let allowed
  try {
    allowed = typeof runtime?.sessionAllowed === 'function' ? runtime.sessionAllowed(id) === true : false
  } catch {
    allowed = false
  }
  const byLabel = {}
  addInto(byLabel, snapshot.byLabel)
  const outboundByLabel = {}
  addInto(outboundByLabel, snapshot.outboundByLabel)
  const surfaces = Array.isArray(snapshot.surfaces) ? snapshot.surfaces.slice() : []
  const errors = Array.isArray(snapshot.errors) ? snapshot.errors.slice(-MAX_ERRORS) : []
  const stats = {
    maskedTexts: toInt(snapshot.maskedTexts),
    maskedBlocks: toInt(snapshot.maskedTexts),
    streamCalls: toInt(snapshot.streamCalls),
    restoredValues: toInt(snapshot.restoredValues),
    outboundRequests: toInt(snapshot.outboundRequests),
    outboundPlaceholders: toInt(snapshot.outboundPlaceholders),
    outboundByLabel,
    violations: toInt(snapshot.violations),
    errors: errors.length,
    outboundRealValues: 0,
  }
  const terms = termStats(runtime?.engine)
  return {
    ok: true,
    version: HOST_VERSION,
    plugin: PLUGIN_NAME,
    enabled: config === undefined || config === null ? true : config.enabled !== false,
    mode: snapshot.mode === MODES.ENFORCE ? MODES.ENFORCE : MODES.OBSERVE,
    active: snapshot.active !== false,
    registerProjections: snapshot.derivePatchInstalled === true,
    entities: Array.isArray(snapshot.entities) ? snapshot.entities.slice() : [],
    catalog: Object.keys(ENTITY_LABELS).map((id) => ({
      id,
      label: ENTITY_LABELS[id],
      sensitivity: ENTITY_SENSITIVITY[id] ?? 'low',
    })),
    surfaces: { covered: surfaces, list: surfaces },
    terms,
    counts: stats,
    sessions: { tracked: toInt(snapshot.sessions) },
    session: { id, allowed: allowed === true },
  }
}

/**
 * 构造 RPC 方法分发表（纯函数，可脱离 cordis 上下文单测）。
 * 连接 RPC 通道与 webServer 直连路由共用同一实现；任何异常都折成 {ok:false}，
 * 绝不让一次浏览器调用打断 host。
 *
 * @param {object} runtime ShieldRuntime 实例。
 * @param {object|undefined} config 归一化配置。
 * @param {() => string} resolveSession 取当前会话 id。
 * @returns {(method: string, payload: unknown) => object} dispatch。
 */
export function createRpcDispatcher(runtime, config, resolveSession) {
  const status = () => buildStatus(runtime, config, typeof resolveSession === 'function' ? resolveSession() : '')

  /**
   * @param {string} method 方法名。
   * @param {unknown} payload 参数（JSON）。
   * @returns {object} 结果（纯 JSON）。
   */
  return function dispatch(method, payload) {
    if (method === 'status') return status()
    if (method === 'setMode') {
      const mode = payload !== null && typeof payload === 'object' ? payload.mode : payload
      if (mode !== MODES.ENFORCE && mode !== MODES.OBSERVE) {
        return { ok: false, error: 'invalid mode', accepted: [MODES.ENFORCE, MODES.OBSERVE] }
      }
      try {
        runtime.setEnforcing(mode === MODES.ENFORCE)
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
      const next = status()
      console.log(`[${PLUGIN_NAME}] client-rpc: setMode -> ${mode}`)
      return next
    }
    if (method === 'setEntities') {
      const entities = payload !== null && typeof payload === 'object' ? payload.entities : payload
      try {
        const result = runtime.setEntities(Array.isArray(entities) ? entities : [])
        console.log(`[${PLUGIN_NAME}] client-rpc: setEntities -> ${result.entities}`)
        return { ok: true, ...result, snapshot: status() }
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    }
    if (method === 'termsList') {
      return {
        ok: true,
        terms: Array.isArray(runtime.termLines) ? runtime.termLines.slice() : [],
        // 分类分布与命中次数（词表页展示用；hits 是"值(归一) → 次数"，不含明文以外的信息）。
        categories: termStats(runtime.engine).byCategory,
        hits: termHitMap(runtime.engine),
      }
    }
    if (method === 'termsAdd') {
      const lines = payload !== null && typeof payload === 'object' ? payload.lines : payload
      if (!Array.isArray(lines) || lines.length === 0) return { ok: false, error: 'lines must be a non-empty array' }
      try {
        const result = runtime.addTermLines(lines.map((line) => String(line)))
        console.log(`[${PLUGIN_NAME}] client-rpc: termsAdd +${result.added}`)
        return { ok: true, ...result }
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    }
    if (method === 'termsRemove') {
      const values = payload !== null && typeof payload === 'object' ? payload.values : payload
      if (!Array.isArray(values) || values.length === 0) return { ok: false, error: 'values must be a non-empty array' }
      try {
        const result = runtime.removeTermValues(values.map((value) => String(value)))
        console.log(`[${PLUGIN_NAME}] client-rpc: termsRemove -${result.removed}`)
        return { ok: true, ...result }
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    }
    if (method === 'testMask') {
      const text = payload !== null && typeof payload === 'object' ? payload.text : payload
      if (typeof text !== 'string' || text === '') return { ok: false, error: 'text must be a non-empty string' }
      // 真值对照必须显式要求（默认不返回真值，避免任何"顺手把敏感值传回 UI"的路径）。
      const reveal = payload !== null && typeof payload === 'object' && payload.reveal === true
      try {
        const engine = runtime.engine
        const { text: masked, hits } = engine.mask(text)
        const byLabel = {}
        for (const hit of hits) byLabel[hit.label] = (byLabel[hit.label] ?? 0) + 1
        const result = { ok: true, masked, hits: hits.length, byLabel }
        if (reveal) {
          // 上限 100 条，够本地核对；仍是"本机 → 本机"，不出境。
          result.pairs = hits.slice(0, 100).map((hit) => ({
            label: hit.label,
            placeholder: hit.placeholder,
            value: hit.value,
          }))
        }
        return result
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    }
    if (method === 'scanDoc' || method === 'learn') {
      try {
        const result = method === 'scanDoc'
          ? scanDocument(String(payload?.path ?? ''), runtime.engine)
          : learnFromSessions(runtime.engine)
        runtime.setCandidates(result.candidates)
        console.log(`[${PLUGIN_NAME}] client-rpc: ${method} -> ${result.candidates.length} 候选`)
        return { ok: true, ...result }
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    }
    if (method === 'adopt') {
      const ids = payload !== null && typeof payload === 'object' ? payload.ids : payload
      if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'ids must be a non-empty array' }
      const result = runtime.adoptCandidates(ids.map((id) => String(id)))
      if (result.stale) return { ok: false, error: '候选池已过期（30 分钟），请重新 scan-doc / learn' }
      return { ok: true, ...result }
    }
    if (method === 'auditSummary') {
      try {
        const days = Math.min(90, Math.max(1, toInt(payload?.days) || 14))
        const path = auditPath(config, runtime?.env)
        const entries = readAuditEntries(path)
        return { ok: true, windowDays: days, ...aggregateAudit(entries, days) }
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    }
    if (method === 'clientLog') {
      // 客户端诊断日志（debug-client.jsonl）：仅限本插件自身调试，消息截断、文件限长。
      try {
        const level = payload !== null && typeof payload === 'object' && typeof payload.level === 'string'
          ? payload.level.slice(0, 16)
          : 'info'
        const message = payload !== null && typeof payload === 'object' && payload.message !== undefined
          ? String(payload.message).slice(0, 500)
          : ''
        const path = resolveRulesPath('debug-client.jsonl', runtime?.env)
        const line = JSON.stringify({ plugin: PLUGIN_NAME, at: new Date().toISOString(), level, message }) + '\n'
        try {
          appendFileSync(path, line)
        } catch {
          // 目录可能还没建：先建再写，仍失败则静默丢弃（诊断绝不影响主流程）。
          try {
            mkdirSync(dirname(path), { recursive: true })
            appendFileSync(path, line)
          } catch { /* silent */ }
        }
        // 文件超 1MB 时截尾，避免无界增长。
        try {
          if (existsSync(path) && statSync(path).size > 1024 * 1024) {
            const tail = readFileSync(path, 'utf8').split('\n').slice(-200).join('\n')
            writeFileSync(path, tail)
          }
        } catch { /* silent */ }
      } catch { /* silent */ }
      return { ok: true }
    }
    return { ok: false, error: 'unknown method', method: typeof method === 'string' ? method : '' }
  }
}

/**
 * 注册 client 侧 RPC。
 *
 * @param {object} ctx Cordis 上下文（host 半边）。
 * @param {object} runtime ShieldRuntime 实例（index.js 里构造的那个）。
 * @param {object|undefined} config 归一化配置（resolveConfig 的结果）。
 * @returns {(() => void)|undefined} disposer；机制不可用时返回 undefined。
 */
export function registerClientRpc(ctx, runtime, config) {
  const disposers = []
  try {
    if (ctx === null || typeof ctx !== 'object') return undefined
    if (runtime === null || typeof runtime !== 'object') return undefined
    console.log(`[${PLUGIN_NAME}] client-rpc: register begin`)

    const resolveSession = () => {
      try {
        const id = typeof ctx.get === 'function' ? ctx.get('agent')?.id : undefined
        return typeof id === 'string' ? id : ''
      } catch {
        return ''
      }
    }

    const dispatch = createRpcDispatcher(runtime, config, resolveSession)

    // ---- 1) 通用 RPC 通道（自带 Host/Origin 与浏览器鉴权）----
    let channelOk = false
    try {
      if (typeof ctx.inject === 'function') {
        ctx.inject(['connection'], (connectionCtx) => {
          try {
            const rpc = connectionCtx?.connection?.rpc
            if (rpc === undefined || typeof rpc.handle !== 'function') return
            connectionCtx.effect(() => {
              const dispose = rpc.handle(RPC_CHANNEL, (endpoint, payload) => dispatch(endpoint, payload))
              return typeof dispose === 'function' ? dispose : undefined
            }, 'dsh-privacy-shield:client-rpc channel')
            channelOk = true
            console.log(`[${PLUGIN_NAME}] client-rpc: rpc channel ${RPC_CHANNEL} registered`)
          } catch (error) {
            console.log(`[${PLUGIN_NAME}] client-rpc: rpc channel unavailable: ${describe(error)}`)
          }
        })
      }
    } catch (error) {
      console.log(`[${PLUGIN_NAME}] client-rpc: rpc channel skipped: ${describe(error)}`)
    }

    // ---- 2) /api 共享通道的精确 Fetch 路由（浏览器半边的主通道）----
    // 背景（已查证）：根路径 /shield 会被 client-modules 的 Web carrier 前缀路由
    // （/plugins 资源服务）遮蔽，任何方法都回 400。唯一自带鉴权、且不被遮蔽的通道是
    // connection 服务的 /api 共享通道：connection.fetch.register 注册精确路由，
    // 走 /api/shield，admission（Host/Origin 围栏 + 浏览器鉴权）全自动。
    // 证据：dsh-client-connection/lib/index.js createSharedFetchHandler / registerFetchRoute。
    let httpOk = false
    try {
      if (typeof ctx.inject === 'function') {
        ctx.inject(['connection'], (connCtx) => {
          try {
            const reg = connCtx?.connection?.fetch?.register
            if (typeof reg !== 'function') return
            const handler = async (request) => {
              let body
              try {
                body = await request.json()
              } catch {
                return Response.json({
                  type: 'server-response',
                  rpcId: 'invalid',
                  result: { ok: false, error: { code: 'gateway/bad-request', message: 'body is not JSON', details: {} } },
                })
              }
              const rpcId = body !== null && typeof body === 'object' && typeof body.rpcId === 'string' ? body.rpcId : 'unknown'
              const callMethod = body !== null && typeof body === 'object' && typeof body.method === 'string' ? body.method : ''
              let result
              try {
                result = dispatch(callMethod, body?.payload)
              } catch (error) {
                result = { ok: false, error: describe(error) }
              }
              const resultEnvelope = result !== null && typeof result === 'object' && typeof result.error === 'string'
                ? { ok: false, error: { code: 'shield/error', message: result.error, details: {} } }
                : { ok: true, value: result }
              return Response.json({ type: 'server-response', rpcId, result: resultEnvelope })
            }
            connCtx.effect(() => reg({
              path: '/api/shield',
              methods: ['POST'],
              requestBody: 'buffered',
              fetch: handler,
            }), 'dsh-privacy-shield:client-rpc POST /api/shield')
            httpOk = true
            console.log(`[${PLUGIN_NAME}] client-rpc: /api/shield fetch route registered`)
          } catch (error) {
            console.log(`[${PLUGIN_NAME}] client-rpc: /api/shield fetch route unavailable: ${describe(error)}`)
          }
        })
      }
    } catch (error) {
      console.log(`[${PLUGIN_NAME}] client-rpc: /api/shield fetch route skipped: ${describe(error)}`)
    }

    if (!channelOk && !httpOk) {
      console.log(`[${PLUGIN_NAME}] client-rpc: no usable transport — client 半边会优雅降级`)
      return undefined
    }
    if (disposers.length === 0) return undefined
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* 卸载期错误忽略 */
        }
      }
    }
  } catch (error) {
    // 兜底：本模块绝不让插件挂载失败。
    try {
      console.log(`[${PLUGIN_NAME}] client-rpc: disabled (${describe(error)})`)
    } catch {
      /* 连日志都失败就彻底沉默 */
    }
    return undefined
  }
}

export default registerClientRpc
