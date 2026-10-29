// lib/table.js — 表格感知脱敏：用列头（表头）决定每一列的敏感语义。
//
// 背景（真实泄露复盘）：
//   客户给的 xlsx 经工具读成 TSV/Markdown 表格后，模型看到的是"裸值"：
//     客户联系人 | 销售     | 合同名称               | 总金额
//     赵敏       | 李芳     | 某某区智慧政务建设项目 | 2024001
//   旧的检测器只认"引导词 + 冒号"（姓名：张三）与"称谓"（张三经理），
//   也完全没有金额检测，于是人名/项目名/金额整片明文出境，只有带"有限公司/中心"
//   后缀的机构名被遮住 —— 去标识化形同虚设（项目名与合同号一组合就能反查客户）。
//
// 这一层做的事：
//   1. 认出表格（TSV / CSV / Markdown 管道表）：找表头行，按分隔符切列；
//   2. 表头 → 列角色（person/org/unit/proj/money/id），按角色对"每个数据格"取值；
//   3. 只对有明确语义的列动手，`是否/类型/计数/日期/行业` 这类列一律跳过，
//      避免把「2022」「1」「历史」当敏感值遮掉。
//
// 输入约定与 detectors-cn.js 相同：text 是 NFKC + 小写后的检索文本，
// 偏移是检索文本偏移，由 lib/engine.js 统一映射回原文。

/** 列角色。 */
export const COLUMN_ROLES = Object.freeze({
  person: 'person',
  org: 'org',
  unit: 'unit',
  proj: 'proj',
  money: 'money',
  id: 'id',
})

/** 这些列整列跳过：值是枚举/计数/日期，遮了反而破坏数据可用性。 */
const SKIP_HEADER = /(序号|是否|类型|状态|分类|计数|数量|个数|日期|时间|年份|年度|比例|占比|进度|阶段|备注|说明|行业|单位$)/u

/** 表头关键词 → 列角色（顺序即优先级：编号/金额先判，名称类最后）。 */
const HEADER_ROLES = Object.freeze([
  [/(编号|单号|流水号|工号|订单号|凭证号|编码|代码)$/u, COLUMN_ROLES.id],
  [/(金额|总额|价款|报价|费用|预算|收入|成本|利润|单价|价格|含税|不含税|结算额|合同额|业绩|营收|回款)/u, COLUMN_ROLES.money],
  [/(联系人|负责人|经办人|销售|业务员|客户姓名|姓名|申请人|审批人|审核人|编制人|招聘|当事人|代理人|员工|对接人|项目经理|申请人)/u, COLUMN_ROLES.person],
  [/(客户名称|客户|甲方|乙方|供应商|厂商|单位名称|公司|机构|部门|所属|归属|代理商|合作方|发包|承包|采购方|供货方)/u, COLUMN_ROLES.org],
  [/(来源|渠道)/u, COLUMN_ROLES.unit],
  [/(合同名称|项目名称|系统名称|工程名称|产品名称|课题|标的|服务内容|项目名|合同名|项目|合同|系统|平台|工程)/u, COLUMN_ROLES.proj],
])

/** 常见汉语姓氏（单姓；够用即可，命中不了就交回通用检测器）。 */
const SURNAMES = new Set(('赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴鬱胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍卻璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公').split(''))

/** 复姓。 */
const COMPOUND_SURNAMES = Object.freeze([
  '欧阳', '司马', '上官', '诸葛', '东方', '皇甫', '尉迟', '公孙', '慕容', '司徒',
  '令狐', '宇文', '长孙', '轩辕', '夏侯', '闻人', '赫连', '澹台', '公冶', '宗政',
  '濮阳', '淳于', '单于', '太叔', '申屠', '仲孙', '钟离', '南宫', '第五', '万俟',
])

/** 2-4 字但不是人名的常见值（项目来源/状态/行业枚举）。 */
const NOT_PERSON = new Set([
  '历史', '直签', '走帐', '转签', '联合', '内部', '外部', '其他', '暂无', '未知', '待定',
  '政府', '国网', '教育', '院所', '金融', '医疗', '能源', '交通', '制造', '互联网',
  '是', '否', '无', '有', '合计', '小计', '总计', '平均', '全员', '本部',
])

/** 项目/系统名的占位值。 */
const NOT_PROJECT = new Set(['无', '暂无', '其他', '不适用', '未知', '待定', 'n/a', 'na', '-', '—', '/'])

/** 机构名结尾特征（用于 org 列的整格兜底）。 */
const ORGISH_TAIL = /(局|委|办|厅|部|院|所|中心|公司|集团|银行|医院|大学|学院|学校|中学|小学|协会|学会|基金会|出版社|电视台|电台|报社|研究院|事务所|工作室|厂|站|队|署|会)$/u

