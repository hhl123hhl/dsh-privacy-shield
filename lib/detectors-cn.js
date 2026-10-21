// lib/detectors-cn.js — 中文实体检测器（零依赖，纯函数）。
//
// 与通用正则不同，中文实体没有空格/大小写边界，机构名的标记在"后缀"而不是前缀，
// 因此这里需要"后缀键控 + 变长前缀回溯"：
//   识别到「有限公司」后，向前回溯到最近的分隔符，再把前缀与后缀合成一个机构名。
//
// 输入约定：text 已经是归一化后的检索文本（NFKC + 小写），偏移是"检索文本偏移"；
// 由 lib/engine.js 统一映射回原文偏移。返回的 match 形如：
//   { entity, label, start, end, score }

/** 机构后缀（按长度降序排列，保证长后缀先被识别）。 */
export const ORG_SUFFIXES = Object.freeze([
  '股份有限公司', '有限责任公司', '集团有限公司', '有限公司', '分公司', '子公司',
  '研究院', '研究所', '设计院', '事务所', '工作室', '事业部',
  '集团', '控股', '银行', '医院', '大学', '学院', '中学', '小学', '幼儿园',
  '管理局', '委员会', '政府', '检察院', '法院', '公安局', '派出所', '税务局',
  '供电局', '供电公司', '电厂', '水厂', '航空公司', '协会', '学会', '基金会',
  '出版社', '电视台', '电台', '报社', '中心',
].sort((a, b) => b.length - a.length))

/** 前缀回溯时要剥掉的前导虚词（单个字，可重复剥离）。
 *  注意：这里刻意不放"是/会/要/就/能/可/本"——它们可能是真实机构名的首字
 *  （例如「是德科技」「本溪钢铁」），宁可多留一个字也不要破坏名称。 */
const LEAD_PARTICLES = new Set([
  '与', '和', '及', '的', '在', '向', '由', '对', '为', '把', '从', '跟', '同',
  '给', '让', '被', '我', '你', '他', '她', '它', '们', '贵', '该', '此', '其', '这', '那',
  '并', '且', '但', '而', '或', '则', '将', '已', '又', '也', '还',
])

/** 多字前导词（甲方/供应商这类角色词），按长度降序剥离。 */
const LEAD_PHRASES = Object.freeze([
  '供应商', '该单位', '本公司', '该公司', '贵公司', '我方', '贵司',
  '甲方', '乙方', '丙方', '供方', '需方', '买方', '卖方', '客户', '单位',
].sort((a, b) => b.length - a.length))

/** 向右延展机构名时的停止虚词（避免把「的」「与」吞进来）。 */
const TAIL_STOP = new Set([
  '的', '了', '和', '与', '及', '在', '是', '为', '等', '有', '将', '已', '并', '被', '把',
  '则', '而', '或', '都', '也', '还', '又', '就', '要', '会', '能', '可', '该', '此', '其',
  '本', '我', '你', '他', '她', '它', '们', '以', '于', '对', '从', '向', '由', '给', '让',
  '但', '因', '所', '如', '按', '经', '据', '若', '即', '且', '非', '未', '不', '没',
])

/** 名字字符：中日韩统一表意文字、拉丁字母、数字、间隔号。 */
function isNameChar(ch) {
  if (ch === undefined) return false
  const code = ch.codePointAt(0)
  if (code >= 0x4e00 && code <= 0x9fff) return true
  if (code >= 0x3400 && code <= 0x4dbf) return true
  if (ch === '·' || ch === '々') return true
  return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')
}

/** 向右延展的最大长度。 */
const MAX_TAIL = 20

/**
 * 检测中文机构名：后缀键控 + 前缀回溯 + 右向延展。
 * @param {string} text 归一化检索文本。
 * @param {number} maxPrefix 前缀回溯上限。
 * @returns {Array<{entity:string,label:string,start:number,end:number,score:number}>}
 */
export function detectOrgs(text, maxPrefix) {
  const spans = []
  for (const suffix of ORG_SUFFIXES) {
    let from = 0
    for (;;) {
      const at = text.indexOf(suffix, from)
      if (at === -1) break
      from = at + 1
      const start = backtrackOrgStart(text, at, maxPrefix)
      if (start === -1) continue
      const end = extendOrgTail(text, at + suffix.length)
      spans.push([start, end])
    }
  }
  if (spans.length === 0) return []
  // 合并重叠/相邻区间：让「某集团」+「有限公司」合成一个完整机构名。
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged = []
  for (const [start, end] of spans) {
    const last = merged[merged.length - 1]
    if (last !== undefined && start <= last[1]) {
      if (end > last[1]) last[1] = end
      continue
    }
    merged.push([start, end])
  }
  const out = []
  for (const [start, end] of merged) {
    // 必须够长且至少含一个汉字，避免把纯数字/英文片段当机构名。
    const raw = text.slice(start, end)
    if (raw.length < 4) continue
    if (!/[\u4e00-\u9fff]/u.test(raw)) continue
    out.push({ entity: 'cn-org', label: 'ORG', start, end, score: 0.8 })
  }
  return out
}

