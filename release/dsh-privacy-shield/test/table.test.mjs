// test/table.test.mjs — 表格列语义脱敏（真实泄露复盘回归）。
//
// 事故：客户 xlsx 被读成 TSV 后，模型看到的是裸值 —— 人名、项目名、金额全明文，
// 只有带「有限公司/中心」后缀的机构名被遮住。项目名 + 合同号组合足以反查客户，
// 去标识化形同虚设。这里锁住修复后的行为：
//   1. 表头 → 列角色（person/org/unit/proj/money/id），裸值也能命中；
//   2. 金额默认不遮（用户要 DSH 算数与统计），只在显式启用 money 时才遮；
//   3. 枚举列（类型/来源/计数/行业/是否）一律不动，避免把「历史」「2022」遮掉。

import test from 'node:test'
import assert from 'node:assert/strict'

import { maskText } from '../lib/engine.js'
import { MaskEngine } from '../lib/engine.js'
import { DEFAULT_ENTITIES } from '../lib/constants.js'
import { COLUMN_ROLES, detectColumnRole } from '../lib/table.js'

const HEADER = [
  '合同编号', '是否2022结算', '实施是否亏损', '是否全部到款', '客户名称', '客户联系人',
  '项目类型', '销售', '项目来源', '项目计数', '行业', '合同名称', '合同乙方', '总金额',
]

const ROWS = [
  ['XMHT-PMC-2020001', '历史', '是', '是', '某某市某区退役军人事务局', '赵敏', '历史', '李芳', '直签', '1', '政府', '某某区政务服务大厅设备及平台建设', '辰星信息安全科技（北京）有限公司', '128600'],
  ['京分-XMHT-BPMC-2020002', '历史', '是', '是', '某某市某区经济和信息化局', '张伟', '历史', '合作伙伴管理部', '刘洋', '1', '政府', '某某区智慧政务建设项目', '辰星信息安全科技（北京）有限公司', '96420'],
  ['XMHT-BPMC-2020003', '2022', '', '', '某某市某区财政局', '陈静', '历史', '张伟', '直签', '1', '院所', '配网工程设计辅助系统2021', '辰星信息安全科技（北京）有限公司', '45820'],
  ['XMHT-BPMC-2020004', '历史', '', '', '某某市新闻出版局（某某市版权局）', '王磊', '历史', '合作伙伴管理部', '直签', '1', '政府', '生产运营业务管控平台', '辰星信息安全科技（北京）有限公司', '864200'],
  ['XMHT-PMC-1-2020005', '历史', '', '', '某某市某区委社工委区民政局', '江楠', '检验检测', '孙明', '直签', '1', '国网', '某区“热线+网格”融合提升项目', '辰星信息安全科技（北京）有限公司', '36.50'],
]

const tsv = (rows) => [HEADER.join('\t'), ...rows.map((row) => row.join('\t'))].join('\n')

test('表头 → 列角色：只认出有语义的列', () => {
  assert.equal(detectColumnRole('客户联系人'), COLUMN_ROLES.person)
  assert.equal(detectColumnRole('销售'), COLUMN_ROLES.person)
  assert.equal(detectColumnRole('客户名称'), COLUMN_ROLES.org)
  assert.equal(detectColumnRole('合同乙方'), COLUMN_ROLES.org)
  assert.equal(detectColumnRole('合同名称'), COLUMN_ROLES.proj)
  assert.equal(detectColumnRole('项目名称'), COLUMN_ROLES.proj)
  assert.equal(detectColumnRole('合同编号'), COLUMN_ROLES.id)
  assert.equal(detectColumnRole('总金额'), COLUMN_ROLES.money)
  assert.equal(detectColumnRole('项目来源'), COLUMN_ROLES.unit)
  // 枚举/计数/是否列必须不认领，否则「历史」「1」「2022」会被当成敏感值。
  for (const header of ['项目类型', '项目计数', '是否2022结算', '实施是否亏损', '行业', '序号']) {
    assert.equal(detectColumnRole(header), null, header + ' 不应被当作敏感列')
  }
})