/** 部门/单位结尾特征（用于 unit 列）。 */
const UNIT_TAIL = /(部|科|室|处|组|办|中心|分公司|分部|事业部|管理部)$/u

/** 纯两位小数的金额格（36.50 / 812.79）。 */
const RE_DECIMAL_CELL = /^\d{1,9}\.\d{1,2}$/u

/** 千分位金额。 */
const RE_MONEY_THOUSANDS = /(?<![\d.])\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?(?![\d.])/gu

/** 四位以上整数（含小数）。 */
const RE_MONEY_BIG = /(?<![\d.])\d{4,}(?:\.\d{1,2})?(?![\d.])/gu

/** 带单位/两位小数的金额（仅限金额列）。 */
const RE_MONEY_DECIMAL = /(?<![\d.])\d+(?:\.\d{1,2})\s*(?:万|亿)?(?:元|圆)?/gu

/** 编号格：字母数字与连字符/下划线，且含分隔符。 */
const RE_ID_CELL = /^[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff._-]{4,}$/u

/** 单行最多处理的列数（防御异常宽表）。 */
const MAX_COLUMNS = 120
/** 最多处理的行数（防御超大表格）。 */
const MAX_ROWS = 2000

/**
 * 把表头文本映射成列角色。
 * @param {string} header 单元格文本。
 * @returns {string|null} 角色，认不出返回 null（不处理该列）。
 */
export function detectColumnRole(header) {
  const text = String(header ?? '').trim()
  if (text === '') return null
  if (SKIP_HEADER.test(text)) return null
  for (const [re, role] of HEADER_ROLES) {
    if (re.test(text)) return role
  }
  return null
}

/** 把行切成单元格（相对行首偏移）。 */
function splitCells(line, delim) {
  const cells = []
  let start = 0
  for (let i = 0; i <= line.length; i++) {
    if (i === line.length || line[i] === delim) {
      cells.push({ start, end: i, raw: line.slice(start, i) })
      start = i + 1
    }
    if (cells.length > MAX_COLUMNS) break
  }
  if (delim === '|') {
    // Markdown 表格首尾的 '|' 会产生空单元格，去掉。
    if (cells.length > 0 && cells[0].raw.trim() === '') cells.shift()
    if (cells.length > 0 && cells[cells.length - 1].raw.trim() === '') cells.pop()
  }
  return cells
}

/** 判断分隔符；认不出返回 null。单制表符也算 TSV：两列表（姓名\t金额）同样要能遮。 */
function guessDelimiter(line) {
  const tabs = (line.match(/\t/gu) ?? []).length
  if (tabs >= 1) return '\t'
  const pipes = (line.match(/\|/gu) ?? []).length
  if (pipes >= 3) return '|'
  const commas = (line.match(/,/gu) ?? []).length
  if (commas >= 3) return ','
  return null
}

/** 是否是 Markdown 表格的分隔行（|---|---|）。 */
function isSeparatorRow(line) {
  return /^[\s|:-]+$/u.test(line) && line.includes('-')
}

/** 行区间（含行首行尾，不含换行符）。 */
function lineSpans(text) {
  const out = []
  let start = 0
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      out.push([start, i])
      start = i + 1
      if (out.length > MAX_ROWS + 2) break
    }
  }
  return out
}

/** 是否是"机构/部门"形状的值（用于 person/unit 列的宽容判定）。 */
function orgishValue(value) {
  return value.length >= 3 && /[\u4e00-\u9fff]/u.test(value)
    && (ORGISH_TAIL.test(value) || UNIT_TAIL.test(value))
}

/** 单元格内的姓名候选。 */
function personTokens(cell) {
  const tokens = []
  const parts = cell.split(/[、,，;；\s／/]+/u)
  for (const part of parts) {
    const name = part.trim()
    if (!/^[\u4e00-\u9fff·]{2,4}$/u.test(name)) continue
    if (NOT_PERSON.has(name)) continue
    const compound = COMPOUND_SURNAMES.find((surname) => name.startsWith(surname))
    if (compound === undefined && !SURNAMES.has(name[0])) continue
    tokens.push(name)
  }
  return tokens
}

/** 单元格里的金额区间（相对单元格）。 */
function moneyTokens(cell) {
  const out = []
  for (const re of [RE_MONEY_THOUSANDS, RE_MONEY_BIG, RE_MONEY_DECIMAL]) {
    for (const match of cell.matchAll(re)) {
      const raw = match[0]
      const digits = raw.replace(/\D/gu, '')
      if (digits.length < 4 && !/\.\d{1,2}/u.test(raw)) continue
      out.push({ start: match.index, end: match.index + raw.length })
    }
  }
  if (RE_DECIMAL_CELL.test(cell.trim())) {
    const at = cell.indexOf(cell.trim())
    const value = cell.trim()
    out.push({ start: at, end: at + value.length })
  }
  return out
}

