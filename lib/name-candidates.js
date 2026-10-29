// lib/name-candidates.js — 无引导词专名的多路候选召回（零依赖）。
//
// 背景（第 2 轮）：
//   上一轮用"表格列语义"补上了裸值的脱敏，但**候选召回**仍只认三种线索：
//   ①引导词（项目名称：X）②后缀词典（X项目/X有限公司）③高频片段（≥3 次）。
//   于是"没有引导词、也不在词典后缀里、只出现一两次"的项目名/系统名
//   （如「蓝鸟计划」「蓝鸟北分」「智慧园区」）既不会被遮，也**不会出现在候选里**，
//   用户根本不知道有东西漏了。
//
// 这一层做的事：把候选召回也做成多路，任何一路有证据就交给人确认：
//   P1 列语义：TSV/CSV/Markdown 表里"项目/合同/单位"列的值（列头即证据）
//   P2 上下文同现：与 合同/客户/验收/中标/里程碑… 同句出现的 3–12 字片段
//   P3 后缀扩展：宽后缀（项目/工程/计划/平台/系统/一期/二期/改造/建设…）
//   P4 引号包裹：《…》「…」“…” 里的片段
//   P5 高频片段：同一文档/会话里重复出现 ≥2 次的片段（兜底）
//
// 诚实边界：这是启发式召回，不是识别。候选只进候选池，必须 /shield terms adopt 确认。
// 绝不自动入词表——误遮一个常用词比漏遮一个项目名更伤可用性。

import { detectColumnRole, COLUMN_ROLES } from './table.js'

/** 单个候选值长度上限（超过多半是整句）。 */
const MAX_VALUE_LEN = 40
/** 最短候选长度。 */
const MIN_VALUE_LEN = 2
/** 候选默认频次阈值：强证据（列语义/引号/期次/同现）出现一次即可进候选，
 *  高频兜底路径在 collectFromFrequency 内部自行要求 ≥2 次。 */
const DEFAULT_MIN_COUNT = 1
/** 高频兜底的独立频次阈值（单次出现的片段太碎，必进噪声）。 */
const FREQUENCY_MIN_COUNT = 2

/** 同现线索词：出现这些词的句子里，裸专名概率显著升高。 */
const CUE_WORDS = /(合同|客户|甲方|乙方|验收|交付|实施|上线|里程碑|标段|招标|中标|投标|项目组|项目名|回款|结算)/u

/** 通用词/虚词：即使有线索也不该进候选（宁缺毋滥）。 */
const GENERIC = new Set([
  '合同', '客户', '甲方', '乙方', '验收', '交付', '实施', '上线', '里程碑', '标段',
  '招标', '中标', '投标', '项目组', '项目名', '回款', '结算', '项目', '系统', '平台',
  '工程', '计划', '公司', '金额', '总额', '名称', '编号', '单位', '时间', '日期',
  '备注', '说明', '序号', '类型', '状态', '以上', '以下', '如下', '本次', '其中',
  '以及', '或者', '并且', '我们', '你们', '他们', '这个', '那个', '可以', '需要',
  '已经', '目前', '现在', '问题', '情况', '内容', '部分', '相关', '负责', '处理',
])

/** 片段尾部不像专名的字（动词/助词/连词）。 */
const BAD_TAIL = /[的了是在和与及或把将被从对为着过也都就还又很更最]$/u

/** 宽后缀词典：候选召回用，比 scan-doc 的脱敏词典更宽。 */
const WIDE_SUFFIXES = [
  ['有限责任公司', 'ORG'], ['有限公司', 'ORG'], ['股份有限公司', 'ORG'], ['集团公司', 'ORG'],
  ['集团', 'ORG'], ['公司', 'ORG'], ['银行', 'ORG'], ['医院', 'ORG'], ['大学', 'ORG'],
  ['学院', 'ORG'], ['研究所', 'ORG'], ['研究院', 'ORG'], ['实验室', 'ORG'], ['中心', 'ORG'],
  ['事务所', 'ORG'], ['委员会', 'ORG'], ['管理局', 'ORG'], ['分局', 'ORG'], ['局', 'ORG'],
  ['项目', 'PROJ'], ['工程', 'PROJ'], ['计划', 'PROJ'], ['课题', 'PROJ'], ['标段', 'PROJ'],
  ['系统', 'SYS'], ['平台', 'SYS'], ['数据库', 'SYS'], ['小程序', 'SYS'], ['网站', 'SYS'],
  ['中台', 'SYS'], ['门户', 'SYS'], ['子系统', 'SYS'], ['模块', 'SYS'],
]

