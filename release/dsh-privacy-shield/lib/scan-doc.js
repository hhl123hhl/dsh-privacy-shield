// lib/scan-doc.js — 本地文档候选专名抽取（零依赖）。
//
// 流程：读文件（按扩展名选解析器）→ 抽候选（后缀词典 + 编号模式 + 词频）→
//       剔除引擎已能覆盖的片段 → 输出候选表（不写入词表，等用户确认）。
// 全程本地；候选只是"建议"，绝不自动入词表。

import { readFileSync, statSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { collectNameCandidates, mergeCandidateInto } from './name-candidates.js'

/** 单个文件读取上限。 */
const MAX_FILE_BYTES = 8 * 1024 * 1024

/** 可直接按文本读取的扩展名。 */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'log', 'xml', 'html', 'htm',
  'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'srt',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'c', 'h', 'cpp', 'hpp',
  'css', 'scss', 'sql', 'sh', 'bat', 'ps1', 'vue',
])

/** 机构/项目/系统名后缀词典：后缀 → 建议分类。 */
const SUFFIXES = [
  ['有限责任公司', 'company'], ['股份有限公司', 'company'], ['有限公司', 'company'],
  ['集团公司', 'company'], ['集团', 'company'], ['公司', 'company'],
  ['银行', 'company'], ['医院', 'company'], ['大学', 'company'], ['学院', 'company'],
  ['研究所', 'company'], ['研究院', 'company'], ['实验室', 'company'], ['中心', 'company'],
  ['事务所', 'company'], ['厂', 'company'],
  ['项目', 'project'], ['工程', 'project'], ['计划', 'project'],
  ['系统', 'system'], ['平台', 'system'], ['数据库', 'system'], ['APP', 'system'],
  ['小程序', 'system'], ['网站', 'system'], ['模块', 'system'], ['子系统', 'system'],
]

/** 名字字符：CJK/字母/数字。 */
const RE_NAME_CHAR = /[\u4e00-\u9fa5A-Za-z0-9]/

/** 边界字符：扩展专名前缀时遇到即停（功能词/动词/助词，名字内部极少出现）。 */
const BOUNDARY_CHARS = new Set([
  '请', '使', '用', '在', '是', '把', '将', '给', '向', '从', '和', '与', '及', '的', '了',
  '对', '于', '由', '被', '让', '令', '接', '承', '如', '见', '又', '为', '到', '着', '过',
  '其', '该', '此', '本', '各', '每', '某', '上', '下', '中', '内', '外', '前', '后',
])

/** 后缀匹配正则（长的在前，避免"公司"抢在"集团公司"前面）。 */
const RE_SUFFIX = new RegExp(
  SUFFIXES.map(([suffix]) => suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length).join('|'),
  'g',
)

const SUFFIX_LABEL = new Map(SUFFIXES.map(([suffix, category]) => {
  const label = { company: 'ORG', project: 'PROJ', system: 'SYS' }[category] ?? 'TERM'
  return [suffix.toLowerCase(), label]
}))

/**
 * 从文本抽出"后缀词典"命中的专名候选（供 extractCandidates 与 learn 共用）。
 * 算法：定位每个后缀 → 向前扩展到边界字符/非名字字符/18 字上限为止。
 * 不做频次统计、不做已覆盖剔除——调用方自行计数与过滤。
 * @param {string} source 文本。
 * @returns {Array<{value: string, label: string}>} 命中片段（含重复）。
 */
export function extractSuffixCandidates(source) {
  const out = []
  RE_SUFFIX.lastIndex = 0
  for (const match of source.matchAll(RE_SUFFIX)) {
    const suffix = match[0]
    const end = match.index + suffix.length
    let start = match.index
    while (
      start > 0
      && RE_NAME_CHAR.test(source[start - 1])
      && !BOUNDARY_CHARS.has(source[start - 1])
      && end - start < 18
    ) start -= 1
    const value = source.slice(start, end)
    if (value.length < suffix.length + 1) continue // 前缀为空：后缀本身不是专名候选
    out.push({ value, label: SUFFIX_LABEL.get(suffix.toLowerCase()) ?? 'TERM' })
  }
  return out
}

