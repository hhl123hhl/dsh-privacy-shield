// test/audit.test.mjs — 审计落盘：保留策略、聚合、报告、CSV（node --test）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  aggregateAudit, auditPath, auditToCsv, enforceAuditRetention, formatAuditReport, readAuditEntries,
} from '../lib/audit.js'

function tempFile() {
  return join(mkdtempSync(join(tmpdir(), 'shield-audit-')), 'audit.jsonl')
}

function entry(at, over = {}) {
  return JSON.stringify({
    plugin: 'dsh-privacy-shield', at, sessionId: 's1', purpose: 'agent-loop', handBuilt: false,
    mode: 'enforce', entities: 26, termsVersion: 1, placeholders: 2, byLabel: { PHONE: 2 }, violations: 0,
    ...over,
  })
}

test('auditPath：默认落在 rulesRoot 下，自定义路径走 resolveRulesPath', () => {
  const envHome = mkdtempSync(join(tmpdir(), 'shield-home-'))
  const def = auditPath({ audit: { jsonlPath: null } })
  assert.ok(def.endsWith('audit.jsonl'))
  const custom = auditPath({ audit: { jsonlPath: join(envHome, 'x', 'a.jsonl') } })
  assert.equal(custom, join(envHome, 'x', 'a.jsonl'))
  rmSync(envHome, { recursive: true, force: true })
})

test('readAuditEntries：坏行跳过、按时间升序', () => {
  const path = tempFile()
  writeFileSync(path, `${entry(3000)}\n{bad json\n${entry(1000)}\n${entry(2000)}\n`)
  const entries = readAuditEntries(path)
  assert.equal(entries.length, 3)
  assert.deepEqual(entries.map((item) => item.at), [1000, 2000, 3000])
})

test('aggregateAudit：按天聚合与窗口过滤', () => {
  const now = Date.now()
  const day = 24 * 3600 * 1000
  const entries = [
    { at: now, placeholders: 2, violations: 0, handBuilt: false, sessionId: 'a' },
    { at: now - 2 * day, placeholders: 5, violations: 1, handBuilt: true, sessionId: 'b' },
    { at: now - 10 * day, placeholders: 9, violations: 3, handBuilt: false, sessionId: 'c' },
  ]
  const all = aggregateAudit(entries)
  assert.equal(all.totals.requests, 3)
  assert.equal(all.totals.placeholders, 16)
  assert.equal(all.totals.violations, 4)
  assert.equal(all.totals.sessions, 3)
  const win7 = aggregateAudit(entries, 7)
  assert.equal(win7.totals.requests, 2)
  assert.equal(win7.totals.violations, 1)
  assert.equal(win7.totals.sessions, 2)
})

test('formatAuditReport 与 auditToCsv：无记录与有记录两种形态', () => {
  const empty = formatAuditReport(aggregateAudit([]), '/tmp/a.jsonl', 7)
  assert.match(empty, /没有审计记录/u)
  const now = Date.now()
  const agg = aggregateAudit([{ at: now, placeholders: 3, violations: 0, handBuilt: true, sessionId: 's' }])
  const text = formatAuditReport(agg, '/tmp/a.jsonl', 7)
  assert.match(text, /请求：1 次/u)
  assert.match(text, /手搓请求：1 次/u)
  const csv = auditToCsv(agg)
  assert.match(csv, /^date,requests/u)
  assert.match(csv, /TOTAL,1,3,0,1/u)
})

test('enforceAuditRetention：超期行被清理，0=不清理，坏行保留', () => {
  const path = tempFile()
  const now = Date.now()
  const old = now - 40 * 24 * 3600 * 1000
  writeFileSync(path, `${entry(now)}\n${entry(old)}\n{oops\n`)
  enforceAuditRetention(path, 30)
  const kept = readAuditEntries(path)
  assert.equal(kept.length, 1)
  assert.equal(kept[0].at, now)

  writeFileSync(path, `${entry(old)}\n`)
  enforceAuditRetention(path, 0) // 0 = 永久
  assert.equal(readAuditEntries(path).length, 1)
})

test('audit 记录扩展字段：entities/termsVersion 进入聚合输入', () => {
  const path = tempFile()
  writeFileSync(path, `${entry(Date.now(), { entities: 26, termsVersion: 3 })}\n`)
  const entries = readAuditEntries(path)
  assert.equal(entries[0].entities, 26)
  assert.equal(entries[0].termsVersion, 3)
})