/** 期次/阶段后缀：往往挂在项目/系统名尾部，本身不是专名。 */
const PHASE_SUFFIX = /[\u4e00-\u9fa5A-Za-z0-9]{2,14}(?:一期|二期|三期|四期|首期|试点|改造|建设|升级|迁移)/gu

/**
 * 名字"外壳"词：整串只剩这些词时不是专名（`有限公司`、`分公司`、`项目部`）。
 * 判定时从尾部反复剥除，剥完不足 2 字即判为碎片。长词在前，避免先剥短词。
 */
const NAME_BODY_STRIP = [
  '有限责任公司', '股份有限公司', '有限公司', '分公司', '子公司', '集团公司',
  '营业部', '办事处', '项目部', '管理局', '研究<IDNO_a3e7b2c5>',
  '委员会', '研究院', '研究所', '实验室', '事务所', '集团', '公司', '银行',
  '分行', '支行', '医院', '大学', '学院', '中心', '分局', '大队', '支队',
  '系统', '平台', '数据库', '中台', '门户', '网站', '项目', '工程', '计划', '课题', '标段',
  '局', '委', '办', '厅', '部', '院', '所',
]

/** 名字字符：CJK/字母/数字。 */
const RE_NAME_CHAR = /[\u4e00-\u9fa5A-Za-z0-9]/u

/** 边界字符：向前扩展专名时遇到即停。 */
const BOUNDARY_CHARS = new Set([
  '请', '使', '用', '在', '是', '把', '将', '给', '向', '从', '和', '与', '及', '的', '了',
  '对', '于', '由', '被', '让', '令', '接', '承', '如', '见', '又', '为', '到', '着', '过',
  '其', '该', '此', '本', '各', '每', '某', '上', '下', '中', '内', '外', '前', '后',
])

/** 后缀正则（长后缀优先）。 */
const RE_WIDE_SUFFIX = new RegExp(
  WIDE_SUFFIXES.map(([suffix]) => suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length).join('|'),
  'gu',
)

const SUFFIX_LABEL = new Map(WIDE_SUFFIXES.map(([suffix, label]) => [suffix.toLowerCase(), label]))

/** 引号包裹（书名号/直角引号/中文双引号）。 */
const RE_WRAPPED = [/《([^》]{2,40})》/gu, /「([^」]{2,40})」/gu, /“([^”]{2,40})”/gu]

/** 高频片段切分（CJK/字母数字连续段）。 */
const RE_SEGMENT = /[\u4e00-\u9fa5A-Za-z0-9]{2,16}/gu

/** 项目/系统后缀（决定标签与是否值得进候选）。 */
const RE_PROJ_TAIL = /(项目|工程|计划|课题|标段|一期|二期|三期|四期|首期|试点|改造|建设|升级|迁移)$/u
const RE_SYS_TAIL = /(系统|平台|数据库|小程序|网站|中台|门户|子系统|模块)$/u
const RE_ORG_TAIL = /(局|委|办|厅|部|院|所|中心|公司|集团|银行|医院|大学|学院|学校|协会|学会|基金会|出版社|电视台|报社|研究院|事务所|工作室|厂|站|队|署|会)$/u

/** 表格单元格里的"无意义值"。 */
const NOT_PROJECT = new Set(['无', '暂无', '其他', '不适用', '未知', '待定', 'n/a', 'na', '-', '—', '/', '待补充'])

/** 单行最多处理的列数/行数（防御异常宽表与巨型表）。 */
const MAX_COLUMNS = 120
const MAX_ROWS = 2000

/** 把行切成单元格。 */
function splitCells(line, delim) {
  const cells = []
  let start = 0
  for (let i = 0; i <= line.length; i++) {
    if (i === line.length || line[i] === delim) {
      cells.push(line.slice(start, i))
      start = i + 1
    }
    if (cells.length > MAX_COLUMNS) break
  }
  if (delim === '|') {
    if (cells.length > 0 && cells[0].trim() === '') cells.shift()
    if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop()
  }
  return cells
}

/** 判断分隔符。单制表符也算 TSV：两列表（姓名/金额）同样要能识别。 */
function guessDelimiter(line) {
  const tabs = (line.match(/\t/gu) ?? []).length
  if (tabs >= 1) return '\t'
  const pipes = (line.match(/\|/gu) ?? []).length
  if (pipes >= 3) return '|'
  const commas = (line.match(/,/gu) ?? []).length
  if (commas >= 3) return ','
  return null
}

