// test/client-rpc.test.mjs — M5 Web UI：runtime 词表/实体操作 + RPC dispatcher（node --test）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ShieldRuntime } from '../lib/runtime.js'
import { resolveConfig } from '../lib/config.js'
import { createRpcDispatcher, RPC_METHODS } from '../lib/client-rpc.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'shield-rpc-'))
}

function makeRuntime() {
  return new ShieldRuntime(resolveConfig({ placeholderHash: 'legacy' }), { DSH_HOME: tempDir() })
}

// ---------- runtime.setEntities ----------

test('setEntities：合法 id 生效并重建引擎；全非法抛错', () => {
  const rt = makeRuntime()
  const result = rt.setEntities(['phone-cn', 'email', 'bogus-entity'])
  assert.equal(result.entities, 2)
  assert.deepEqual(rt.config.entities, ['phone-cn', 'email'])
  // 引擎确实重建：email 现在能命中。
  const masked = rt.engine.mask('联系 a@b.com')
  assert.equal(masked.hits.length, 1)
  assert.throws(() => rt.setEntities(['nope']), /没有可用的实体 id/)
})

// ---------- runtime.addTermLines / removeTermValues ----------

test('addTermLines：追加去重；removeTermValues：按值移除（大小写不敏感）', () => {
  const rt = makeRuntime()
  const added = rt.addTermLines(['甲公司 @org', 're:机密\\d+ @term', '甲公司 @org'])
  assert.equal(added.added, 2)
  assert.equal(added.terms, 2)
  const removed = rt.removeTermValues(['甲公司'])
  assert.equal(removed.removed, 1)
  assert.equal(removed.terms, 1)
  assert.equal(rt.termLines.length, 1)
  // 再删不存在的：removed=0 且 termLines 不变。
  const again = rt.removeTermValues(['不存在'])
  assert.equal(again.removed, 0)
  assert.equal(again.terms, 1)
})

// ---------- createRpcDispatcher ----------

test('dispatcher：status / setMode / 未知方法', () => {
  const rt = makeRuntime()
  const dispatch = createRpcDispatcher(rt, rt.config, () => 'sess-1')
  const status = dispatch('status', null)
  assert.equal(status.ok, true)
  assert.equal(status.mode, 'enforce')
  const next = dispatch('setMode', { mode: 'observe' })
  assert.equal(next.mode, 'observe')
  const bad = dispatch('nope', null)
  assert.equal(bad.ok, false)
  assert.match(bad.error, /unknown method/)
})

test('dispatcher：termsList/termsAdd/termsRemove 闭环', () => {
  const rt = makeRuntime()
  const dispatch = createRpcDispatcher(rt, rt.config, () => '')
  assert.equal(dispatch('termsAdd', { lines: ['昆仑数据库 @sys'] }).added, 1)
  assert.equal(dispatch('termsAdd', { lines: [] }).ok, false)
  const list = dispatch('termsList', null)
  assert.deepEqual(list.terms, ['昆仑数据库 @sys'])
  const removed = dispatch('termsRemove', { values: ['昆仑数据库'] })
  assert.equal(removed.removed, 1)
  assert.equal(dispatch('termsList', null).terms.length, 0)
})

test('dispatcher：setEntities 校验与快照', () => {
  const rt = makeRuntime()
  const dispatch = createRpcDispatcher(rt, rt.config, () => '')
  const ok = dispatch('setEntities', { entities: ['email'] })
  assert.equal(ok.ok, true)
  assert.equal(ok.entities, 1)
  assert.equal(ok.snapshot.entities.length, 1)
  const bad = dispatch('setEntities', { entities: [] })
  assert.equal(bad.ok, false)
})

test('dispatcher：testMask 本地即时预览（脱敏结果与计数，无报错）', () => {
  const rt = makeRuntime()
  const dispatch = createRpcDispatcher(rt, rt.config, () => '')
  const result = dispatch('testMask', { text: '电话 13800138000' })
  assert.equal(result.ok, true)
  assert.equal(result.hits, 1)
  assert.ok(result.masked.includes('PHONE'))
  assert.deepEqual(result.byLabel, { PHONE: 1 })
  assert.equal(dispatch('testMask', { text: '' }).ok, false)
})