/**
 * 在检索文本里识别表格并按列角色产出命中。
 * @param {string} text 归一化检索文本。
 * @param {{entities: Set<string>|string[], maxRows?: number}} options
 * @returns {Array<{entity:string,label:string,start:number,end:number,score:number}>}
 */
export function detectTable(text, options = {}) {
  const enabled = options.entities instanceof Set ? options.entities : new Set(options.entities ?? [])
  const source = typeof text === 'string' ? text : ''
  if (source === '' || source.length < 8) return []
  if (!enabled.has('cn-person') && !enabled.has('cn-org') && !enabled.has('cn-project')
    && !enabled.has('money') && !enabled.has('cn-id')) return []

  const spans = lineSpans(source)
  const out = []
  const maxRows = Math.min(MAX_ROWS, options.maxRows ?? MAX_ROWS)

  for (let index = 0; index + 1 < spans.length; index++) {
    const [headStart, headEnd] = spans[index]
    const headerLine = source.slice(headStart, headEnd)
    if (headerLine.trim() === '') continue
    const delim = guessDelimiter(headerLine)
    if (delim === null) continue
    const headerCells = splitCells(headerLine, delim)
    if (headerCells.length < 2) continue
    const roles = headerCells.map((cell) => detectColumnRole(cell.raw))
    if (!roles.some((role) => role !== null)) continue

    // 数据行从这里开始；遇到空行或列数不匹配即结束该表。
    let startRow = index + 1
    if (startRow < spans.length && isSeparatorRow(source.slice(spans[startRow][0], spans[startRow][1]))) startRow++
    let rows = 0
    for (let row = startRow; row < spans.length && rows < maxRows; row++) {
      const [lineStart, lineEnd] = spans[row]
      const line = source.slice(lineStart, lineEnd)
      if (line.trim() === '') break
      const cells = splitCells(line, delim)
      if (cells.length < 2 || Math.abs(cells.length - headerCells.length) > 1) break
      rows++
      for (let col = 0; col < cells.length && col < roles.length; col++) {
        const role = roles[col]
        if (role === null) continue
        const cell = cells[col]
        const raw = cell.raw
        const trimmed = raw.trim()
        if (trimmed === '' || trimmed.includes('<')) continue
        const at = lineStart + cell.start + raw.indexOf(trimmed)
        emitRoleHits(role, trimmed, at, out, enabled)
      }
    }
    index = startRow + Math.max(rows, 1) - 1
  }
  // 第二路：JSON 形状的工具结果（对象数组 / "表头数组 + 行数组"）。
  // run_code 读表最常吐这两种形状，旧实现只认 TSV，于是"销售/联系人/合同编号"整列裸奔。
  out.push(...detectJsonPayloads(source, options))
  return out
}

/** 角色 → 实体名（unit 允许 org/person 两种解释）。 */
const ROLE_ENTITY = Object.freeze({
  [COLUMN_ROLES.person]: 'cn-person',
  [COLUMN_ROLES.org]: 'cn-org',
  [COLUMN_ROLES.unit]: 'cn-org',
  [COLUMN_ROLES.proj]: 'cn-project',
  [COLUMN_ROLES.money]: 'money',
  [COLUMN_ROLES.id]: 'cn-id',
})

/**
 * 按列角色对"单值"产命中（TSV 与 JSON 两条路共用）。
 * @param {string} role 列角色。
 * @param {string} value 已 trim 的值。
 * @param {number} at value 在检索文本里的绝对起点。
 * @param {Array<object>} out 输出数组。
 * @param {Set<string>} enabled 启用的实体。
 */
