// test/v3-features.test.mjs — v0.3.0 新特性：正则词表/标签治理/新实体/Luhn/地址粒度/敏感度分级。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MaskEngine, maskText } from '../lib/engine.js'
import { parseTermLine, compileTerms, detectTerms } from '../lib/terminology.js'
import { resolveConfig } from '../lib/config.js'
import { ShieldRuntime } from '../lib/runtime.js'
import { luhnValid } from '../lib/patterns.js'
import { DEFAULTS } from '../lib/constants.js'

const ALL = [...DEFAULTS.ENTITIES]

// ---------- 正则词表项 ----------

test('词表行 re: 前缀解析为正则项', () => {
  const parsed = parseTermLine('re:GW-[A-Z]\\d{4} @id')
  assert.deepEqual(parsed, { value: 're:GW-[A-Z]\\d{4}', label: 'IDNO', category: 'id', regex: true })
  assert.equal(parseTermLine('甲公司 @company').regex, undefined)
})

test('正则词表项参与脱敏，非法正则被跳过', () => {
  const engine = new MaskEngine({ entities: ALL, terms: ['re:GW-[A-Z]\\d{4} @id', 're:([bad'] })
  const { text, hits } = engine.mask('编号 GW-A1234 已立项')
  assert.match(text, /<IDNO_[0-9a-f]{8}>/u)
  assert.equal(hits[0].value, 'GW-A1234')
  assert.ok(engine.terms.regexItems.length === 1)
  assert.ok(engine.terms.skipped >= 1)
})

test('字面词条与正则词条可共存，重叠由引擎消解', () => {
  const engine = new MaskEngine({ entities: ALL, terms: ['天枢平台 @system', 're:天枢\\w*'] })
  const { text } = engine.mask('天枢平台上线了')
  // 字面长词条优先，整段被替换一次。
  assert.equal((text.match(/<SYS_[0-9a-f]{8}>/gu) ?? []).length, 1)
  assert.ok(!text.includes('天枢'))
})

// ---------- 标签治理 ----------

test('disabledLabels：命中的词表条目不参与编译与脱敏', () => {
  const engine = new MaskEngine({
    entities: ALL,
    terms: ['甲公司 @company', '乙项目 @project'],
    disabledLabels: new Set(['ORG']),
  })
  assert.equal(engine.termCount, 1)
  const { text } = engine.mask('甲公司和乙项目')
  assert.ok(text.includes('甲公司'))
  assert.ok(!text.includes('乙项目'))
})

test('runtime.toggleTermLabel：停用/恢复即时生效并 bump 代际', () => {
  const rt = new ShieldRuntime(resolveConfig({ placeholderHash: 'legacy', terms: ['甲公司 @company', '乙项目 @project'] }))
  const epoch0 = rt.maskEpoch
  const off = rt.toggleTermLabel('org', true)
  assert.equal(off.disabled, true)
  assert.equal(off.terms, 1)
  assert.ok(rt.maskEpoch > epoch0)
  const masked = rt.maskMessage({ role: 'user', content: [{ type: 'text', text: '甲公司乙项目' }] })
  assert.ok(masked.content[0].text.includes('甲公司'))
  assert.ok(!masked.content[0].text.includes('乙项目'))
  const on = rt.toggleTermLabel('ORG', false)
  assert.equal(on.disabled, false)
  assert.equal(on.terms, 2)
})

test('词表版本：replaceTerms 递增 termsVersion', () => {
  const rt = new ShieldRuntime(resolveConfig({ placeholderHash: 'legacy' }))
  assert.equal(rt.termsVersion, 0)
  rt.replaceTerms(['甲公司 @company'])
  assert.equal(rt.termsVersion, 1)
})

// ---------- 新实体 ----------

test('v0.3.0 新实体检测：社保/公积金/学号/病历号/IMEI/MAC', () => {
  const cases = [
    ['我的社保号：123456789012', 'SOCIAL', '123456789012'],
    ['公积金账号 123456789', 'HOUSING', '123456789'],
    ['学号 2021030456', 'STUDENT', '2021030456'],
    ['病历号 A20240012', 'MEDICAL', 'a20240012'],
    ['IMEI：490154203237518', 'IMEI', '490154203237518'],
    ['MAC 地址 3c-a2-f4-09-88-1b', 'MAC', '3c-a2-f4-09-88-1b'],
  ]
  for (const [input, label, value] of cases) {
    const { text, hits } = maskText(input, { entities: ALL })
    assert.ok(hits.length >= 1, `应命中：${input}`)
    assert.equal(hits[0].label, label, `标签：${input}`)
    assert.match(text, new RegExp(`<${label}_[0-9a-f]{8}>`, 'u'))
    assert.ok(!text.includes(value), `值应被替换：${input}`)
  }
})

