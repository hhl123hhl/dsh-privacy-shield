// test/engine.test.mjs — 引擎/词表/流式还原的单元测试（node --test）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MaskEngine, maskText, restoreText, buildScratch, makePlaceholder } from '../lib/engine.js'
import { parseTermLine, parseTermText, compileTerms, detectTerms } from '../lib/terminology.js'
import { StreamRestorer, Vault } from '../lib/vault.js'
import { resolveConfig } from '../lib/config.js'

const ENTITIES = [
  'phone-cn', 'landline-cn', 'email', 'id-card-cn', 'bank-card', 'uscc',
  'case-no', 'plate-cn', 'wechat', 'qq', 'api-key', 'jwt',
  'cn-org', 'cn-project', 'cn-system', 'cn-id', 'cn-address', 'cn-person', 'term',
]

/** 建一个引擎（默认全实体开启）。 */
function engine(terms = [], entities = ENTITIES) {
  return new MaskEngine({ entities, terms })
}

test('手机号被替换成占位符，且不再出现原号码', () => {
  const { text, hits } = engine().mask('请联系我 13800138000 谢谢')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].entity, 'phone-cn')
  assert.match(text, /<PHONE_[0-9a-f]{8}>/u)
  assert.ok(!text.includes('13800138000'))
})

test('同一原文在同一会话内始终得到同一占位符（确定性）', () => {
  const masker = engine()
  const first = masker.mask('号码 13800138000')
  const second = masker.mask('再写一次 13800138000')
  assert.equal(first.hits[0].placeholder, second.hits[0].placeholder)
})

test('占位符与标签无关的取值稳定：makePlaceholder 是纯函数', () => {
  assert.equal(makePlaceholder('PHONE', '13800138000'), makePlaceholder('PHONE', '13800138000'))
  assert.notEqual(makePlaceholder('PHONE', '13800138000'), makePlaceholder('PHONE', '13800138001'))
})

test('中文机构名：后缀键控 + 前缀回溯，不吞掉后随的"的"', () => {
  const { text, hits } = engine().mask('北京星辰科技有限公司的项目进展')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].value, '北京星辰科技有限公司')
  assert.equal(text, `${hits[0].placeholder}的项目进展`)
})

test('中文机构名：连写的集团+分公司合成一个整体', () => {
  const { hits } = engine().mask('某某集团有限公司北京分公司')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].value, '某某集团有限公司北京分公司')
})

test('引导词不进入机构名', () => {
  const { hits } = engine().mask('供应商：上海云帆信息技术有限公司（甲方）')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].value, '上海云帆信息技术有限公司')
})

test('项目名/系统名：引导词 + 冒号', () => {
  const proj = engine().mask('项目名称：天枢计划，负责人：李四')
  assert.ok(proj.hits.some((hit) => hit.entity === 'cn-project' && hit.value === '天枢计划'))
  const sys = engine().mask('系统名称：XX核心交易系统')
  assert.ok(sys.hits.some((hit) => hit.entity === 'cn-system' && hit.value === 'XX核心交易系统'))
})

test('编号：引导词式与前缀式', () => {
  const labeled = engine().mask('合同编号：HT-2024-001 已归档')
  assert.ok(labeled.hits.some((hit) => hit.entity === 'cn-id' && hit.value.toUpperCase().includes('HT-2024-001')))
  const prefixed = engine().mask('参见 PRJ-2026-0007 文档')
  assert.ok(prefixed.hits.some((hit) => hit.entity === 'cn-id'))
})

test('地址：省市区 + 街道门牌', () => {
  const { hits } = engine().mask('地址是北京市海淀区中关村大街1号')
  assert.ok(hits.some((hit) => hit.entity === 'cn-address'))
})

test('人名：联系人引导', () => {
  const { hits } = engine().mask('联系人：张三，电话 13800138000')
  assert.ok(hits.some((hit) => hit.entity === 'cn-person' && hit.value === '张三'))
  assert.ok(hits.some((hit) => hit.entity === 'phone-cn'))
})

test('身份证优先于银行卡（重叠消解取高置信度）', () => {
  const { hits } = engine().mask('身份证 110101199003078515 已核验')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].entity, 'id-card-cn')
})

