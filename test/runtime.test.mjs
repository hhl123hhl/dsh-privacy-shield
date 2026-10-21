// test/runtime.test.mjs — 运行时（脱敏副本、还原、出境审计、统计、derive 补丁门控）的单元测试（node --test）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ShieldRuntime } from '../lib/runtime.js'
import { resolveConfig } from '../lib/config.js'
import { MODES } from '../lib/constants.js'
import { installDerivePatch, hasDerivePatch } from '../lib/derive-patch.js'

/** 建一个运行时（config 走真实归一化路径）。默认 legacy 哈希：测试不碰真实密钥文件。 */
function runtime(config = {}) {
  return new ShieldRuntime(resolveConfig({ placeholderHash: 'legacy', ...config }))
}

/** 造一条 user 消息。 */
function userMessage(text, extra = {}) {
  return { id: 'm1', role: 'user', source: 'user', content: [{ type: 'text', text }], ...extra }
}

// ---------- 模式与开关 ----------

test('默认配置为 enforce 且启用；protecting = 启用 && enforce', () => {
  const rt = runtime({})
  assert.equal(rt.mode, MODES.ENFORCE)
  assert.equal(rt.protecting, true)
  rt.setEnforcing(false)
  assert.equal(rt.mode, MODES.OBSERVE)
  assert.equal(rt.protecting, false)
  rt.setEnforcing(true)
  rt.active = false
  assert.equal(rt.protecting, false)
})

test('setMode：只接受 enforce/observe，其余拒绝且不改动状态', () => {
  const rt = runtime({})
  assert.equal(rt.setMode('observe'), true)
  assert.equal(rt.mode, MODES.OBSERVE)
  assert.equal(rt.setMode('strict'), false)
  assert.equal(rt.mode, MODES.OBSERVE)
  assert.equal(rt.setMode('enforce'), true)
})

// ---------- 脱敏副本 ----------

test('sessionAllowed：会话无关，只取决于全局开关（浏览器半边契约）', () => {
  const rt = runtime({})
  assert.equal(rt.sessionAllowed('session-x'), true)
  assert.equal(rt.sessionAllowed(''), true)
  rt.active = false
  assert.equal(rt.sessionAllowed('session-x'), false)
})

test('maskMessage：改写的是副本，原消息与本地记录不被碰（纯副本语义）', () => {
  const rt = runtime({})
  const original = userMessage('联系我 13800138000')
  const masked = rt.maskMessage(original)
  assert.notEqual(masked, null)
  assert.equal(masked.id, 'm1')
  assert.equal(masked.role, 'user')
  assert.equal(masked.source, 'user')
  assert.ok(!masked.content[0].text.includes('13800138000'))
  assert.match(masked.content[0].text, /<PHONE_[0-9a-f]{8}>/u)
  // 原消息内容仍是明文。
  assert.equal(original.content[0].text, '联系我 13800138000')
})

test('maskMessage：无敏感内容时返回 null（投影据此放行原文）', () => {
  const rt = runtime({})
  assert.equal(rt.maskMessage(userMessage('今天天气不错')), null)
  assert.equal(rt.maskMessage({ id: 'x' }), null) // 没有 content 数组
  assert.equal(rt.maskMessage(null), null)
})

test('maskBlock：图片/文件块按 mediaPolicy=pass 原样放行（同一引用）', () => {
  const rt = runtime({})
  const image = { type: 'image', url: 'file:///secret.png' }
  const file = { type: 'file', path: 'D:/机密.pdf' }
  assert.equal(rt.maskBlock(image), image)
  assert.equal(rt.maskBlock(file), file)
})

test('maskBlock：tool-call 的 arguments 字符串也被脱敏', () => {
  const rt = runtime({})
  const block = { type: 'tool-call', id: 'call-1', name: 'send_mail', arguments: '{"to":"a@b.com"}' }
  const masked = rt.maskBlock(block)
  assert.notEqual(masked, block)
  assert.ok(!masked.arguments.includes('a@b.com'))
  assert.equal(block.arguments, '{"to":"a@b.com"}')
})

// ---------- 还原与 vault ----------