function emitRoleHits(role, value, at, out, enabled) {
  if (value === '' || at < 0) return
  if (role === COLUMN_ROLES.person && enabled.has('cn-person')) {
    let hit = false
    for (const name of personTokens(value)) {
      const offset = value.indexOf(name)
      if (offset === -1) continue
      out.push({ entity: 'cn-person', label: 'PERSON', start: at + offset, end: at + offset + name.length, score: 0.85 })
      hit = true
    }
    // 列头写"销售/联系人"，实际填的是部门（"合作伙伴管理部"）——按机构遮。
    if (!hit && enabled.has('cn-org') && orgishValue(value)) {
      out.push({ entity: 'cn-org', label: 'ORG', start: at, end: at + value.length, score: 0.8 })
    }
    return
  }
  if (role === COLUMN_ROLES.org && enabled.has('cn-org')) {
    if (value.length < 3 || !/[\u4e00-\u9fff]/u.test(value)) return
    if (ORGISH_TAIL.test(value)) {
      out.push({ entity: 'cn-org', label: 'ORG', start: at, end: at + value.length, score: 0.85 })
      return
    }
    // 没有公司/局/中心后缀的"客户名简写"（蓝鸟北分）：列头已经说明它是机构，按机构遮。
    if (value.length >= 4 && !NOT_PROJECT.has(value) && !NOT_PERSON.has(value)) {
      out.push({ entity: 'cn-org', label: 'ORG', start: at, end: at + value.length, score: 0.72 })
    }
    return
  }
  if (role === COLUMN_ROLES.unit) {
    if (enabled.has('cn-org') && orgishValue(value)) {
      out.push({ entity: 'cn-org', label: 'ORG', start: at, end: at + value.length, score: 0.8 })
      return
    }
    if (enabled.has('cn-person')) {
      // 列头写"来源"，实际填的是人名（"刘洋"）——按人名遮。
      for (const name of personTokens(value)) {
        const offset = value.indexOf(name)
        if (offset === -1) continue
        out.push({ entity: 'cn-person', label: 'PERSON', start: at + offset, end: at + offset + name.length, score: 0.8 })
      }
    }
    return
  }
  if (role === COLUMN_ROLES.proj && enabled.has('cn-project')) {
    const cjk = (value.match(/[\u4e00-\u9fff]/gu) ?? []).length
    if (cjk >= 2 && value.length >= 4 && !NOT_PROJECT.has(value)) {
      out.push({ entity: 'cn-project', label: 'PROJ', start: at, end: at + value.length, score: 0.9 })
    }
    return
  }
  if (role === COLUMN_ROLES.money && enabled.has('money')) {
    for (const token of moneyTokens(value)) {
      out.push({ entity: 'money', label: 'MONEY', start: at + token.start, end: at + token.end, score: 0.85 })
    }
    return
  }
  if (role === COLUMN_ROLES.id && enabled.has('cn-id')) {
    if (RE_ID_CELL.test(value) && /[-_.]/u.test(value)) {
      out.push({ entity: 'cn-id', label: 'IDNO', start: at, end: at + value.length, score: 0.85 })
    }
  }
}

/** 把一行 JSON 数组的顶层单元格切出来（含偏移）。 */
function parseArrayCells(line) {
  const open = line.indexOf('[')
  if (open === -1) return null
  const cells = []
  let depth = 0
  let cellStart = open + 1
  for (let index = open + 1; index < line.length; index++) {
    const ch = line[index]
    if (ch === '"') {
      for (index += 1; index < line.length; index++) {
        if (line[index] === '\\') { index += 1; continue }
        if (line[index] === '"') break
      }
      continue
    }
    if (ch === '[' || ch === '{') { depth += 1; continue }
    if (ch === ']' || ch === '}') {
      if (depth === 0) { pushCell(line, cellStart, index, cells); return cells }
      depth -= 1
      continue
    }
    if (ch === ',' && depth === 0) { pushCell(line, cellStart, index, cells); cellStart = index + 1 }
  }
  return null
}

/** 压入一个 JSON 单元格（字符串取引号内侧，数字取字面量）。 */
function pushCell(line, start, end, cells) {
  const raw = line.slice(start, end)
  if (raw.trim() === '') return
  const lead = raw.length - raw.trimStart().length
  const body = raw.trim()
  if (body.startsWith('"')) {
    const innerStart = start + lead + 1
    let value = ''
    let index = innerStart
    for (; index < end; index++) {
      const ch = line[index]
      if (ch === '\\') { value += line[index + 1] ?? ''; index += 1; continue }
      if (ch === '"') break
      value += ch
    }
    cells.push({ start: innerStart, end: index, value, isString: true })
    return
  }
  cells.push({ start: start + lead, end: start + lead + body.length, value: body, isString: false })
}

/** 解析一行 JSON 对象的 "键": "值" 对（含值在行内的偏移）。 */
function parseObjectPairs(line) {
  const pairs = []
  for (const match of line.matchAll(/"((?:[^"\\]|\\.)*)"\s*:\s*/g)) {
    const valueStart = match.index + match[0].length
    if (line[valueStart] !== '"') continue
    let value = ''
    let index = valueStart + 1
    for (; index < line.length; index++) {
      const ch = line[index]
      if (ch === '\\') { value += line[index + 1] ?? ''; index += 1; continue }
      if (ch === '"') break
      value += ch
    }
    pairs.push({ key: match[1], value, start: valueStart + 1 })
  }
  return pairs
}

/**
 * 逐行兜底：NDJSON / 单行对象数组（整体 JSON.parse 失败时用）。
 * @param {string} text 归一化检索文本。
 * @param {{entities: Set<string>|string[], maxRows?: number}} options 选项。
 * @returns {Array<object>} matches。
 */