/** 名字形状判定：取值是否是"像专名"的裸值。 */
function isNameLike(value) {
  if (value.length < MIN_VALUE_LEN || value.length > MAX_VALUE_LEN) return false
  if (GENERIC.has(value) || NOT_PROJECT.has(value.toLowerCase())) return false
  if (BAD_TAIL.test(value)) return false
  if (!/[\u4e00-\u9fa5A-Za-z]/u.test(value)) return false
  // 纯数字/纯编号交给编号检测器，不进专名候选。
  if (/^[A-Za-z0-9._/-]+$/u.test(value) && /\d/u.test(value)) return false
  // 只剩机构/项目"通用尾巴"的片段不算专名：`有限公司`、`分公司`、`项目`。
  if (stripNameBody(value).length < 2) return false
  return true
}

/**
 * 剥掉尾部通用后缀，返回"名字本体"。
 * 用于识别 `有限公司`、`股份有限公司`、`分公司` 这类只有壳没有名的碎片——
 * 它们会经高频路径混进候选，确认后变成一条永远匹配不到专名的噪声规则。
 * @param {string} value 候选原值。
 * @returns {string} 去掉尾部通用词后的剩余部分。
 */
function stripNameBody(value) {
  let body = value
  // 反复剥，处理 `XX有限公司` 这种后缀叠加；最多 3 层足够。
  for (let round = 0; round < 3; round += 1) {
    const before = body
    for (const token of NAME_BODY_STRIP) {
      if (body.length >= token.length && body.endsWith(token)) {
        body = body.slice(0, -token.length)
        break
      }
    }
    if (body === before) break
  }
  return body
}

/** 按后缀/尾部猜标签。 */
function guessLabel(value) {
  if (RE_ORG_TAIL.test(value)) return 'ORG'
  if (RE_SYS_TAIL.test(value)) return 'SYS'
  if (RE_PROJ_TAIL.test(value)) return 'PROJ'
  return 'TERM'
}

/**
 * 候选收集器：同值合并证据，计数取"单路最大值"而不是各路相加。
 * 理由：同一个值往往被多路同时召回（后缀 + 高频、列语义 + 高频），
 * 相加会把"出现 2 次"虚报成 4 次，误导用户判断该词的重要性。
 */
class Collector {
  constructor() {
    this.map = new Map() // key -> {value,label,source,evidence:Set,sources:Map<path,count>}
  }

  /**
   * 记一次命中。
   * @param {string} value 原值。
   * @param {string} label 建议标签。
   * @param {string} source 召回路径。
   * @param {string} [evidence] 证据描述。
   * @param {number} [weight] 计数增量。
   */
  add(value, label, source, evidence, weight = 1) {
    const trimmed = String(value ?? '').trim()
    if (!isNameLike(trimmed)) return
    const key = trimmed.normalize('NFKC').toLowerCase()
    const existing = this.map.get(key)
    if (existing !== undefined) {
      existing.sources.set(source, (existing.sources.get(source) ?? 0) + weight)
      existing.evidence.add(evidence ?? source)
      // 标签优先级：ORG/SYS/PROJ > TERM（更具体的更有用）
      if (existing.label === 'TERM' && label !== 'TERM') existing.label = label
      return
    }
    this.map.set(key, {
      value: trimmed,
      label,
      source,
      evidence: new Set([evidence ?? source]),
      sources: new Map([[source, weight]]),
    })
  }

  /** 导出候选表（按证据强度排序）。 */
  toArray(minCount, maxCandidates) {
    return [...this.map.values()]
      .map((item) => ({
        value: item.value,
        // 单路最大计数 = 该值出现次数的保守估计。
        count: Math.max(...item.sources.values()),
        label: item.label,
        source: item.source,
        evidence: [...item.evidence].slice(0, 3),
      }))
      .filter((item) => item.count >= minCount)
      .sort((left, right) => right.count - left.count
        || right.evidence.length - left.evidence.length
        || right.value.length - left.value.length)
      .slice(0, maxCandidates)
  }
}

/**
 * P1 列语义：从 TSV/CSV/Markdown 表里抽"项目/合同/单位"列的值。
 * @param {string} text 原文。
 * @param {Collector} collector 收集器。
 */
