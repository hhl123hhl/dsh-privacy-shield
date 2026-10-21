// test/scan-learn.test.mjs — 智能词表：scan-doc 抽取、docx 解析、learn、adopt 确认流（node --test）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { extractCandidates, extractText, miniUnzip, scanDocument } from '../lib/scan-doc.js'
import { learnFromSessions, sessionsDir } from '../lib/learn.js'
import { MaskEngine } from '../lib/engine.js'
import { ShieldRuntime } from '../lib/runtime.js'
import { resolveConfig } from '../lib/config.js'

// zstd 压缩同步 API（Node 22.15+/24 才有；缺失时跳过 learn 用例）。
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const zstdCompressSync = require('node:zlib').zstdCompressSync ?? null

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'shield-scan-'))
}

const ENGINE = () => new MaskEngine({ entities: ['phone-cn', 'id-card-cn'] })

// ---------- extractText ----------

test('extractText：txt 读取；pdf 给出明确提示；二进制拒绝', () => {
  const dir = tempDir()
  const txt = join(dir, 'doc.txt')
  writeFileSync(txt, '甲公司承接了天枢项目，编号 HT-2024-001，电话 13800138000')
  assert.match(extractText(txt), /甲公司/u)
  const pdf = join(dir, 'doc.pdf')
  writeFileSync(pdf, '%PDF-1.4 fake')
  assert.throws(() => extractText(pdf), /另存为 \.docx|转成/u)
  const bin = join(dir, 'doc.csv')
  writeFileSync(bin, Buffer.from([0x00, 0x01, 0x02]))
  assert.throws(() => extractText(bin), /二进制/u)
  rmSync(dir, { recursive: true, force: true })
})

test('miniUnzip + extractText：docx 抽出正文文本', () => {
  const dir = tempDir()
  const docx = join(dir, 'doc.docx')
  // 手工造最小 docx：一个 stored(不压缩) 条目的 zip。
  const content = Buffer.from('<w:p>甲公司与乙实验室共建银河平台</w:p>', 'utf8')
  const name = Buffer.from('word/document.xml', 'utf8')
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4) // version
  header.writeUInt16LE(0, 8) // method: stored
  header.writeUInt32LE(content.length, 18) // compressed size
  header.writeUInt32LE(content.length, 22) // uncompressed size
  header.writeUInt16LE(name.length, 26)
  header.writeUInt16LE(0, 28)
  writeFileSync(docx, Buffer.concat([header, name, content]))
  // miniUnzip 本身
  const entries = miniUnzip(readFileSync(docx))
  assert.ok(entries.has('word/document.xml'))
  // extractText 走完整路径
  const text = extractText(docx)
  assert.match(text, /甲公司/u)
  assert.match(text, /银河平台/u)
  rmSync(dir, { recursive: true, force: true })
})

// ---------- extractCandidates ----------

test('extractCandidates：后缀词典 + 编号模式；已覆盖片段被剔除', () => {
  const text = '甲公司承接天枢项目与银河平台，编号 HT-2024-001，电话 13800138000，又见甲公司。'
  const candidates = extractCandidates(text, ENGINE())
  const byValue = new Map(candidates.map((c) => [c.value, c]))
  assert.ok(byValue.has('甲公司'), '应有 甲公司')
  assert.ok(byValue.has('天枢项目'), '应有 天枢项目')
  assert.ok(byValue.has('HT-2024-001'), '应有 编号')
  assert.ok(!byValue.has('13800138000'), '引擎已覆盖的手机号不应入候选')
  assert.equal(byValue.get('甲公司').count, 2)
  assert.equal(byValue.get('甲公司').label, 'ORG')
  assert.equal(byValue.get('HT-2024-001').label, 'IDNO')
})

test('scanDocument：端到端产出候选表', () => {
  const dir = tempDir()
  const path = join(dir, 'spec.md')
  writeFileSync(path, '# 需求\n承建方：云峰科技有限公司；项目代号 GW-A1234。\n')
  const result = scanDocument(path, ENGINE())
  assert.ok(result.bytes > 0)
  const values = result.candidates.map((c) => c.value)
  assert.ok(values.some((v) => v.includes('云峰科技有限公司')))
  rmSync(dir, { recursive: true, force: true })
})

// ---------- learn ----------

test('learnFromSessions：从会话日志抽取高频未命中片段（zstd 可用时）', { skip: zstdCompressSync === null }, () => {
  const home = tempDir()
  const sessionDir = join(home, 'sessions', '--D-X--', 'session-1')
  mkdirSync(sessionDir, { recursive: true })
  const events = [
    JSON.stringify({ type: 'user/message', seq: 1, surfaceOp: 'append', data: { content: [{ type: 'text', text: '请使用昆仑数据库处理' }], role: 'user' } }),
    JSON.stringify({ type: 'user/message', seq: 2, surfaceOp: 'append', data: { content: [{ type: 'text', text: '昆仑数据库的密码问管理员' }], role: 'user' } }),
    JSON.stringify({ type: 'user/message', seq: 3, surfaceOp: 'append', data: { content: [{ type: 'text', text: '昆仑数据库在 13800138000 机房' }], role: 'user' } }),
  ].join('\n')
  writeFileSync(join(sessionDir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(events, 'utf8')))
  const result = learnFromSessions(ENGINE(), { env: { DSH_HOME: home } })
  assert.equal(result.scanned, 1)
  assert.equal(result.texts, 3)
  const learned = result.candidates.find((c) => c.value === '昆仑数据库')
  assert.ok(learned, '应有 昆仑数据库 候选')
  assert.ok(learned.count >= 3)
  assert.ok(!result.candidates.some((c) => c.value === '13800138000'), '已覆盖的手机号不应入候选')
  rmSync(home, { recursive: true, force: true })
})

test('sessionsDir：指向 $DSH_HOME/sessions', () => {
  assert.equal(sessionsDir({ DSH_HOME: 'H:/dsh' }), join('H:/dsh', 'sessions'))
})

// ---------- adopt 确认流 ----------

test('候选池：30 分钟过期；adopt 序号与 all 两种确认方式', () => {
  const rt = new ShieldRuntime(resolveConfig({ placeholderHash: 'legacy' }))
  rt.setCandidates([
    { value: '甲公司', count: 3, label: 'ORG', source: '后缀词典' },
    { value: 'HT-2024-001', count: 1, label: 'IDNO', source: '编号模式' },
  ])
  // 指定序号：只采纳 1 条。
  const one = rt.adoptCandidates(['2'])
  assert.equal(one.adopted, 1)
  assert.equal(one.terms, 1)
  assert.equal(rt.termLines[0], 'HT-2024-001 @idno')
  // adopt all：采纳剩余全部（去重后）。
  const all = rt.adoptCandidates(['all'])
  assert.equal(all.adopted, 1) // 甲公司（HT 已存在，merge 去重）
  assert.equal(all.terms, 2)
  // 过期：时间戳拨回 31 分钟。
  rt.candidateStamp = Date.now() - 31 * 60 * 1000
  const stale = rt.adoptCandidates(['all'])
  assert.equal(stale.stale, true)
  assert.equal(stale.adopted, 0)
})