function detectJsonLines(text, options = {}) {
  const enabled = options.entities instanceof Set ? options.entities : new Set(options.entities ?? [])
  const source = typeof text === 'string' ? text : ''
  if (source === '' || source.length < 8) return []
  if (!['cn-person', 'cn-org', 'cn-project', 'money', 'cn-id'].some((entity) => enabled.has(entity))) return []

  const spans = lineSpans(source)
  const out = []
  const maxRows = Math.min(MAX_ROWS, options.maxRows ?? MAX_ROWS)
  let header = null
  let rows = 0

  for (let index = 0; index < spans.length && index < MAX_ROWS + 2; index++) {
    const [lineStart, lineEnd] = spans[index]
    const rawLine = source.slice(lineStart, lineEnd)
    const line = rawLine.trim()
    if (line === '') { header = null; continue }
    const base = lineStart + (line.length === rawLine.length ? 0 : rawLine.indexOf(line))

    if (line.startsWith('{')) {
      header = null
      for (const pair of parseObjectPairs(line)) {
        const role = detectColumnRole(pair.key)
        if (role === null) continue
        const value = pair.value.trim()
        if (value === '' || value.includes('<')) continue
        emitRoleHits(role, value, base + pair.start + pair.value.indexOf(value), out, enabled)
      }
      continue
    }

    if (line.startsWith('[')) {
      const cells = parseArrayCells(line)
      if (cells === null) { header = null; continue }
      const roles = cells.map((cell) => (cell.isString ? detectColumnRole(cell.value) : null))
      if (roles.filter((role) => role !== null).length >= 2) {
        header = { roles, count: cells.length }
        rows = 0
        continue
      }
      if (header === null || cells.length !== header.count) { header = null; continue }
      if (rows >= maxRows) break
      rows += 1
      for (let col = 0; col < cells.length; col++) {
        const role = header.roles[col]
        const cell = cells[col]
        if (role === null || !cell.isString) continue
        const value = cell.value.trim()
        if (value === '' || value.includes('<')) continue
        emitRoleHits(role, value, base + cell.start + cell.value.indexOf(value), out, enabled)
      }
      continue
    }
    header = null
  }
  return out
}

/**
 * 去掉工具输出里的行号前缀，让整段 JSON 可以被 JSON.parse。
 * 兼容两种真实形态：`12|  "合同编号",`（竖线）与 `12:   "合同编号",`（冒号，DSH 文件读取默认带）。
 */
function stripLineNumberPrefix(text) {
  return text.split('\n').map((line) => {
    const match = /^[ \t]*\d+[ \t]*[:|][ \t]?/.exec(line)
    return match === null ? line : line.slice(match[0].length)
  }).join('\n')
}

/** 去掉一行的行号前缀（`12|` / `12: `），返回原文（偏移仍以原行计）。 */
const LINE_PREFIX_RE = /^[ \t]*\d+[ \t]*[:|][ \t]?/u
function bareLine(line) {
  const match = LINE_PREFIX_RE.exec(line)
  return match === null ? line : line.slice(match[0].length)
}

/**
 * 行内只有一个「整串引号值」时取出它（pretty-print JSON 的元素行都是这个形态）。
 * 表头 `  "合同编号",` 与数据行 `   "xmht-pmc-2020007",` 都能命中；带 `4|` 行号前缀也能命中。
 */
function onlyQuotedValue(line) {
  const body = bareLine(line)
  const match = /^[ \t]*"((?:[^"\\]|\\.)*)"[ \t]*,?[ \t]*$/u.exec(body)
  if (match === null) return null
  return { value: match[1].replace(/\\(.)/gu, '$1'), quoteAt: line.length - body.length + body.indexOf('"') }
}

/**
 * 截断/带行号的 pretty-print JSON 表格：不依赖整段可解析。
 * 形态（工具输出被截断时的真实形态）：
 *   totalLines=2835
 *   1|{
 *   2|  "rows": { "蓝鸟北分": [
 *   3|    [
 *   4|      "合同编号",
 *   5|      "客户联系人",
 *   ...
 *   20|    ],
 *   21|    [
 *   22|      "xmht-pmc-2020007",
 *   23|      "赵敏",
 * 先找连续「单值行」组成的表头块，再按列数归并后续 `[ ... ]` 行块。
 * @returns {Array<object>} matches。
 */