/** 编号模式：1-6 位大写字母/数字 + 连字符 + 2-6 位数字（HT-2024-001、GW-A1234 等）。 */
const RE_CODE = /(?<![A-Za-z0-9-])(?:[A-Z]{1,6}[-–—]){1,3}A?\d{2,6}(?:[-–—]\d{2,6})?(?![A-Za-z0-9-])/g

/** docx/XML 实体解码表。 */
function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
}

/** 剥离 XML 标签，只留文本节点内容。 */
function stripXml(xml) {
  return decodeXmlEntities(
    xml
      .replace(/<script[\s\S]*?<\/script>/giu, ' ')
      .replace(/<style[\s\S]*?<\/style>/giu, ' ')
      .replace(/<[^>]+>/gu, ' '),
  )
}

/**
 * 迷你 unzip：顺序扫描本地文件头（PK\x03\x04），不解中央目录。
 * 返回 Map<entryName, Buffer>（只保留解压成功的条目）。
 */
export function miniUnzip(buf) {
  const out = new Map()
  let pos = 0
  while (pos + 30 <= buf.length) {
    const sig = buf.readUInt32LE(pos)
    if (sig !== 0x04034b50) { pos += 1; continue }
    const method = buf.readUInt16LE(pos + 8)
    const compressedSize = buf.readUInt32LE(pos + 18)
    const nameLen = buf.readUInt16LE(pos + 26)
    const extraLen = buf.readUInt16LE(pos + 28)
    const name = buf.subarray(pos + 30, pos + 30 + nameLen).toString('utf8')
    const dataStart = pos + 30 + nameLen + extraLen
    if (compressedSize === 0) { pos = dataStart; continue }
    if (dataStart + compressedSize > buf.length) break
    const raw = buf.subarray(dataStart, dataStart + compressedSize)
    try {
      out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw))
    } catch { /* 跳过坏条目 */ }
    pos = dataStart + compressedSize
  }
  return out
}

/**
 * 读取文件为纯文本（按扩展名分派）。pdf 等不支持格式抛出明确提示。
 * @param {string} path 文件路径。
 * @returns {string} 文本。
 */