test('dispatcher：scanDoc 写入候选池 + adopt 采纳', () => {
  const home = tempDir()
  const rt = new ShieldRuntime(resolveConfig({ placeholderHash: 'legacy' }), { DSH_HOME: home })
  const dispatch = createRpcDispatcher(rt, rt.config, () => '')
  const dir = tempDir()
  const path = join(dir, 'doc.txt')
  writeFileSync(path, '甲公司承建蓝鸟项目，编号 HT-2024-001。')
  const scanned = dispatch('scanDoc', { path })
  assert.equal(scanned.ok, true)
  assert.ok(scanned.candidates.length >= 2)
  assert.ok(rt.candidatesAlive())
  // 过期后再 adopt 应报错。
  rt.candidateStamp = Date.now() - 31 * 60 * 1000
  const stale = dispatch('adopt', { ids: ['all'] })
  assert.equal(stale.ok, false)
  assert.match(stale.error, /过期/)
  rmSync(dir, { recursive: true, force: true })
})

test('dispatcher：auditSummary 空文件也给合法聚合', () => {
  const rt = makeRuntime()
  const dispatch = createRpcDispatcher(rt, rt.config, () => '')
  const summary = dispatch('auditSummary', { days: 7 })
  assert.equal(summary.ok, true)
  assert.equal(summary.windowDays, 7)
  assert.ok(Array.isArray(summary.days))
  assert.equal(summary.days.length, 0)
  assert.equal(summary.totals.requests, 0)
  assert.equal(summary.totals.sessions, 0)
})

test('RPC_METHODS 覆盖全部 dispatcher 分支名', () => {
  const expected = ['status', 'setMode', 'setEntities', 'termsList', 'termsAdd', 'termsRemove', 'testMask', 'scanDoc', 'learn', 'adopt', 'auditSummary']
  for (const name of expected) assert.ok(RPC_METHODS.includes(name), `缺 ${name}`)
})

test('dispatcher：termsList 返回分类分布与命中计数（词表页排序用）', () => {
  const rt = makeRuntime()
  const dispatch = createRpcDispatcher(rt, rt.config, () => '')
  dispatch('termsAdd', { lines: ['昆仑数据库 @company'] })
  const before = dispatch('termsList', null)
  assert.deepEqual(before.categories, { company: 1 })
  assert.deepEqual(before.hits, {})
  // 发生一次真实脱敏后出现命中计数（键是 NFKC 小写归一后的值）。
  const masked = rt.engine.mask('昆仑数据库上线了')
  const termHits = masked.hits.filter((hit) => hit.entity === 'term')
  assert.equal(termHits.length, 1)
  const after = dispatch('termsList', null)
  assert.equal(after.hits['昆仑数据库'], 1)
})

test('dispatcher：testMask 默认不回传真值，reveal:true 才带 pairs', () => {
  const rt = makeRuntime()
  const dispatch = createRpcDispatcher(rt, rt.config, () => '')
  const text = '联系电话 13800138000'
  const plain = dispatch('testMask', { text })
  assert.equal(plain.ok, true)
  assert.equal(Object.prototype.hasOwnProperty.call(plain, 'pairs'), false)
  const revealed = dispatch('testMask', { text, reveal: true })
  assert.equal(revealed.ok, true)
  assert.ok(Array.isArray(revealed.pairs))
  assert.ok(revealed.pairs.length >= 1)
  assert.match(revealed.pairs[0].placeholder, /^<PHONE_[^>]+>$/)
  assert.equal(revealed.pairs[0].value, '13800138000')
})

test('dispatcher：status 带 host 版本（供界面提示"需重启生效"）', () => {
  const rt = makeRuntime()
  const dispatch = createRpcDispatcher(rt, rt.config, () => '')
  const status = dispatch('status', null)
  assert.match(String(status.version), /^\d+\.\d+\.\d+$/)
})