/** 从后缀起点向前回溯机构名前缀；返回起点，失败返回 -1。 */
function backtrackOrgStart(text, suffixStart, maxPrefix) {
  let index = suffixStart - 1
  const floor = Math.max(0, suffixStart - maxPrefix)
  while (index >= floor && isNameChar(text[index])) index--
  let start = index + 1
  // 剥掉前导角色词与虚词（"甲方是某某科技" → "某某科技"）。
  // 只在剥掉过角色词之后才额外剥一个"是"，避免破坏"是德科技"这类真实名称。
  let strippedPhrase = false
  while (start < suffixStart) {
    const phrase = LEAD_PHRASES.find((item) => item.length <= suffixStart - start && text.startsWith(item, start))
    if (phrase !== undefined) {
      start += phrase.length
      strippedPhrase = true
      continue
    }
    if (strippedPhrase && text.startsWith('是', start)) {
      start += 1
      strippedPhrase = false
      continue
    }
    if (LEAD_PARTICLES.has(text[start])) {
      start += 1
      continue
    }
    break
  }
  return suffixStart - start >= 2 ? start : -1
}

/** 从后缀末端向右延展（"某某集团北京分公司" 这类连写）。 */
function extendOrgTail(text, from) {
  let index = from
  const limit = Math.min(text.length, from + MAX_TAIL)
  let lastStop = from
  while (index < limit && isNameChar(text[index]) && !TAIL_STOP.has(text[index])) {
    index++
    lastStop = index
  }
  return lastStop
}

/** 项目/系统名引导词 → 标签。 */
const PROJ_SYS_LEADS = Object.freeze([
  ['项目名称', 'PROJ'], ['项目名', 'PROJ'], ['工程项目名称', 'PROJ'], ['课题名称', 'PROJ'],
  ['产品名称', 'PROJ'], ['软件名称', 'PROJ'], ['工程名称', 'PROJ'],
  ['系统名称', 'SYS'], ['系统名', 'SYS'], ['平台名称', 'SYS'], ['平台名', 'SYS'], ['系统全称', 'SYS'],
])

/** 名称字符集（不允许空白与中英文标点，避免吞掉整句）。
 *  注意：检索文本经过 NFKC 归一化，全角标点（，；：（）！？）已经变成半角，
 *  所以这里必须同时排除半角与全角两套标点。 */
const NAME_CLASS = '[^\\s,.;:!?()\\[\\]{}<>"\'\\\\/|，。；、：（）《》〈〉“”‘’【】]{2,30}'

/** 引导词 + 冒号 + 名称。 */
const RE_PROJ_SYS_COLON = new RegExp(
  `(?:${PROJ_SYS_LEADS.map(([word]) => word).join('|')})\\s*[:：]\\s*(${NAME_CLASS})`,
  'g',
)
/** 「项目名为 X」这类句式。 */
const RE_PROJ_SYS_VERB = new RegExp(
  `(?:项目|系统|平台|工程|课题|软件)(?:名为|叫做|名称为)\\s*[《"“]?(${NAME_CLASS})[》"”]?`,
  'g',
)
/** 关键词 + 书名号/引号。 */
const RE_PROJ_SYS_QUOTED = new RegExp(
  `(?<=项目|系统|平台|工程|课题)[《"“]([^》"”\\n]{2,30})[》"”]`,
  'g',
)

/** 依据整段匹配文本判定引导词属于系统类还是项目类。 */
function labelForLead(matched) {
  for (const [word, label] of PROJ_SYS_LEADS) if (matched.startsWith(word)) return label
  if (/系统|平台|软件/.test(matched)) return 'SYS'
  return 'PROJ'
}

/**
 * 检测项目名/系统名。
 * @param {string} text 归一化检索文本。
 * @returns {Array<object>} matches（含 group 语义，已换算为整段偏移）。
 */
export function detectProjSys(text) {
  const out = []
  for (const re of [RE_PROJ_SYS_COLON, RE_PROJ_SYS_VERB, RE_PROJ_SYS_QUOTED]) {
    for (const match of text.matchAll(re)) {
      const value = match[1]
      if (value === undefined || value.length < 2) continue
      const start = match.index + match[0].lastIndexOf(value)
      const label = labelForLead(match[0])
      out.push({
        entity: label === 'SYS' ? 'cn-system' : 'cn-project',
        label,
        start,
        end: start + value.length,
        score: 0.85,
      })
    }
  }
  return out
}

/** 编号/文号引导词。 */
const ID_LEADS = [
  '编\\s*号', '文号', '合同号', '合同编号', '单号', '订单号', '项目号', '工单号',
  '流水号', '凭证号', '档案号', '专利号', '申请号', '受理号', '备案号', '许可证号',
  '证书编号', '资产编号', '设备编号', '发票号', '保单号', '案卷号', '任务编号',
]

/** 引导词 + 编号。 */
const RE_ID_LABELED = new RegExp(
  `(?:${ID_LEADS.join('|')})\\s*[:：]?\\s*([a-z0-9][a-z0-9\\-_/.]{2,40})`,
  'g',
)