test('裸人名按列语义命中（无需"姓名："引导词）', () => {
  const { text } = maskText(tsv(ROWS), { entities: [...DEFAULT_ENTITIES] })
  for (const name of ['赵敏', '李芳', '张伟', '刘洋', '陈静', '王磊', '江楠', '孙明']) {
    assert.ok(!text.includes(name), '人名明文出境：' + name)
  }
  assert.match(text, /<PERSON_[0-9a-f]{8}>/u)
})

test('机构名：裸"局"后缀与括号内嵌都要遮', () => {
  const { text } = maskText(tsv(ROWS), { entities: [...DEFAULT_ENTITIES] })
  for (const org of [
    '某某市某区退役军人事务局',
    '某某市某区经济和信息化局',
    '某某市某区财政局',
    '北京市新闻出版局',
    '某某市版权局',
    '辰星信息安全科技（北京）有限公司',
    '某某市某区委社工委区民政局',
  ]) {
    assert.ok(!text.includes(org), '机构名明文出境：' + org)
  }
})

test('项目名整格遮蔽，编号按列遮蔽', () => {
  const { text } = maskText(tsv(ROWS), { entities: [...DEFAULT_ENTITIES] })
  for (const project of ['某某区智慧政务建设项目', '配网工程设计辅助系统2021', '生产运营业务管控平台']) {
    assert.ok(!text.includes(project), '项目名明文出境：' + project)
  }
  for (const id of ['XMHT-PMC-2020001', '京分-XMHT-BPMC-2020002', 'XMHT-PMC-1-2020005']) {
    assert.ok(!text.includes(id), '编号明文出境：' + id)
  }
  assert.match(text, /<PROJ_[0-9a-f]{8}>/u)
  assert.match(text, /<IDNO_[0-9a-f]{8}>/u)
})

test('部门值按机构遮（列头写"销售"，实际填"合作伙伴管理部"）', () => {
  const { text } = maskText(tsv(ROWS), { entities: [...DEFAULT_ENTITIES] })
  assert.ok(!text.includes('合作伙伴管理部'), '部门名明文出境')
})

test('金额默认保留（用户要 DSH 算数与统计）', () => {
  const { text } = maskText(tsv(ROWS), { entities: [...DEFAULT_ENTITIES] })
  for (const amount of ['128600', '96420', '864200', '36.50', '45820']) {
    assert.ok(text.includes(amount), '金额被误遮：' + amount)
  }
  // 显式启用 money 时才遮（能力保留，默认关闭）。
  const on = maskText(tsv(ROWS), { entities: [...DEFAULT_ENTITIES, 'money'] })
  assert.ok(!on.text.includes('128600'), '启用 money 后金额仍明文')
  assert.match(on.text, /<MONEY_[0-9a-f]{8}>/u)
})

test('枚举值不被误遮', () => {
  const { text } = maskText(tsv(ROWS), { entities: [...DEFAULT_ENTITIES] })
  for (const plain of ['历史', '直签', '检验检测', '政府', '国网', '院所', '是否全部到款', '客户名称', '项目计数']) {
    assert.ok(text.includes(plain), '枚举/表头被误遮：' + plain)
  }
})

test('占位符确定性：同一原文两次脱敏结果一致', () => {
  const first = maskText(tsv(ROWS), { entities: [...DEFAULT_ENTITIES] }).text
  const second = maskText(tsv(ROWS), { entities: [...DEFAULT_ENTITIES] }).text
  assert.equal(first, second)
})

test('Markdown 管道表同样识别', () => {
  const md = [
    '| 客户名称 | 客户联系人 | 合同名称 | 总金额 |',
    '| --- | --- | --- | --- |',
    '| 某某市某区财政局 | 陈静 | 配网工程设计辅助系统2021 | 45820 |',
  ].join('\n')
  const { text } = maskText(md, { entities: [...DEFAULT_ENTITIES] })
  assert.ok(!text.includes('某某市某区财政局'))
  assert.ok(!text.includes('陈静'))
  assert.ok(!text.includes('配网工程设计辅助系统2021'))
  assert.ok(text.includes('45820'))
})

test('普通段落不因表格逻辑产生误报', () => {
  const prose = '这次的打印布局要重做，全局变量和局部变量都要统一命名，数据总量 4 个。'
  const { text } = maskText(prose, { entities: [...DEFAULT_ENTITIES] })
  assert.equal(text, prose)
})