test('restore：占位符换回真值并累计 restoredValues；未知占位符原样保留', () => {
  const rt = runtime({})
  const masked = rt.maskMessage(userMessage('号码 13800138000'))
  const placeholder = rt.stats.byLabel.PHONE === 1 ? masked.content[0].text.match(/<PHONE_[0-9a-f]{8}>/u)[0] : ''
  assert.equal(rt.restore(`请回拨 ${placeholder}`), '请回拨 13800138000')
  assert.equal(rt.stats.restoredValues, 1)
  assert.equal(rt.restore('未知 <PHONE_ffffffff> 保留'), '未知 <PHONE_ffffffff> 保留')
})

test('vault 有上限：超出 maxVaultEntries 后逐出最旧条目', () => {
  const rt = runtime({ maxVaultEntries: 100 })
  for (let i = 0; i < 150; i += 1) {
    const tail = String(i).padStart(8, '0')
    rt.maskMessage(userMessage(`号码 138${tail.slice(0, 8)}`))
  }
  assert.ok(rt.vault.size <= 100)
})

// ---------- 出境审计 ----------

test('auditOutbound：统计占位符与标签分布、记录会话、无残留时违规为 0', () => {
  const rt = runtime({})
  const { placeholders, byLabel, violations } = rt.auditOutbound({
    sessionId: 'session-x',
    messages: [userMessage('回拨 <PHONE_1a2b3c4d> 谢谢')],
  })
  assert.equal(placeholders, 1)
  assert.equal(byLabel.PHONE, 1)
  assert.equal(violations, 0)
  assert.equal(rt.stats.outboundRequests, 1)
  assert.equal(rt.stats.sessions.has('session-x'), true)
})

test('auditOutbound：enforce 下检出明文残留 → 计入违规并记录标签（不含明文本身）', () => {
  const rt = runtime({})
  const { violations } = rt.auditOutbound({
    sessionId: 'session-y',
    messages: [userMessage('明文手机号 13800138000 出境了')],
  })
  assert.ok(violations >= 1)
  assert.equal(rt.stats.violations, violations)
  assert.ok(Array.isArray(rt.stats.lastViolation.labels))
  assert.ok(!('text' in rt.stats.lastViolation))
  assert.equal(rt.stats.lastViolation.sessionId, 'session-y')
})

test('auditOutbound：observe 模式跳过明文残留自检（只统计不告警）', () => {
  const rt = runtime({})
  rt.setEnforcing(false)
  const { violations } = rt.auditOutbound({
    messages: [userMessage('明文手机号 13800138000')],
  })
  assert.equal(violations, 0)
  assert.equal(rt.stats.violations, 0)
})

test('auditOutbound：verifyOutbound=off 时不做残留自检', () => {
  const rt = runtime({ audit: { verifyOutbound: 'off' } })
  const { violations } = rt.auditOutbound({
    messages: [userMessage('明文手机号 13800138000')],
  })
  assert.equal(violations, 0)
})

// ---------- 词表与规则包应用 ----------

test('replaceTerms：重编译词表，旧词不再命中，termsByLabel 只给计数', () => {
  const rt = runtime({})
  rt.replaceTerms(['甲公司 @company'])
  assert.equal(rt.engine.termCount, 1)
  assert.deepEqual({ ...rt.termsByLabel() }, { ORG: 1 })
  const masked = rt.maskMessage(userMessage('甲公司的报告'))
  assert.ok(!masked.content[0].text.includes('甲公司'))
  // 旧词表里的词（若之前有）不再命中：换词表后乙公司不在词表。
  assert.equal(rt.maskMessage(userMessage('乙公司的报告')), null)
})

test('applyRules：过滤未知实体，词表整体替换，返回生效规模', () => {
  const rt = runtime({})
  const result = rt.applyRules({ entities: ['phone-cn', 'bogus'], terms: ['丙公司 @company'] })
  assert.deepEqual(rt.config.entities, ['phone-cn'])
  assert.equal(result.entities, 1)
  assert.equal(result.terms, 1)
})

// ---------- derive 补丁门控 ----------

/** 造一个最小 Session 假类（只实现 deriveEventMessage）。 */
function fakeSessionClass(message) {
  return class FakeSession {
    deriveEventMessage() { return message }
  }
}

test('derive 补丁：protecting 时返回脱敏副本；observe 时原样放行', () => {
  const message = userMessage('号码 13800138000')
  const event = { seq: 7, type: 'user/message' }

  const enforcing = runtime({})
  const cls = fakeSessionClass(message)
  assert.equal(installDerivePatch(cls, enforcing), true)
  const masked = new cls().deriveEventMessage(event)
  assert.equal(masked.content[0].text.includes('13800138000'), false)
  assert.equal(enforcing.stats.maskedTexts, 1)

  const observing = runtime({})
  observing.setEnforcing(false)
  const cls2 = fakeSessionClass(message)
  installDerivePatch(cls2, observing)
  assert.equal(new cls2().deriveEventMessage(event), message)
  assert.equal(observing.stats.maskedTexts, 1) // observe 下掩码仍跑一遍，保留统计信号
})