test('词表：分类标签决定占位符前缀，且最长优先', () => {
  const terms = parseTermText([
    '# 公司',
    '某某科技有限公司   @company',
    '某某科技           @company',
    'Project Bluebird  @project',
    'HT-2024-001       @id',
  ].join('\n'))
  const masker = engine(terms)
  const org = masker.mask('甲方是某某科技有限公司')
  assert.equal(org.hits.length, 1)
  assert.equal(org.hits[0].label, 'ORG')
  assert.equal(org.hits[0].value, '某某科技有限公司')
  const proj = masker.mask('谈谈 project bluebird 的进度')
  assert.equal(proj.hits[0].label, 'PROJ')
  const id = masker.mask('引用 HT-2024-001')
  assert.equal(id.hits[0].label, 'IDNO')
})

test('词表：英文大小写不敏感（归一化后匹配）', () => {
  const masker = engine(parseTermText('Acme Corp @company'))
  const { hits } = masker.mask('about ACME CORP and acme corp')
  assert.equal(hits.length, 2)
})

test('词表行解析：注释、空行、行尾分类、行内注释', () => {
  assert.equal(parseTermLine('# 注释'), null)
  assert.equal(parseTermLine('   '), null)
  assert.deepEqual(parseTermLine('某公司 @company'), { value: '某公司', label: 'ORG', category: 'company' })
  assert.equal(parseTermLine('某公司').label, 'TERM')
  assert.equal(parseTermLine('某公司 # 说明').value, '某公司')
})

test('已存在的占位符不会被二次脱敏', () => {
  const masker = engine(parseTermText('某某科技有限公司 @company'))
  const once = masker.mask('某某科技有限公司').text
  const twice = masker.mask(once).text
  assert.equal(once, twice)
})

test('还原：占位符换回原文', () => {
  const masker = engine()
  const { text } = masker.mask('电话 13800138000')
  const vault = new Vault()
  const result = masker.mask('电话 13800138000')
  for (const hit of result.hits) vault.record(hit.placeholder, hit.value, hit.label)
  assert.equal(restoreText(text, (placeholder) => vault.lookup(placeholder)), '电话 13800138000')
})

test('流式还原：占位符被切在 chunk 边界也能还原', () => {
  const vault = new Vault()
  const placeholder = makePlaceholder('PHONE', '13800138000')
  vault.record(placeholder, '13800138000', 'PHONE')
  const restorer = new StreamRestorer({ lookup: (key) => vault.lookup(key) })
  const combined = placeholder + ' 结束'
  const parts = [combined.slice(0, 3), combined.slice(3, 9), combined.slice(9)]
  let out = ''
  for (const part of parts) out += restorer.push(part)
  out += restorer.flush()
  assert.equal(out, '13800138000 结束')
})

test('流式还原：小写尖括号文本不会被扣留', () => {
  const restorer = new StreamRestorer({ lookup: () => undefined })
  assert.equal(restorer.push('hello <world'), 'hello <world')
  assert.equal(restorer.flush(), '')
})

test('流式还原：大写但不完整的尾巴会被扣住，等补齐后再放行', () => {
  const restorer = new StreamRestorer({ lookup: () => undefined })
  assert.equal(restorer.push('see <PHO'), 'see ')
  assert.equal(restorer.push('NE_abcd1234> now'), '<PHONE_abcd1234> now')
  assert.equal(restorer.flush(), '')
})

test('归一化：全角数字与中文标点也能命中（映射回原文偏移）', () => {
  const { text, hits } = maskText('电话：１３８００１３８０００', { entities: ['phone-cn'] })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].value, '１３８００１３８０００')
  assert.match(text, /<PHONE_[0-9a-f]{8}>/u)
})

test('普通技术文本不产生误报', () => {
  const sample = 'HTTP 200 OK; the build finished in 1.5s; version 1.2.3; see README.md'
  const { hits } = engine().mask(sample)
  assert.deepEqual(hits, [])
})

test('buildScratch：长度不变时走恒等映射', () => {
  const { scratch, map } = buildScratch('ABC')
  assert.equal(scratch, 'abc')
  assert.equal(map, null)
})

test('会话过滤已移除：sessionFilter 被忽略并降级为提示', () => {
  const config = resolveConfig({ sessionFilter: { exclude: ['session-1'] } })
  assert.equal(config.sessionFilter, undefined)
  assert.equal(config.notices.length, 1)
  assert.match(config.notices[0], /sessionFilter/u)
})

test('配置归一化：非法实体被丢弃、默认值兜底', () => {
  const config = resolveConfig({ entities: ['phone-cn', '不存在的实体'], mode: 'bogus' })
  assert.deepEqual(config.entities, ['phone-cn'])
  assert.equal(config.mode, 'observe')
  assert.equal(config.mediaPolicy, 'pass')
  assert.equal(config.audit.verifyOutbound, 'full')
})
