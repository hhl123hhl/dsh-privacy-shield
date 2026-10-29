// test/name-candidates.test.mjs — 无引导词专名的多路候选召回（第 2 轮回归）。
//
// 事故背景：候选召回只认"引导词 / 词典后缀 / 高频片段"三路，于是
// 「智慧园区」「星联智造」「蓝鸟计划」这类没有引导词、也不在词典后缀里的专名
// 既不会被遮，也不会出现在候选里——用户根本不知道有东西漏了。
// 这里锁住多路召回：列语义 / 上下文同现 / 引号包裹 / 期次后缀 / 高频片段。

import test from 'node:test'
import assert from 'node:assert/strict'

import { collectNameCandidates, mergeCandidateInto } from '../lib/name-candidates.js'
import { extractCandidates } from '../lib/scan-doc.js'

/** 只在候选里找指定值。 */
function find(candidates, value) {
  return candidates.find((item) => item.value === value)
}

test('列语义：项目名称列的裸值（无引导词、无后缀）也进候选', () => {
  const tsv = [
    ['合同编号', '项目名称', '是否验收'].join('\t'),
    ['XMHT-PMC-2020001', '智慧园区', '是'].join('\t'),
    ['XMHT-PMC-2020002', '智慧园区', '是'].join('\t'),
  ].join('\n')
  const candidates = collectNameCandidates(tsv)
  const hit = find(candidates, '智慧园区')
  assert.ok(hit, '智慧园区 应进候选')
  assert.equal(hit.label, 'PROJ')
  assert.equal(hit.source, '列语义')
  assert.ok(hit.evidence.some((entry) => entry.includes('项目名称')))
  // 两行同值 → 列语义各计一次，高频兜底可能再叠加，这里只要求"多行累计"。
  assert.ok(hit.count >= 2)
})

test('列语义：客户名称列的值按机构召回', () => {
  const tsv = [
    ['客户名称', '合同名称'].join('\t'),
    ['蓝鸟北分', '机房升级'].join('\t'),
  ].join('\n')
  const candidates = collectNameCandidates(tsv)
  const hit = find(candidates, '蓝鸟北分')
  assert.ok(hit, '蓝鸟北分 应进候选')
  assert.equal(hit.label, 'ORG')
  assert.equal(hit.source, '列语义')
})

test('上下文同现：与"验收"同句的片段被召回', () => {
  const text = '本次验收由星联智造负责。\n本次验收由星联智造负责。'
  const candidates = collectNameCandidates(text)
  const hit = find(candidates, '星联智造')
  assert.ok(hit, '星联智造 应进候选')
  assert.equal(hit.source, '上下文同现')
  assert.equal(hit.count, 2)
})

test('引号包裹：《蓝鸟计划》按项目名召回', () => {
  // "计划"同时也是宽后缀，可能先被后缀路径召回；关键是书名号证据进来了。
  const candidates = collectNameCandidates('本期《蓝鸟计划》进入联调阶段。')
  const hit = find(candidates, '蓝鸟计划')
  assert.ok(hit)
  assert.equal(hit.label, 'PROJ')
  assert.ok(hit.evidence.some((entry) => entry.includes('书名号')), '应带书名号证据')
})

test('期次后缀：智慧园区平台二期整体召回', () => {
  // 该句同时含线索词"上线"，可能先被"上下文同现"召回；
  // 关键不是来源标签，而是整名（含期次）进了候选且带期次证据。
  const candidates = collectNameCandidates('智慧园区平台二期已经上线。')
  const hit = find(candidates, '智慧园区平台二期')
  assert.ok(hit, '带期次后缀的整名应进候选')
  assert.ok(['PROJ', 'SYS'].includes(hit.label))
  assert.ok(hit.evidence.some((entry) => entry.includes('期次')), '应带期次后缀证据')
})

test('已覆盖剔除：引擎已能命中的值不再推荐', () => {
  const engine = { detect: () => [{ value: '蓝鸟计划' }] }
  const candidates = collectNameCandidates('《蓝鸟计划》与《星联智造》同时出现。', { engine })
  assert.equal(find(candidates, '蓝鸟计划'), undefined)
  assert.ok(find(candidates, '星联智造'), '未覆盖的仍应保留')
})

test('普通句子不产生噪声候选', () => {
  const candidates = collectNameCandidates('今天天气不错，我们去吃饭吧。')
  assert.deepEqual(candidates, [])
})

test('只有后缀外壳的碎片不进候选（有限公司 / 分公司 / 项目部）', () => {
  // 真实材料里这类碎片常靠"高频"混进候选，确认后就是一条永远匹配不到专名的噪声规则。
  const text = '有限公司 有限公司 有限公司 分公司 分公司 项目部 项目部 项目部'
  const candidates = collectNameCandidates(text, { minCount: 1 })
  const values = candidates.map((item) => item.value)
  assert.ok(!values.includes('有限公司'), '只有后缀的碎片应被剔除')
  assert.ok(!values.includes('分公司'), '只有后缀的碎片应被剔除')
  assert.ok(!values.includes('项目部'), '只有后缀的碎片应被剔除')
})

test('mergeCandidateInto：计数取较大者、标签就高、证据合并', () => {
  const map = new Map()
  mergeCandidateInto(map, { value: '智慧园区', count: 1, label: 'TERM', source: '上下文同现', evidence: ['同句'] })
  mergeCandidateInto(map, { value: '智慧园区', count: 3, label: 'PROJ', source: '列语义', evidence: ['列头「项目名称」'] })
  const item = map.get('智慧园区')
  // 多路重复召回不累加：取较强路径的计数，避免虚报出现次数。
  assert.equal(item.count, 3)
  assert.equal(item.label, 'PROJ')
  assert.equal(item.evidence.length, 2)
})

test('scan-doc 集成：多路候选进入 extractCandidates', () => {
  const tsv = [
    ['项目名称', '验收状态'].join('\t'),
    ['智慧园区', '已验收'].join('\t'),
  ].join('\n')
  const candidates = extractCandidates(tsv, undefined)
  const hit = find(candidates, '智慧园区')
  assert.ok(hit, 'scan-doc 应召回列语义候选')
  assert.ok(Array.isArray(hit.evidence) && hit.evidence.length > 0)
})