function detectPrettyJsonTable(source, options) {
  const enabled = options.entities instanceof Set ? options.entities : new Set(options.entities ?? [])
  const maxRows = options.maxRows ?? 4000
  const spans = lineSpans(source)
  const out = []
  let index = 0
  while (index < spans.length) {
    // 1) 表头块：连续的「单值行」
    let cursor = index
    const headerCells = []
    const headerAt = []
    while (cursor < spans.length) {
      const [start, end] = spans[cursor]
      const line = source.slice(start, end)
      const cell = onlyQuotedValue(line)
      if (cell === null) break
      headerCells.push(cell.value)
      headerAt.push(start + cell.quoteAt + 1)
      cursor += 1
    }
    const roles = headerCells.length >= 2 && headerCells.length <= 60 ? headerRoles(headerCells) : null
    if (roles === null) { index += 1; continue }

    // 2) 行块：`[` 之后按列数收值，`]` 结束一行
    let rowCells = []
    let rowAt = []
    let rows = 0
    let walk = cursor
    const flushRow = () => {
      if (rowCells.length === 0) return
      const limit = Math.min(rowCells.length, roles.length)
      for (let col = 0; col < limit; col += 1) {
        const role = roles[col]
        if (role === null) continue
        const raw = rowCells[col]
        const value = raw.trim()
        if (value === '' || value.includes('<')) continue
        emitRoleHits(role, value, rowAt[col] + raw.indexOf(value), out, enabled)
      }
      rowCells = []
      rowAt = []
      rows += 1
    }
    for (; walk < spans.length && rows < maxRows; walk += 1) {
      const [start, end] = spans[walk]
      const line = source.slice(start, end)
      const body = bareLine(line)
      const trimmed = body.trim()
      const shifted = line.length - body.length
      if (trimmed === '') continue
      if (trimmed.startsWith(']')) {
        // 「],[」同行：一行结束且下一行开始
        flushRow()
        continue
      }
      if (trimmed === '[') continue
      // 整行数组（`["a","b",...]`）直接按列取
      if (trimmed.startsWith('[') && trimmed.includes(',')) {
        flushRow()
        const cells = parseArrayCells(trimmed)
        for (let col = 0; col < cells.length && col < roles.length; col += 1) {
          const role = roles[col]
          const cell = cells[col]
          if (role === null || !cell.isString) continue
          const value = cell.value.trim()
          if (value === '' || value.includes('<')) continue
          emitRoleHits(role, value, start + shifted + cell.start + cell.value.indexOf(value), out, enabled)
        }
        rows += 1
        continue
      }
      const cell = onlyQuotedValue(line)
      if (cell === null) {
        // 遇到新的键或对象开始：当前行结束，并且表头区也结束
        flushRow()
        break
      }
      rowCells.push(cell.value)
      rowAt.push(start + cell.quoteAt + 1)
    }
    if (out.length > 0) return out
    index = Math.max(walk, cursor + 1)
  }
  return out
}

/** 由「键名」推断其子值/子键的角色（用于 `"销售": "张伟"` 与 `"paid_by_sales": {"张伟": …}`）。 */
const KEY_ROLE_HINTS = Object.freeze([
  [/(?:sales|salesperson|seller|person|owner|contact|联系人|销售|负责人|经办)/iu, COLUMN_ROLES.person],
  [/(?:customer|client|org|company|unit|dept|客户|单位|公司|部门|甲方|乙方)/iu, COLUMN_ROLES.org],
  [/(?:project|program|proj|项目|工程|系统|平台)/iu, COLUMN_ROLES.proj],
])

/** 键名 → 角色：先按表头词典，再按关键词提示。 */
function roleFromKey(key) {
  if (typeof key !== 'string' || key === '') return null
  const direct = detectColumnRole(key)
  if (direct !== null) return direct
  for (const [pattern, role] of KEY_ROLE_HINTS) if (pattern.test(key)) return role
  return null
}