export function extractText(path) {
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  const buf = readFileSync(path)
  if (buf.length > MAX_FILE_BYTES) throw new Error('文件超过 8MB，请先拆分')
  if (ext === 'docx') {
    const entries = miniUnzip(buf)
    const doc = entries.get('word/document.xml')
    if (doc === undefined) throw new Error('docx 里找不到 word/document.xml')
    return stripXml(doc.toString('utf8'))
  }
  if (ext === 'xlsx') {
    const entries = miniUnzip(buf)
    const parts = []
    // 共享字符串表：单元格文本大多存这里
    const sst = entries.get('xl/sharedStrings.xml')
    if (sst !== undefined) {
      // <si><t>文字</t></si>；也可能有富文本 <si><r><t>…</t></r></si>
      for (const si of sst.toString('utf8').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
        const text = si[1].replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim()
        if (text !== '') parts.push(text)
      }
    }
    // 内联字符串（inlineStr）与工作表里的直接文本
    for (const [name, data] of entries) {
      if (!name.startsWith('xl/worksheets/') || !name.endsWith('.xml')) continue
      const xml = data.toString('utf8')
      for (const t of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
        const text = decodeXmlEntities(t[1]).replace(/\s+/gu, ' ').trim()
        if (text !== '') parts.push(text)
      }
    }
    if (parts.length === 0) throw new Error('xlsx 里没解析出文本（可能整表为空或使用了不支持的格式）')
    return parts.join('\n')
  }
  if (ext === 'pptx') {
    const entries = miniUnzip(buf)
    const parts = []
    const slides = [...entries.keys()]
      .filter((k) => k.startsWith('ppt/slides/slide') && k.endsWith('.xml'))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    for (const name of slides) {
      const xml = entries.get(name).toString('utf8')
      for (const t of xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)) {
        const text = decodeXmlEntities(t[1]).replace(/\s+/gu, ' ').trim()
        if (text !== '') parts.push(text)
      }
    }
    // 演讲者备注
    for (const [name, data] of entries) {
      if (!name.startsWith('ppt/notesSlides/') || !name.endsWith('.xml')) continue
      for (const t of data.toString('utf8').matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)) {
        const text = decodeXmlEntities(t[1]).replace(/\s+/gu, ' ').trim()
        if (text !== '') parts.push(text)
      }
    }
    if (parts.length === 0) throw new Error('pptx 里没解析出文本（可能全是图片/空幻灯片）')
    return parts.join('\n')
  }
  if (ext === 'pdf') {
    throw new Error('PDF 暂不支持直接解析：请先用 Word/WPS 打开另存为 .docx，或复制文本存成 .txt 后再扫描')
  }
  if (!TEXT_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的扩展名 .${ext}（支持纯文本类、.docx、.xlsx、.pptx）`)
  }
  if (buf.includes(0)) throw new Error('文件含二进制内容，不是纯文本')
  return buf.toString('utf8')
}

/**
 * 从文本抽取候选专名。
 * @param {string} text 文档文本。
 * @param {import('./engine.js').MaskEngine} engine 现用引擎（用于剔除已覆盖片段）。
 * @param {object} [options] 选项。
 * @param {number} [options.maxCandidates] 返回上限。
 * @returns {Array<{value: string, count: number, label: string, source: string}>} 候选（按频次降序）。
 */
export function extractCandidates(text, engine, options = {}) {
  const maxCandidates = options.maxCandidates ?? 200
  const source = typeof text === 'string' ? text : String(text ?? '')
  if (source === '') return []

  // 1) 已覆盖集合：引擎能命中的值不需要再入词表。
  const covered = new Set()
  if (engine !== undefined && engine !== null && source.length <= 2_000_000) {
    for (const hit of engine.detect(source)) covered.add(hit.value.normalize('NFKC').toLowerCase())
  }

  const counts = new Map() // key -> {value,label,source,count}
  const bump = (value, label, src) => {
    const key = value.normalize('NFKC').toLowerCase()
    if (covered.has(key)) return
    if (key.length < 2) return
    const existing = counts.get(key)
    if (existing !== undefined) { existing.count += 1; return }
    counts.set(key, { value, count: 1, label, source: src })
  }

  // 2) 后缀词典：机构/项目/系统名。
  for (const { value, label } of extractSuffixCandidates(source)) {
    bump(value, label, '后缀词典')
  }

  // 3) 编号模式。
  for (const match of source.matchAll(RE_CODE)) {
    bump(match[0], 'IDNO', '编号模式')
  }

  // 4) 多路召回（第 2 轮）：无引导词、无词典后缀的专名也进候选。
  //    每条候选带 evidence，说明它是被哪一路证据召回的（列头/同现/引号/期次）。
  for (const item of collectNameCandidates(source, { engine, maxCandidates })) {
    mergeCandidateInto(counts, item)
  }

  // 5) 词频过滤：出现 ≥2 次的候选排前面；只出现 1 次的也保留但排在后。
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || b.value.length - a.value.length)
    .slice(0, maxCandidates)
}

/**
 * 扫描一个文件并产出候选表（命令与 RPC 共用入口）。
 * @param {string} path 文件路径。
 * @param {import('./engine.js').MaskEngine} engine 现用引擎。
 * @returns {{path: string, bytes: number, candidates: Array<object>}} 结果。
 */
export function scanDocument(path, engine) {
  const text = extractText(path)
  const candidates = extractCandidates(text, engine)
  return { path, bytes: statSync(path).size, candidates }
}
