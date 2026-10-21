// lib/audit.js — 审计落盘的读取、保留策略、聚合与导出（零依赖）。
//
// 铁律与落盘侧一致：这里只读"计数与标签"，任何字段都不含明文。
// 审计 JSONL 每行形如：
//   { plugin, version, at, sessionId, purpose, handBuilt, mode, entities, termsVersion,
//     placeholders, byLabel, violations }

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'

import { resolveRulesPath } from './rules.js'

/** 审计文件读取上限（超出只读尾部，防止巨型文件拖垮命令）。 */
const MAX_AUDIT_READ_BYTES = 20 * 1024 * 1024

/**
 * 审计文件路径（与 lib/index.js makeAuditSink 的解析规则保持一致）。
 * @param {object} config 归一化配置。
 * @returns {string|null} 绝对路径；解析失败为 null。
 */
export function auditPath(config, env = process.env) {
  try {
    return config?.audit?.jsonlPath !== null && config?.audit?.jsonlPath !== undefined
      ? resolveRulesPath(config.audit.jsonlPath, env)
      : resolveRulesPath('audit.jsonl', env)
  } catch {
    return null
  }
}

/**
 * 启动期保留策略：丢弃超过 retentionDays 的行（0 = 不清理）。
 * 失败静默——清理失败绝不阻断插件。
 * @param {string} path 审计文件路径。
 * @param {number} retentionDays 保留天数。
 * @returns {void}
 */
export function enforceAuditRetention(path, retentionDays) {
  if (typeof path !== 'string' || path === '' || !(retentionDays > 0)) return
  try {
    if (!existsSync(path)) return
    if (statSync(path).size > MAX_AUDIT_READ_BYTES) return // 超大文件跳过清理，宁可保留
    const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000
    const kept = []
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      let ts = 0
      try { ts = Number(JSON.parse(line).at) || 0 } catch { /* 坏行按保留处理 */ }
      if (ts === 0 || ts >= cutoff) kept.push(line)
    }
    writeFileSync(path, `${kept.join('\n')}\n`, 'utf8')
  } catch { /* 尽力而为 */ }
}

/**
 * 读取审计条目（容错解析：坏行跳过）。
 * @param {string} path 文件路径。
 * @returns {Array<object>} 条目列表（按时间升序）。
 */
export function readAuditEntries(path) {
  const out = []
  if (typeof path !== 'string' || path === '' || !existsSync(path)) return out
  let text = ''
  try {
    const size = statSync(path).size
    if (size > MAX_AUDIT_READ_BYTES) {
      const fd = readFileSync(path)
      text = fd.subarray(fd.length - MAX_AUDIT_READ_BYTES).toString('utf8')
      text = text.slice(text.indexOf('\n') + 1) // 丢弃可能残缺的行首
    } else {
      text = readFileSync(path, 'utf8')
    }
  } catch {
    return out
  }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const entry = JSON.parse(line)
      if (entry !== null && typeof entry === 'object') out.push(entry)
    } catch { /* 跳过坏行 */ }
  }
  out.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))
  return out
}

/**
 * 按天聚合。
 * @param {Array<object>} entries 条目。
 * @param {number} [days] 只统计最近 N 天（省略 = 全部）。
 * @returns {{days: Array<object>, totals: object}} 聚合结果。
 */
export function aggregateAudit(entries, days) {
  const cutoff = days > 0 ? Date.now() - days * 24 * 3600 * 1000 : 0
  const byDay = new Map()
  const totals = { requests: 0, placeholders: 0, violations: 0, handBuilt: 0, sessions: new Set() }
  for (const entry of entries) {
    const at = Number(entry.at) || 0
    if (at < cutoff) continue
    const day = new Date(at).toISOString().slice(0, 10)
    let bucket = byDay.get(day)
    if (bucket === undefined) {
      bucket = { day, requests: 0, placeholders: 0, violations: 0, handBuilt: 0 }
      byDay.set(day, bucket)
    }
    const requests = 1
    const placeholders = Number(entry.placeholders) || 0
    const violations = Number(entry.violations) || 0
    bucket.requests += requests
    bucket.placeholders += placeholders
    bucket.violations += violations
    if (entry.handBuilt === true) bucket.handBuilt += 1
    totals.requests += requests
    totals.placeholders += placeholders
    totals.violations += violations
    if (entry.handBuilt === true) totals.handBuilt += 1
    if (typeof entry.sessionId === 'string' && entry.sessionId !== '') totals.sessions.add(entry.sessionId)
  }
  return { days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)), totals: { ...totals, sessions: totals.sessions.size } }
}

/**
 * 文本报告（/shield audit）。
 * @param {{days: Array<object>, totals: object}} agg 聚合结果。
 * @param {string} path 审计文件路径。
 * @param {number} [days] 统计窗口。
 * @returns {string} 文本。
 */
export function formatAuditReport(agg, path, days) {
  const lines = [
 `【出境审计】数据源：${path}`,
 `窗口：${days > 0 ? `最近 ${days} 天` : '全部'}　请求：${agg.totals.requests} 次　占位符：${agg.totals.placeholders} 个`
      + `　明文残留：${agg.totals.violations} 处　手搓请求：${agg.totals.handBuilt} 次　会话：${agg.totals.sessions} 个`,
    '',
    '日期　　　　请求　占位符　残留　手搓',
  ]
  if (agg.days.length === 0) {
    lines.push('  （窗口内没有审计记录）')
  }
  for (const day of agg.days) {
    lines.push(`${day.day}　${String(day.requests).padStart(5)}　${String(day.placeholders).padStart(6)}　${String(day.violations).padStart(4)}　${String(day.handBuilt).padStart(4)}`)
  }
  lines.push('', '说明：只含计数与标签，不含明文。审计行由每次出境请求实时写入。')
  return lines.join('\n')
}

/**
 * 导出 CSV（/shield audit export <路径>）。
 * @param {{days: Array<object>, totals: object}} agg 聚合结果。
 * @returns {string} CSV 文本。
 */
export function auditToCsv(agg) {
  const rows = ['date,requests,placeholders,violations,handbuilt']
  for (const day of agg.days) {
    rows.push(`${day.day},${day.requests},${day.placeholders},${day.violations},${day.handBuilt}`)
  }
  rows.push(`TOTAL,${agg.totals.requests},${agg.totals.placeholders},${agg.totals.violations},${agg.totals.handBuilt}`)
  return `${rows.join('\n')}\n`
}