test('derive 补丁：surfaces 关闭的类型不脱敏', () => {
  const message = userMessage('号码 13800138000')
  const rt = runtime({ surfaces: { system: true, developer: true, user: false, assistant: true, tool: true } })
  const cls = fakeSessionClass(message)
  installDerivePatch(cls, rt)
  assert.equal(new cls().deriveEventMessage({ type: 'user/message' }), message)
})

test('derive 补丁：按消息身份缓存，重复派生不重复计数', () => {
  const message = userMessage('号码 13800138000')
  const rt = runtime({})
  const cls = fakeSessionClass(message)
  installDerivePatch(cls, rt)
  const session = new cls()
  session.deriveEventMessage({ type: 'user/message' })
  session.deriveEventMessage({ type: 'user/message' })
  session.deriveEventMessage({ type: 'user/message' })
  assert.equal(rt.stats.maskedTexts, 1)
  assert.equal(rt.vault.size, 1)
})

test('derive 补丁：引擎重建（maskEpoch+1）后缓存失效，用新词表重算', () => {
  const message = userMessage('甲公司 13800138000')
  const rt = runtime({})
  const cls = fakeSessionClass(message)
  installDerivePatch(cls, rt)
  const session = new cls()
  const first = session.deriveEventMessage({ type: 'user/message' })
  assert.equal(first.content[0].text.includes('甲公司'), true) // epoch0 无词表，不掩
  assert.equal(first.content[0].text.includes('13800138000'), false)
  rt.replaceTerms(['甲公司 @company'])
  const second = session.deriveEventMessage({ type: 'user/message' })
  assert.equal(second.content[0].text.includes('甲公司'), false)
  assert.equal(rt.stats.maskedTexts, 2)
})

test('derive 补丁：绝不抛错——派生异常退化为原始消息并记错误', () => {
  const message = userMessage('号码 13800138000')
  const rt = runtime({})
  rt.maskMessage = () => { throw new Error('boom') }
  const cls = fakeSessionClass(message)
  installDerivePatch(cls, rt)
  assert.equal(new cls().deriveEventMessage({ type: 'user/message' }), message)
  assert.equal(rt.stats.errors.length, 1)
  assert.equal(rt.stats.errors[0].where, 'derive-patch')
})

test('derive 补丁：幂等——同类重复安装只换运行时引用，不层层包裹', () => {
  const message = userMessage('号码 13800138000')
  const cls = fakeSessionClass(message)
  const rt1 = runtime({})
  const rt2 = runtime({})
  assert.equal(installDerivePatch(cls, rt1), true)
  assert.equal(installDerivePatch(cls, rt2), true)
  assert.equal(hasDerivePatch(cls), true)
  // 第二次安装后补丁应指向新运行时（observe 下不再脱敏）。
  rt2.setEnforcing(false)
  assert.equal(new cls().deriveEventMessage({ type: 'user/message' }), message)
  assert.equal(rt1.stats.maskedTexts, 0)
})

test('derive 补丁：宿主结构不符合预期时安静降级', () => {
  class Empty {}
  const rt = runtime({})
  assert.equal(installDerivePatch(Empty, rt), false)
  assert.equal(installDerivePatch(null, rt), false)
  assert.equal(installDerivePatch({}, rt), false)
})

// ---------- 快照 ----------

test('snapshot：包含模式、开关、实体、词表、vault、补丁与统计（不含明文）', () => {
  const rt = runtime({ terms: ['甲公司 @company'] })
  rt.maskMessage(userMessage('甲公司 13800138000'))
  const snap = rt.snapshot()
  assert.equal(snap.mode, MODES.ENFORCE)
  assert.equal(snap.active, true)
  assert.equal(snap.terms, 1)
  assert.ok(snap.vault >= 2)
  assert.equal(snap.maskedTexts, 1)
  assert.ok(snap.surfaces.includes('user'))
  const serialized = JSON.stringify(snap)
  assert.ok(!serialized.includes('13800138000'))
  assert.ok(!serialized.includes('甲公司'))
})