// ---------------------------------------------------------------------------
// 真实会话回归（session-xxxxxxxx）：工具结果是**被截断的带行号 pretty JSON**，
// 整段不可 JSON.parse，旧实现一条都没遮住（人名、销售、合同号明文出境）。
// ---------------------------------------------------------------------------
test('截断的带行号 pretty JSON：表头 + 行块仍能按列遮', () => {
  const dump = [
    'totalLines=2835',
    '1|{',
    '2| "rows": {',
    '3|  "云海数据北分": [',
    '4|   [',
    '5|    "合同编号",',
    '6|    "客户名称",',
    '7|    "客户联系人",',
    '8|    "销售",',
    '9|    "总金额"',
    '10|   ],',
    '11|   [',
    '12|    "cstb-pmc-2020245",',
    '13|    "云海数据北分",',
    '14|    "欧阳山",',
    '15|    "司马青",',
    '16|    "128600"',
    '17|   ]',
    // 故意截断在此：没有闭合括号，模拟真实工具输出被裁掉
  ].join('\n')
  const { text } = maskText(dump, { entities: [...DEFAULT_ENTITIES] })
  assert.ok(!text.includes('云海数据北分'), '客户名称应被遮')
  assert.ok(!text.includes('欧阳山'), '联系人应被遮')
  assert.ok(!text.includes('司马青'), '销售应被遮')
  assert.ok(!text.includes('cstb-pmc-2020245'), '合同号应被遮')
  assert.ok(text.includes('totalLines=2835'), '前缀行应原样保留')
})

test('键值对形态："销售": "诸葛明" 也要遮', () => {
  const json = '{\n "销售": "诸葛明",\n "合同数": 6\n}'
  const { text } = maskText(json, { entities: [...DEFAULT_ENTITIES] })
  assert.ok(!text.includes('诸葛明'))
  assert.ok(text.includes('"合同数": 6'), '数字不遮')
})

test('聚合对象键形态：paid_by_sales / distinct_sales 的子键也要遮', () => {
  const pretty = '{\n "paid_by_sales": {\n  "上官云": {\n   "n": 51\n  },\n  "诸葛明": {\n   "n": 6\n  }\n }\n}'
  const maskedPretty = maskText(pretty, { entities: [...DEFAULT_ENTITIES] }).text
  assert.ok(!maskedPretty.includes('上官云'))
  assert.ok(!maskedPretty.includes('诸葛明'))

  const repr = "{'distinct_sales': {\"'司马青'\": 8, \"'星辰数据服务部'\": 36}}"
  const maskedRepr = maskText(repr, { entities: [...DEFAULT_ENTITIES] }).text
  assert.ok(!maskedRepr.includes('司马青'), 'pandas repr 的单引号壳要能剥掉')
  assert.ok(!maskedRepr.includes('星辰数据服务部'))
})

test('学习态强来源：中文紧贴写法（维度司马青 100%）也复用', () => {
  // 先让表格路径学到真值，再在散文里复用
  const table = '合同编号\t客户联系人\t销售\ncstb-pmc-2020245\t欧阳山\t司马青'
  const engine = new MaskEngine({ entities: [...DEFAULT_ENTITIES], terms: [] })
  engine.mask(table)
  const prose = '到款完成度维度司马青 100%（8/8），均已回访欧阳山：营配数据管理。'
  const out = engine.mask(prose).text
  assert.ok(!out.includes('司马青'), '紧贴汉字的已知人名要遮')
  assert.ok(!out.includes('欧阳山'), '紧贴标点的已知人名要遮')
})

test('合同编号：汉字头 + 括号段（华东-CSTM-PME(PMC)-2020230）要遮，纯日期不遮', () => {
  const { text } = maskText('华东-CSTM-PME(PMC)-2020230 与 2024-01-15', { entities: [...DEFAULT_ENTITIES] })
  assert.ok(!text.includes('华东-CSTM-PME(PMC)-2020230'))
  assert.ok(text.includes('2024-01-15'), '纯日期不是合同号')
})