/** 去掉聚合输出里键外层的引号壳（`"'张伟'"` → `张伟`）。 */
function unwrapKeyText(key) {
  return String(key).trim().replace(/^['"`]+/u, '').replace(/['"`]+$/u, '').trim()
}

/** 结构化键名：它们的值即使长得像表格（数组的数组）也不是业务名，按表名遮会误伤。 */
const STRUCT_KEYS = new Set([
  'rows', 'row', 'data', 'datas', 'items', 'item', 'records', 'record', 'values', 'value',
  'list', 'lists', 'array', 'arrays', 'result', 'results', 'table', 'tables', 'sheets',
  'columns', 'column', 'header', 'headers', 'cells', 'matrix', 'grid', 'page', 'pages',
])

/** 中文通用键名：长得像业务名也不能当表名遮（汇总表里遍地都是）。 */
const GENERIC_KEYS = /^(?:合计|总计|小计|汇总|明细|统计|分类|分组|数据|信息|记录|列表|结果|说明|备注|其他|默认|全部)/u

/**
 * 键驱动脱敏：拦两类真实泄露形态。
 * ① 键值对 `"销售": "张伟"`——键名直接说明值是销售，值按角色遮。
 * ② 聚合对象键 `"paid_by_sales": { "张伟": {…} }`——父键说明子键是销售名单，子键按角色遮。
 * ③ pandas 分组键 `{ "'张伟'": 6, "'王磊'": 51 }`——同上，先剥引号壳。
 * @returns {Array<object>} matches。
 */
function detectJsonKeyedValues(source, options) {
  const enabled = options.entities instanceof Set ? options.entities : new Set(options.entities ?? [])
  const out = []
  const stack = []
  let index = 0
  const length = source.length
  const emitValue = (text, at, role) => {
    const value = unwrapKeyText(text)
    if (value === '' || value.includes('<') || value.length > 40) return
    emitRoleHits(role, value, at + text.indexOf(value.charAt(0)), out, enabled)
  }
  /** 读一个带引号的字符串（`"` 或 `'`），返回内容与结束位置。 */
  const readQuoted = (from, quote) => {
    let cursor = from + 1
    let text = ''
    while (cursor < length) {
      const c = source[cursor]
      if (c === '\\') { text += source[cursor + 1] ?? ''; cursor += 2; continue }
      if (c === quote) return { text, end: cursor }
      text += c
      cursor += 1
    }
    return { text, end: length }
  }
  while (index < length) {
    const ch = source[index]
    if (ch === '}') { stack.pop(); index += 1; continue }
    if (ch === ']') { stack.pop(); index += 1; continue }
    if (ch === '{' || ch === '[') { index += 1; continue }
    // pandas repr 用单引号当键壳（`{'distinct_sales': …}`），也当引号处理。
    if (ch !== '"' && ch !== "'") { index += 1; continue }
    const { text, end: stringEnd } = readQuoted(index, ch)
    // 后面跳过空白看是不是键
    let probe = stringEnd + 1
    while (probe < length && (source[probe] === ' ' || source[probe] === '\t' || source[probe] === '\n' || source[probe] === '\r')) probe += 1
    const isKey = source[probe] === ':'
    if (!isKey) { index = stringEnd + 1; continue }

    const bare = unwrapKeyText(text)
    const keyRole = roleFromKey(bare)
    // 值起点（键后第一个非空白字符）
    let valueAt = probe + 1
    while (valueAt < length && /\s/u.test(source[valueAt])) valueAt += 1
    const numeric = /^[-\d]/u.test(source[valueAt] ?? '')
    const nested = source[valueAt] === '{' || source[valueAt] === '['
    const parent = stack.length > 0 ? stack[stack.length - 1] : null

    if (keyRole !== null) {
      // ① 键值对：值是字符串 → 直接遮值
      if (source[valueAt] === '"') {
        const value = readQuoted(valueAt, '"')
        emitValue(value.text, valueAt + 1, keyRole)
        index = value.end + 1
        continue
      }
      // ② 聚合映射：父键与子键角色相同且值是数字/对象 → 子键本身就是名单里的姓名
      if (parent !== null && parent.role === keyRole && (numeric || nested)) {
        emitValue(text, index + 1, keyRole)
      }
      if (nested) {
        stack.push({ key: bare, role: keyRole })
        index = valueAt + 1
        continue
      }
    } else if (parent !== null) {
      // ③ 聚合对象里的子键：父键已声明角色，且值是数字/对象 → 子键本身就是要遮的值
      if ((numeric || nested) && bare !== '' && bare.length <= 40) {
        emitValue(text, index + 1, parent.role)
      }
      // 子键自己还挂着对象（`"张伟": {"n": 6}`）→ 压栈，否则它自己的 `}` 会把父帧误弹掉
      if (nested) {
        stack.push({ key: bare, role: parent.role })
        index = valueAt + 1
        continue
      }
    } else if (nested && source[valueAt] === '[' && STRUCT_KEYS.has(bare.toLowerCase()) === false) {
      // ④ 表名/分组名：键的值是「数组的数组」（一张表），键本身就是业务名（真实场景是工作表名＝客户名）
      let inner = valueAt + 1
      // 跳过空白与工具输出里的 `4|` 行号前缀，再判断内层是不是数组
      for (let guard = 0; guard < 2000 && inner < length; guard++) {
        if (/\s/u.test(source[inner])) { inner += 1; continue }
        const linenum = /^\d{1,6}\|/u.exec(source.slice(inner, inner + 8))
        if (linenum !== null) { inner += linenum[0].length; continue }
        break
      }
      if (source[inner] === '[' && GENERIC_KEYS.test(bare) === false) emitValue(text, index + 1, 'org')
    }
    index = stringEnd + 1
  }
  return out
}

/** 表头数组 → 列角色；至少两列能认出角色才算表头。 */
function headerRoles(cells) {
  if (!Array.isArray(cells) || cells.length < 2) return null
  const roles = cells.map((cell) => (typeof cell === 'string' ? detectColumnRole(cell) : null))
  let mapped = 0
  for (const role of roles) if (role !== null) mapped += 1
  return mapped >= 2 ? roles : null
}

/** 按列角色把一行数组里的字符串值收进队列（保持文档顺序）。 */
function pushRowCells(row, roles, ordered) {
  if (!Array.isArray(row)) return
  const limit = Math.min(row.length, roles.length)
  for (let index = 0; index < limit; index++) {
    const role = roles[index]
    if (role === null) continue
    const value = row[index]
    if (typeof value !== 'string') continue
    ordered.push({ role, value })
  }
}

/** 递归收集已解析 JSON 里的 (角色, 值) 对。 */
function collectParsed(node, ordered) {
  if (Array.isArray(node)) {
    if (node.length > 0 && node.every((item) => Array.isArray(item))) {
      const roles = headerRoles(node[0])
      if (roles !== null) {
        for (let index = 1; index < node.length; index++) pushRowCells(node[index], roles, ordered)
        return
      }
    }
    for (const item of node) collectParsed(item, ordered)
    return
  }
  if (node === null || typeof node !== 'object') return
  // 同一层里如果有 header/columns 这样的表头数组，它的兄弟行数组直接套用该角色表。
  let inherited = null
  for (const value of Object.values(node)) {
    const candidate = headerRoles(value)
    if (candidate !== null) { inherited = candidate; break }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value) && value.length > 0 && value.every((item) => Array.isArray(item))) {
      const roles = headerRoles(value[0]) ?? inherited
      if (roles !== null) {
        for (let index = 1; index < value.length; index++) pushRowCells(value[index], roles, ordered)
        continue
      }
    }
    collectParsed(value, ordered)
  }
}