function collectFromTables(text, collector) {
  const lines = text.split('\n')
  for (let index = 0; index + 1 < lines.length && index < MAX_ROWS; index++) {
    const headerLine = lines[index]
    if (headerLine.trim() === '') continue
    const delim = guessDelimiter(headerLine)
    if (delim === null) continue
    const headers = splitCells(headerLine, delim)
    if (headers.length < 2) continue
    const roles = headers.map((cell) => detectColumnRole(cell))
    if (!roles.some((role) => role !== null)) continue

    let startRow = index + 1
    if (startRow < lines.length && /^[\s|:-]+$/u.test(lines[startRow]) && lines[startRow].includes('-')) startRow++
    let rows = 0
    for (let row = startRow; row < lines.length && rows < MAX_ROWS / 4; row++) {
      const line = lines[row]
      if (line.trim() === '') break
      const cells = splitCells(line, delim)
      if (cells.length < 2 || Math.abs(cells.length - headers.length) > 1) break
      rows++
      for (let col = 0; col < cells.length && col < roles.length; col++) {
        const role = roles[col]
        if (role === null) continue
        const value = cells[col].trim()
        if (value === '' || value.includes('<') || value.length > MAX_VALUE_LEN) continue
        const header = headers[col].trim()
        if (role === COLUMN_ROLES.proj) {
          const cjk = (value.match(/[\u4e00-\u9fa5]/gu) ?? []).length
          if (cjk >= 2 && value.length >= 3 && !NOT_PROJECT.has(value)) {
            collector.add(value, guessLabel(value) === 'TERM' ? 'PROJ' : guessLabel(value), '列语义', `列头「${header}」`)
          }
        } else if (role === COLUMN_ROLES.org || role === COLUMN_ROLES.unit) {
          if (/[\u4e00-\u9fa5]/u.test(value) && value.length >= 3 && !NOT_PROJECT.has(value)) {
            collector.add(value, role === COLUMN_ROLES.org ? 'ORG' : guessLabel(value), '列语义', `列头「${header}」`)
          }
        }
      }
    }
    index = startRow + Math.max(rows, 1) - 1
  }
}

/**
 * P2 上下文同现：与线索词同句的 3–12 字片段。
 * 先把线索词与功能词替换成分隔符，避免"本次验收由星联智造负责"被当成一个整段。
 * @param {string} text 原文。
 * @param {Collector} collector 收集器。
 */
function collectFromContext(text, collector) {
  for (const line of text.split('\n')) {
    if (!CUE_WORDS.test(line)) continue
    const cleaned = line.replace(/(本次|验收|由|负责|执行|已经|完成|合同|客户|甲方|乙方|交付|实施|上线|里程碑|标段|招标|中标|投标|项目组|项目名|回款|结算|的|了|在|与|和|及|是|将|把|对|为|我们|你们|他们|这个|那个)/gu, '|')
    for (const match of cleaned.matchAll(/[\u4e00-\u9fa5]{3,12}/gu)) {
      const value = match[0]
      if (GENERIC.has(value) || BAD_TAIL.test(value)) continue
      collector.add(value, guessLabel(value), '上下文同现', '与合同/客户/验收等线索词同句')
    }
  }
}

/**
 * P3 后缀扩展：宽后缀向前回溯 + 期次后缀。
 * @param {string} text 原文。
 * @param {Collector} collector 收集器。
 */
function collectFromSuffixes(text, collector) {
  RE_WIDE_SUFFIX.lastIndex = 0
  for (const match of text.matchAll(RE_WIDE_SUFFIX)) {
    const suffix = match[0]
    const end = match.index + suffix.length
    let start = match.index
    while (start > 0 && RE_NAME_CHAR.test(text[start - 1]) && !BOUNDARY_CHARS.has(text[start - 1]) && end - start < 18) {
      start -= 1
    }
    const value = text.slice(start, end)
    if (value.length <= suffix.length) continue // 只有后缀本身，不是专名
    collector.add(value, SUFFIX_LABEL.get(suffix.toLowerCase()) ?? guessLabel(value), '后缀扩展', `后缀「${suffix}」`)
  }
  for (const match of text.matchAll(PHASE_SUFFIX)) {
    collector.add(match[0], guessLabel(match[0]) === 'TERM' ? 'PROJ' : guessLabel(match[0]), '后缀扩展', '期次/阶段后缀')
  }
}

/**
 * P4 引号包裹。
 * @param {string} text 原文。
 * @param {Collector} collector 收集器。
 */
