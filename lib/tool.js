// lib/tool.js — 模型可调用的自检工具 shield_scan（零依赖）。
//
// 为什么需要这个工具：
//   模型只见过占位符，所以它有时需要确认"我拿到的这段文本里哪些内容会被本地替换"。
//   工具把文本跑一遍脱敏引擎，只回**占位符化后的结果 + 命中统计**，绝不回显原文 ——
//   即使模型主动要求，也拿不到真值。
//
// 注册契约（来自 @deepseek-ai/dsh-tools 的 tools.register）：
//   definition 必须带 `output { schema, render }`，schema 属于受支持的 JSON Schema 子集
//   （type / oneOf / properties / required / additionalProperties / items / enum / const + 注释）。

import { TOOL_SCAN } from './constants.js'

/** 渲染工具结果（纯计数与占位符文本，不含真值）。 */
function renderScan(value) {
  if (value?.ok !== true) return `shield_scan 失败：${value?.error ?? '未知错误'}`
  const lines = [
    `shield_scan：命中 ${value.replaced} 处（模式 ${value.mode}）`,
  ]
  for (const item of value.distribution ?? []) lines.push(`  ${item.label}: ${item.count}`)
  if (value.replaced === 0) lines.push('  （未命中：这段文本里没有检测到已启用的敏感实体）')
  lines.push('脱敏结果：')
  lines.push(value.masked)
  lines.push('（本工具只回占位符，不回真值；真值只存在于本地会话日志与本地还原表中。）')
  return lines.join('\n')
}

/**
 * 构造 shield_scan 工具定义。
 * @param {import('./runtime.js').ShieldRuntime} runtime 运行时。
 * @returns {object} tools.register 可接受的定义。
 */
export function createScanTool(runtime) {
  return {
    name: TOOL_SCAN,
    description: 'Run text through the local dsh-privacy-shield masker and return the placeholder-rewritten '
      + 'text plus hit statistics. It never returns the original sensitive values. Use it to check '
      + 'what would leave this machine before quoting local data.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: {
          type: 'string',
          description: 'Text to scan locally. Detected entities (phone, e-mail, ID card, bank card, '
            + 'organization, project, system, address, person, your own terms, ...) are replaced with '
            + '<LABEL_8hex> placeholders.',
        },
      },
      required: ['text'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: {
          ok: { type: 'boolean' },
          mode: { type: 'string' },
          masked: { type: 'string' },
          replaced: { type: 'integer' },
          distribution: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'count'],
              properties: {
                label: { type: 'string' },
                count: { type: 'integer' },
              },
            },
          },
          error: { type: 'string' },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderScan(value) }]
      },
    },
    async execute(args, exec) {
      exec?.signal?.throwIfAborted?.()
      try {
        const text = typeof args?.text === 'string' ? args.text : ''
        const { text: masked, hits } = runtime.engine.mask(text)
        const byLabel = Object.create(null)
        for (const hit of hits) byLabel[hit.label] = (byLabel[hit.label] ?? 0) + 1
        return {
          ok: true,
          mode: runtime.mode,
          masked,
          replaced: hits.length,
          distribution: Object.entries(byLabel).map(([label, count]) => ({ label, count })),
        }
      } catch (error) {
        runtime.stats.noteError('tool:shield_scan', error)
        return {
          ok: false,
          mode: runtime.mode,
          masked: '',
          replaced: 0,
          distribution: [],
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}