/** 按文档顺序把值对回原文位置（JSON 字符串值在原文里就是 `"值"`）。 */
function locateOrdered(source, ordered, enabled) {
  const out = []
  let cursor = 0
  for (const item of ordered) {
    const value = String(item.value).trim()
    if (value === '' || value.includes('<')) continue
    const token = '"' + item.value + '"'
    let at = source.indexOf(token, cursor)
    if (at === -1) at = source.indexOf(token)
    if (at === -1) continue
    cursor = at + token.length
    emitRoleHits(item.role, value, at + 1 + item.value.indexOf(value), out, enabled)
  }
  return out
}

/**
 * 识别 JSON 形状的工具结果并按列键/表头映射角色（2026-10-29 复盘新增）。
 *
 * 真实泄露就发生在这里：`run_code` 读 xlsx 后吐的是**带行号的 pretty-print JSON**，
 * 旧实现只认 TSV，于是「销售/客户联系人/合同编号」整列裸奔。
 * 现在按三条路走：①整体 JSON.parse（含去行号前缀）→ 递归找表头/行数组；
 * ②表头数组 + 行数组的逐行形态；③NDJSON 逐行对象。值一律按文档顺序回定位。
 * @param {string} text 归一化检索文本。
 * @param {{entities: Set<string>|string[], maxRows?: number}} options 选项。
 * @returns {Array<object>} matches。
 */
export function detectJsonPayloads(text, options = {}) {
  const enabled = options.entities instanceof Set ? options.entities : new Set(options.entities ?? [])
  const source = typeof text === 'string' ? text : ''
  if (source === '' || source.length < 8) return []
  if (!['cn-person', 'cn-org', 'cn-project', 'money', 'cn-id'].some((entity) => enabled.has(entity))) return []

  const out = []
  // 第 0 路：键驱动（`"销售": "张伟"`、`"paid_by_sales": {"张伟": …}`、`{"'张伟'": 6}`）。
  const keyed = detectJsonKeyedValues(source, options)
  if (keyed.length > 0) out.push(...keyed)

  let parsed = null
  try {
    // 工具输出常带前后缀（`totalLines=2835` 之类），先剥行号、再截出最外层 JSON 主体。
    const cleaned = stripLineNumberPrefix(source)
    const start = cleaned.search(/[[{]/u)
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'))
    if (start !== -1 && end > start) parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    parsed = null
  }
  if (parsed !== null && typeof parsed === 'object') {
    const ordered = []
    collectParsed(parsed, ordered)
    out.push(...locateOrdered(source, ordered, enabled))
  }
  // 截断的 pretty-print JSON（`totalLines=2835` + `1|{...`）整段不可解析，改用结构行扫描。
  // 注意：键驱动已命中时**也要**再扫一遍——键只覆盖「键/聚合名单」，行块里的列值还得靠表头映射；
  // 两路产出的重叠区交给 resolveOverlaps 去重（起点升序 + 分数降序 + 长者优先）。
  const pretty = detectPrettyJsonTable(source, options)
  if (pretty.length > 0) out.push(...pretty)
  // 整段不是 JSON：退回逐行（NDJSON / 单行数组）。
  else out.push(...detectJsonLines(source, options))
  return out
}
