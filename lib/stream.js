// lib/stream.js — llm/stream 拦截：响应流还原 + 手搓请求兜底 + 出境审计（零依赖）。
//
// 为什么必须在这里做"还原"：
//   模型回话里出现的是占位符（它只见过占位符）。如果原样落盘，聊天界面与本地日志
//   就会显示占位符，用户看不到真实结果。DSH 允许 waterfall 监听者"产出自己的 chunk"，
//   所以我们在响应流上把占位符换回真值，这样 assistant 消息以真值落盘并展示。
//
// 为什么还要做"手搓请求兜底"：
//   会话循环构造的请求带 markAgentLoopRequest 标记且 deep-frozen，只能读；
//   但标题生成、压缩等手搓请求没有该标记、也不是冻结对象。对这类请求就地脱敏，
//   避免它们把本地真值直接送出去。

/** 还原器/合成 chunk 的分组键。 */
function keyOf(chunk) {
  switch (chunk?.type) {
    case 'text-delta': return `text:${chunk.index}`
    case 'reasoning-delta': return `reasoning:${chunk.index}`
    case 'tool-call-delta': return `tool:${chunk.id}`
    case 'block-end': {
      const block = chunk.block
      if (block?.type === 'text') return `text:${chunk.index}`
      if (block?.type === 'reasoning') return `reasoning:${chunk.index}`
      if (block?.type === 'tool-call') return `tool:${block.id}`
      return null
    }
    default: return null
  }
}

/** 依据分组键合成一个 delta chunk。 */
function syntheticDelta(key, text) {
  const [kind, rest] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
  if (kind === 'tool') return { type: 'tool-call-delta', index: 0, id: rest, argumentsDelta: text }
  if (kind === 'reasoning') return { type: 'reasoning-delta', index: Number(rest), text }
  return { type: 'text-delta', index: Number(rest), text }
}

/** 还原 block-end 里携带的完整内容。 */
function restoreBlockEnd(chunk, runtime) {
  const block = chunk.block
  if (block === null || typeof block !== 'object') return chunk
  try {
    if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string') {
      const text = runtime.restore(block.text)
      return text === block.text ? chunk : { ...chunk, block: { ...block, text } }
    }
    if (block.type === 'tool-call' && typeof block.arguments === 'string') {
      const args = runtime.restore(block.arguments)
      return args === block.arguments ? chunk : { ...chunk, block: { ...block, arguments: args } }
    }
  } catch (error) {
    runtime.stats.noteError('restoreBlockEnd', error)
  }
  return chunk
}

/**
 * 包装响应流：占位符 → 真值。
 * @param {AsyncIterable<object>} source 原始 chunk 流。
 * @param {import('./runtime.js').ShieldRuntime} runtime 运行时。
 * @returns {AsyncIterable<object>} 还原后的流。
 */
export async function* wrapStream(source, runtime) {
  const restorers = new Map()
  for await (const chunk of source) {
    const key = keyOf(chunk)
    if (key === null) {
      yield chunk
      continue
    }
    if (chunk.type === 'block-end') {
      const restorer = restorers.get(key)
      const tail = restorer === undefined ? '' : restorer.flush()
      restorers.delete(key)
      if (tail !== '') yield syntheticDelta(key, tail)
      yield restoreBlockEnd(chunk, runtime)
      continue
    }
    let restorer = restorers.get(key)
    if (restorer === undefined) {
      restorer = runtime.createRestorer()
      restorers.set(key, restorer)
    }
    const input = chunk.type === 'tool-call-delta' ? chunk.argumentsDelta : chunk.text
    const out = restorer.push(input)
    if (out === '') continue
    yield chunk.type === 'tool-call-delta' ? { ...chunk, argumentsDelta: out } : { ...chunk, text: out }
  }
  // 流异常结束（没有 block-end）：把扣住的尾巴补发，避免丢字。
  for (const [key, restorer] of restorers) {
    const tail = restorer.flush()
    if (tail !== '') yield syntheticDelta(key, tail)
  }
}

/**
 * 对手搓（非冻结）请求就地脱敏。冻结对象会被跳过并交由审计记录残留。
 * @param {object} options GenerateOptions。
 * @param {import('./runtime.js').ShieldRuntime} runtime 运行时。
 * @returns {boolean} 是否发生了改写。
 */
export function maskHandBuiltRequest(options, runtime) {
  if (options === null || typeof options !== 'object') return false
  if (Object.isFrozen(options)) return false
  let changed = false
  if (typeof options.system === 'string' && options.system !== '') {
    const { text, hits } = runtime.engine.mask(options.system)
    if (hits.length > 0) {
      options.system = text
      runtime.stats.maskedTexts += 1
      runtime.stats.addHits(hits)
      changed = true
    }
  }
  if (Array.isArray(options.messages)) {
    const next = []
    for (const message of options.messages) {
      const masked = message !== null && typeof message === 'object' ? runtime.maskMessage(message) : null
      if (masked === null) {
        next.push(message)
        continue
      }
      next.push(masked)
      changed = true
    }
    if (!Object.isFrozen(options.messages)) options.messages = next
    else if (changed) runtime.warnings.push('messages 数组被冻结，手搓请求未能脱敏')
  }
  return changed
}

/**
 * 创建 llm/stream 监听器。
 * @param {import('./runtime.js').ShieldRuntime} runtime 运行时。
 * @param {{onAudit?: (record: object) => void}} [hooks] 出境外挂（审计落盘用）。
 * @returns {(options: object, next: Function) => AsyncIterable<object>} 监听器。
 */
export function createStreamHandler(runtime, hooks = {}) {
  return function shieldStream(options, next) {
    let handBuilt = false
    try {
      if (!runtime.isActive()) return next()
      handBuilt = !(options !== null && typeof options === 'object' && Object.isFrozen(options))
      if (handBuilt && runtime.protecting) maskHandBuiltRequest(options, runtime)
      const audit = runtime.auditOutbound(options, { handBuilt })
      if (typeof hooks.onAudit === 'function') {
        try {
          hooks.onAudit({
            at: Date.now(),
            sessionId: typeof options?.sessionId === 'string' ? options.sessionId : null,
            purpose: typeof options?.purpose === 'string' ? options.purpose : null,
            handBuilt,
            mode: runtime.mode,
            paused: runtime.isPaused(),
            entities: runtime.config.entities.length,
            termsVersion: runtime.termsVersion,
            placeholders: audit.placeholders,
            byLabel: audit.byLabel,
            violations: audit.violations,
          })
        } catch (error) {
          runtime.stats.noteError('llm/stream:audit-hook', error)
        }
      }
      if (!handBuilt && runtime.protecting && audit.violations > 0
        && runtime.config.onUnmaskable === 'block') {
        throw new Error(
          `dsh-privacy-shield: 出境请求里仍有 ${audit.violations} 处未脱敏内容，已按 onUnmaskable=block 阻断`,
        )
      }
    } catch (error) {
      if (String(error?.message ?? '').includes('onUnmaskable=block')) throw error
      runtime.stats.noteError('llm/stream:pre', error)
    }
    const source = next()
    try {
      runtime.stats.streamCalls += 1
      return wrapStream(source, runtime)
    } catch (error) {
      runtime.stats.noteError('llm/stream', error)
      return source
    }
  }
}