function collectFromWrapped(text, collector) {
  for (const re of RE_WRAPPED) {
    re.lastIndex = 0
    for (const match of text.matchAll(re)) {
      const value = match[1].trim()
      if ((value.match(/[\u4e00-\u9fa5]/gu) ?? []).length < 2) continue
      collector.add(value, guessLabel(value), '引号包裹', '书名号/引号内')
    }
  }
}

/**
 * P5 高频片段兜底。
 * @param {string} text 原文。
 * @param {Collector} collector 收集器。
 */
function collectFromFrequency(text, collector) {
  const counts = new Map()
  RE_SEGMENT.lastIndex = 0
  for (const match of text.matchAll(RE_SEGMENT)) {
    const value = match[0]
    if (GENERIC.has(value) || BAD_TAIL.test(value)) continue
    const key = value.normalize('NFKC').toLowerCase()
    counts.set(key, { value, count: (counts.get(key)?.count ?? 0) + 1 })
  }
  for (const item of counts.values()) {
    if (item.count < FREQUENCY_MIN_COUNT) continue
    collector.add(item.value, guessLabel(item.value), '高频片段', `出现 ${item.count} 次`, item.count)
  }
}

/**
 * 多路召回候选专名。
 * @param {string} text 原文（未归一化）。
 * @param {object} [options] 选项。
 * @param {import('./engine.js').MaskEngine} [options.engine] 现用引擎：已能命中的值不再推荐。
 * @param {number} [options.minCount] 频次阈值。
 * @param {number} [options.maxCandidates] 返回上限。
 * @param {string[]} [options.paths] 只跑指定路径（'列语义'|'上下文同现'|'后缀扩展'|'引号包裹'|'高频片段'）。
 * @returns {Array<{value:string,count:number,label:string,source:string,evidence:string[]}>} 候选。
 */
export function collectNameCandidates(text, options = {}) {
  const source = typeof text === 'string' ? text : String(text ?? '')
  if (source.trim() === '') return []
  const collector = new Collector()
  const wanted = Array.isArray(options.paths) && options.paths.length > 0 ? new Set(options.paths) : null

  if (wanted === null || wanted.has('列语义')) collectFromTables(source, collector)
  if (wanted === null || wanted.has('上下文同现')) collectFromContext(source, collector)
  if (wanted === null || wanted.has('后缀扩展')) collectFromSuffixes(source, collector)
  if (wanted === null || wanted.has('引号包裹')) collectFromWrapped(source, collector)
  if (wanted === null || wanted.has('高频片段')) collectFromFrequency(source, collector)

  // 已覆盖剔除：引擎能命中的值不需要再入词表。
  let covered = new Set()
  const engine = options.engine
  if (engine !== undefined && engine !== null && source.length <= 2_000_000) {
    covered = new Set(engine.detect(source).map((hit) => hit.value.normalize('NFKC').toLowerCase()))
  }

  return collector
    .toArray(options.minCount ?? DEFAULT_MIN_COUNT, options.maxCandidates ?? 200)
    .filter((item) => !covered.has(item.value.normalize('NFKC').toLowerCase()))
}

/**
 * 把一个候选合并进既有候选表（标签就高、证据合并、计数取较大者）。
 * 计数不做加法：同一个值常被"后缀/同现/高频"多路同时召回，
 * 相加会把出现 2 次虚报成 4 次。两条独立来源各自统计时取 max 更接近事实。
 * @param {Map<string, object>} map 目标表（key 为归一化值）。
 * @param {object} item 候选。
 */
export function mergeCandidateInto(map, item) {
  if (item === null || typeof item !== 'object') return
  const value = String(item.value ?? '').trim()
  if (value === '') return
  const key = value.normalize('NFKC').toLowerCase()
  const count = Number.isFinite(item.count) ? item.count : 1
  const existing = map.get(key)
  const evidence = Array.isArray(item.evidence) ? item.evidence.filter((entry) => typeof entry === 'string') : []
  if (existing === undefined) {
    map.set(key, {
      value,
      count,
      label: typeof item.label === 'string' ? item.label : 'TERM',
      source: typeof item.source === 'string' ? item.source : '候选',
      evidence: evidence.slice(0, 3),
    })
    return
  }
  existing.count = Math.max(existing.count, count)
  if (existing.label === 'TERM' && typeof item.label === 'string' && item.label !== 'TERM') existing.label = item.label
  const merged = new Set([...(existing.evidence ?? []), ...evidence])
  existing.evidence = [...merged].slice(0, 3)
}