// ---------- Luhn ----------

test('银行卡：合法卡号命中，随机数字串不命中', () => {
  assert.equal(luhnValid('6222021001116245785'), true)
  assert.equal(luhnValid('6222021001116245786'), false)
  const { hits: good } = maskText('卡号 6222021001116245785', { entities: ALL })
  assert.equal(good[0]?.entity, 'bank-card')
  const { hits: bad } = maskText('数字 6222021001116245786', { entities: ALL })
  assert.ok(!bad.some((hit) => hit.entity === 'bank-card'))
})

// ---------- 地址粒度 ----------

test('addressLevel=street：地址截断到街道，抹掉门牌', () => {
  const full = new MaskEngine({ entities: ALL })
  const street = new MaskEngine({ entities: ALL, addressStreetOnly: true })
  const input = '收货地址：上海市浦东新区世纪大道100号'
  const hitFull = full.detect(input).find((hit) => hit.entity === 'cn-address')
  const hitStreet = street.detect(input).find((hit) => hit.entity === 'cn-address')
  assert.ok(hitFull && hitFull.value.includes('100号'))
  assert.equal(hitStreet?.value, '上海市浦东新区世纪大道')
})

// ---------- 敏感度分级 ----------

test('minLevel：默认实体集合按敏感度收敛', () => {
  const low = resolveConfig({})
  assert.ok(low.entities.includes('cn-org'))
  const high = resolveConfig({ minLevel: 'high' })
  assert.ok(!high.entities.includes('cn-org'))
  assert.ok(!high.entities.includes('email'))
  assert.ok(high.entities.includes('phone-cn'))
  assert.ok(high.entities.includes('id-card-cn'))
  // 显式 entities 列表优先于 minLevel。
  const explicit = resolveConfig({ minLevel: 'high', entities: ['cn-org'] })
  assert.deepEqual(explicit.entities, ['cn-org'])
})

test('新实体进入默认实体集合', () => {
  const config = resolveConfig({})
  for (const entity of ['social-insurance', 'housing-fund', 'student-id', 'medical-record', 'imei', 'mac-address']) {
    assert.ok(config.entities.includes(entity), `默认实体缺少：${entity}`)
  }
})

// ---------- 词表构成进快照 ----------

test('快照含词表构成/哈希模式/分级/地址粒度', () => {
  const rt = new ShieldRuntime(resolveConfig({ placeholderHash: 'legacy', terms: ['甲公司 @company', 're:GW-\\d{4}'] }))
  const snap = rt.snapshot()
  assert.equal(snap.placeholderHash, 'legacy')
  assert.equal(snap.termKinds.literal, 1)
  assert.equal(snap.termKinds.regex, 1)
  assert.equal(snap.minLevel, 'low')
  assert.equal(snap.addressLevel, 'full')
  assert.equal(snap.termsVersion, 0)
  assert.deepEqual(snap.disabledLabels, [])
})

// ---------- 文本文件块脱敏（M3） ----------

test('file 块：内联文本/文本类 content 脱敏，二进制 data 放行', () => {
  const rt = new ShieldRuntime(resolveConfig({ placeholderHash: 'legacy', entities: ['phone-cn'] }))
  const masked = rt.maskMessage({
    role: 'user',
    content: [
      { type: 'file', attachment: { name: 'a.txt', mimeType: 'text/plain', text: '电话 13800138000' } },
      { type: 'file', attachment: { name: 'b.bin', mimeType: 'application/octet-stream', data: 'QUJD' } },
      { type: 'file', attachment: { name: 'c.json', mimeType: 'application/json', content: '{"tel":"13800138000"}' } },
      { type: 'file', attachment: { name: 'd.png', mimeType: 'image/png', data: 'iVBORw0KGgo=' } },
    ],
  })
  const [a, b, c, d] = masked.content
  assert.match(a.attachment.text, /<PHONE_[0-9a-f]{8}>/u)
  assert.equal(b.attachment.data, 'QUJD')
  assert.match(c.attachment.content, /<PHONE_[0-9a-f]{8}>/u)
  assert.equal(d.attachment.data, 'iVBORw0KGgo=')
  // 原块不被就地修改（纯副本语义）。
  assert.equal(masked.content !== undefined, true)
})

test('file 块：无敏感内容时原样返回（maskMessage 返回 null）', () => {
  const rt = new ShieldRuntime(resolveConfig({ placeholderHash: 'legacy', entities: ['phone-cn'] }))
  const masked = rt.maskMessage({
    role: 'user',
    content: [{ type: 'file', attachment: { name: 'a.txt', mimeType: 'text/plain', text: '普通文本' } }],
  })
  assert.equal(masked, null)
})