/** 前缀式编码：HT-2024-001 / PRJ-001 / SYS_2026 等。 */
const RE_ID_PREFIXED = /(?<![a-z0-9])(?:ht|cg|xm|prj|proj|sys|doc|ref|wo|po|no)[-_][a-z0-9\-_]{3,}(?![a-z0-9])/g

/**
 * 检测编号类信息。
 * @param {string} text 归一化检索文本。
 * @returns {Array<object>} matches。
 */
export function detectIds(text) {
  const out = []
  for (const match of text.matchAll(RE_ID_LABELED)) {
    const value = match[1]
    const start = match.index + match[0].lastIndexOf(value)
    out.push({ entity: 'cn-id', label: 'IDNO', start, end: start + value.length, score: 0.8 })
  }
  for (const match of text.matchAll(RE_ID_PREFIXED)) {
    out.push({
      entity: 'cn-id', label: 'IDNO',
      start: match.index, end: match.index + match[0].length, score: 0.7,
    })
  }
  return out
}

/** 地址：省/市 + 区/县 + 路/街/号 的组合。 */
const RE_ADDRESS = new RegExp(
  '(?:[\\u4e00-\\u9fff]{2,8}(?:省|自治区|市))?'
  + '[\\u4e00-\\u9fff]{2,10}(?:区|县|市|旗|镇|乡|街道)'
  + '[\\u4e00-\\u9fff0-9]{1,30}?'
  + '(?:路|街|大道|巷|弄|号|栋|幢|楼|室|层|单元|村|组)'
  + '(?:[0-9]{1,6}(?:号|栋|幢|楼|室|层|单元|院)){0,4}',
  'g',
)

/**
 * 检测中文地址。
 * @param {string} text 归一化检索文本。
 * @returns {Array<object>} matches。
 */
export function detectAddresses(text) {
  const out = []
  for (const match of text.matchAll(RE_ADDRESS)) {
    if (match[0].length < 6) continue
    out.push({
      entity: 'cn-address', label: 'ADDR',
      start: match.index, end: match.index + match[0].length, score: 0.75,
    })
  }
  return out
}

/** 人名引导词。 */
const PERSON_LEADS = [
  '姓名', '联系人', '负责人', '法定代表人', '法人代表', '项目经理', '经办人',
  '申请人', '签约人', '收件人', '寄件人', '客户姓名', '用户姓名', '开户人', '持有人',
  '汇报人', '审批人', '审核人', '编制人', '校对员', '作者',
]

/** 引导词 + 冒号 + 姓名。 */
const RE_PERSON_LABELED = new RegExp(
  `(?:${PERSON_LEADS.join('|')})\\s*[:：]\\s*([\\u4e00-\\u9fff·]{2,6})`,
  'g',
)

/** 称谓式：张某先生 / 李经理（要求前面不是汉字/字母/数字，降低误报）。 */
const RE_PERSON_TITLE = /(?<![\u4e00-\u9fffa-z0-9])([\u4e00-\u9fff]{1,4})(?:先生|女士|同志|总经理|董事长|总监|经理|主任|科长|处长|局长|部长|总裁)/g

/**
 * 检测人名（启发式，默认开启但触发条件保守）。
 * @param {string} text 归一化检索文本。
 * @returns {Array<object>} matches。
 */
export function detectPersons(text) {
  const out = []
  for (const match of text.matchAll(RE_PERSON_LABELED)) {
    const value = match[1]
    const start = match.index + match[0].lastIndexOf(value)
    out.push({ entity: 'cn-person', label: 'PERSON', start, end: start + value.length, score: 0.8 })
  }
  for (const match of text.matchAll(RE_PERSON_TITLE)) {
    const value = match[1]
    if (value === undefined) continue
    const start = match.index + match[0].lastIndexOf(value)
    out.push({ entity: 'cn-person', label: 'PERSON', start, end: start + value.length, score: 0.6 })
  }
  return out
}

/** 实体名 → 检测函数。 */
export const CN_DETECTORS = Object.freeze({
  'cn-org': detectOrgs,
  'cn-project': detectProjSys,
  'cn-system': detectProjSys,
  'cn-id': detectIds,
  'cn-address': detectAddresses,
  'cn-person': detectPersons,
})

/**
 * 跑选中的中文检测器。
 * @param {string} text 归一化检索文本。
 * @param {string[]} entities 启用的实体。
 * @param {number} maxOrgPrefix 机构名前缀回溯上限。
 * @returns {Array<object>} matches。
 */
export function detectChinese(text, entities, maxOrgPrefix) {
  const enabled = new Set(entities)
  const out = []
  // 每个检测函数只跑一次（cn-project / cn-system 共用同一个函数）。
  const visited = new Set()
  for (const [entity, fn] of Object.entries(CN_DETECTORS)) {
    if (!enabled.has(entity) || visited.has(fn)) continue
    visited.add(fn)
    for (const match of fn(text, maxOrgPrefix)) {
      if (enabled.has(match.entity)) out.push(match)
    }
  }
  return out
}
