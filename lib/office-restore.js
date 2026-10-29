// lib/office-restore.js — office 文档（docx/xlsx/pptx）占位符还原（零第三方依赖）。
//
// 背景：护盾的承诺是「模型只见占位符、落盘是真人」。但 restore-file / MCP restore_write
// 原本只支持纯文本（遇到二进制直接拒绝），于是 agent 生成的 report.docx / table.xlsx
// 里若带占位符就无法还原 —— 承诺断在最后一环。
//
// 做法：OOXML 本质是 zip。正文都在 XML 的文本节点里（<w:t> / <t> / <a:t>），
// 所以流程是：解包 → 逐个 XML 部件做占位符替换（只动文本节点，不碰结构）→ 重新打包。
//
// 安全边界（刻意设计）：
//   1. 只改 XML 文本节点的**内容**，不改标签、不改属性、不动非 XML 部件（图片/样式/关系…原样透传）；
//   2. 还原值做 XML 转义（& < > " '），杜绝还原值破坏文档结构；
//   3. 解包有大小上限（防 zip bomb），条目数有上限；
//   4. 重打包保留原始压缩方式（deflate/store）与条目顺序，最大程度保持文件结构一致；
//   5. 写盘前先写 .bak 备份（原文件字节级备份，不是"重打包后"）；
//   6. 任一部件处理失败 → 整体放弃，不产出半成品文件（fail-closed）。
//
// 注：pptx 的 <a:t> 与 docx 的 <w:t> 都可能被 XML 实体编码（&lt; &gt; &amp;），
// 还原时必须先解码再匹配、替换后再编码。

import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { PLACEHOLDER_RE, LOOSE_PLACEHOLDER_RE } from './constants.js'

/** 解包后单条目上限（防 zip bomb）。 */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024
/** 解包后总大小上限（防 zip bomb）。 */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
/** 条目数上限（防 zip bomb）。 */
const MAX_ENTRIES = 8192

/** 支持还原的扩展名 → 该格式的正文部件路径前缀。 */
const OFFICE_KINDS = {
  docx: { label: 'Word (.docx)', xmlPrefixes: ['word/'] },
  xlsx: { label: 'Excel (.xlsx)', xmlPrefixes: ['xl/'] },
  pptx: { label: 'PowerPoint (.pptx)', xmlPrefixes: ['ppt/'] },
}

/** 占位符（精确 + 宽松，与引擎保持同口径）。 */
const RE_PLACEHOLDER = PLACEHOLDER_RE
const RE_PLACEHOLDER_LOOSE = LOOSE_PLACEHOLDER_RE
/**
 * 实体编码形式的占位符（OOXML 里的真实形态）。
 * 占位符含 `<` `>`，在 XML 里必须编码成 &lt;…&gt;，所以真实文档里几乎都是这个形态。
 * 与 constants.js 的语义保持一致。
 */
const RE_PLACEHOLDER_ESC = /&lt;([A-Z][A-Z0-9]{0,15})_([0-9a-f]{8})&gt;/g
const RE_PLACEHOLDER_ESC_LOOSE = /&lt;([A-Za-z][A-Za-z0-9]{0,15})[\s\-_]([0-9a-fA-F]{8})&gt;/g

/** XML 实体编码：还原值写回前必须转义，否则 "&" 会破坏文档。 */
function encodeXmlEntities(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * CRC-32（写 zip 需要）。查表法，零依赖。
 * @param {Buffer} buf 输入。
 * @returns {number} 无符号 CRC-32。
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/**
 * 迷你 unzip：顺序扫描本地文件头（PK\x03\x04），不解中央目录。
 * 与 scan-doc.js 同款，但额外保留压缩方式与顺序（重打包时要用）。
 * @param {Buffer} buf zip 字节。
 * @returns {Array<{name: string, method: number, data: Buffer}>} 条目（按出现顺序）。
 */
export function readZipEntries(buf) {
  const out = []
  let pos = 0
  let total = 0
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
    let data
    try {
      data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw)
    } catch {
      pos = dataStart + compressedSize
      continue
    }
    if (data.length > MAX_ENTRY_BYTES) throw new Error('压缩包条目过大（疑似 zip bomb），已拒绝处理')
    total += data.length
    if (total > MAX_TOTAL_BYTES) throw new Error('压缩包解包后总大小超限（疑似 zip bomb），已拒绝处理')
    if (out.length >= MAX_ENTRIES) throw new Error('压缩包条目数超限，已拒绝处理')
    out.push({ name, method, data })
    pos = dataStart + compressedSize
  }
  return out
}

/**
 * 写 zip：按给定条目顺序与压缩方式打包。
 * @param {Array<{name: string, method: number, data: Buffer}>} entries 条目。
 * @returns {Buffer} zip 字节。
 */
export function writeZipEntries(entries) {
  const localChunks = []
  const centralChunks = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const raw = entry.data
    const store = entry.method !== 8
    const payload = store ? raw : deflateRawSync(raw, { level: 6 })
    const crc = crc32(raw)

    const lfh = Buffer.alloc(30)
    lfh.writeUInt32LE(0x04034b50, 0)
    lfh.writeUInt16LE(20, 4)          // version needed
    lfh.writeUInt16LE(0, 6)           // flags
    lfh.writeUInt16LE(store ? 0 : 8, 8) // method
    lfh.writeUInt16LE(0, 10)          // mod time
    lfh.writeUInt16LE(0x21, 12)       // mod date（固定值：1980-01-01，避免每次打包字节不同）
    lfh.writeUInt32LE(crc, 14)
    lfh.writeUInt32LE(payload.length, 18)
    lfh.writeUInt32LE(raw.length, 22)
    lfh.writeUInt16LE(nameBuf.length, 26)
    lfh.writeUInt16LE(0, 28)
    localChunks.push(lfh, nameBuf, payload)

    const cdh = Buffer.alloc(46)
    cdh.writeUInt32LE(0x02014b50, 0)
    cdh.writeUInt16LE(20, 4)          // version made by
    cdh.writeUInt16LE(20, 6)          // version needed
    cdh.writeUInt16LE(0, 8)           // flags
    cdh.writeUInt16LE(store ? 0 : 8, 10) // method
    cdh.writeUInt16LE(0, 12)
    cdh.writeUInt16LE(0x21, 14)
    cdh.writeUInt32LE(crc, 16)
    cdh.writeUInt32LE(payload.length, 20)
    cdh.writeUInt32LE(raw.length, 24)
    cdh.writeUInt16LE(nameBuf.length, 28)
    cdh.writeUInt16LE(0, 30)          // extra len
    cdh.writeUInt16LE(0, 32)          // comment len
    cdh.writeUInt16LE(0, 34)          // disk number
    cdh.writeUInt16LE(0, 36)          // internal attrs
    cdh.writeUInt32LE(0, 38)          // external attrs
    cdh.writeUInt32LE(offset, 42)
    centralChunks.push(cdh, nameBuf)

    offset += lfh.length + nameBuf.length + payload.length
  }

  const central = Buffer.concat(centralChunks)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localChunks, central, eocd])
}

/**
 * 判定一个部件是否该做占位符替换。
 * 保守策略：只处理明确的正文 XML 部件，不碰样式/主题/关系/内容类型。
 * @param {string} name 部件名。
 * @param {string[]} prefixes 该格式的正文前缀。
 * @returns {boolean} 是否处理。
 */
function isBodyXml(name, prefixes) {
  if (!name.endsWith('.xml')) return false
  if (!prefixes.some((p) => name.startsWith(p))) return false
  // 明确排除的非正文部件
  if (name.includes('/_rels/')) return false
  if (name.endsWith('.rels')) return false
  if (name.includes('/theme/')) return false
  if (name.includes('/styles')) return false
  if (name.includes('stylesWithEffects')) return false
  if (name.includes('/settings')) return false
  if (name.includes('/fontTable')) return false
  if (name.includes('/numbering')) return false
  if (name.includes('/webSettings')) return false
  if (name.includes('/presProps')) return false
  if (name.includes('/viewProps')) return false
  if (name.includes('/tableStyles')) return false
  if (name.includes('/core.xml') || name.includes('/app.xml')) return false
  return true
}

/**
 * 判断 XML 中某个位置是否在标签内部（`<` 与 `>` 之间）。
 * 标签内部的占位符不是文本，不能替换（替换会破坏标签名）。
 * @param {string} xml XML。
 * @param {number} pos 位置。
 * @returns {boolean} 是否在标签内。
 */
function isInsideTag(xml, pos) {
  const lt = xml.lastIndexOf('<', pos - 1)
  if (lt < 0) return false
  // '<" 之后若不是 '?' '!' '/'，说明是标签开始；找它对应的 '>'
  const next = xml[lt + 1]
  if (next === '?' || next === '!') return true
  const gt = xml.indexOf('>', lt)
  if (gt < 0) return false
  return pos < gt
}

/**
 * 在一个 XML 部件里做占位符替换（只动文本，不碰标签）。
 *
 * 关键点：**不能**用「切分文本节点再替换」的思路——占位符本身含 `<` `>`，
 * 在 XML 里要么是裸形式（非法但工具可能产出），要么是实体形式 &lt;…&gt;（OOXML 真实形态）。
 * 裸形式会让标签切分错位（把 <EMAIL_xxx> 当成标签），所以这里改为：
 * 在原文上定位占位符 → 逐个判断是否在标签内部 → 在标签外才替换。
 *
 * 替换时输出实体编码的真值（真值可能含 & < > " '，必须转义）。
 *
 * @param {string} xml 原始 XML。
 * @param {(ph: string) => string|undefined} lookup 查表。
 * @returns {{xml: string, restored: number, unresolved: number}} 结果。
 */
function replaceInXml(xml, lookup) {
  let restored = 0
  let unresolved = 0

  // 统一处理四种形态：实体精确 / 实体宽松 / 裸精确 / 裸宽松
  const candidates = []
  for (const m of xml.matchAll(RE_PLACEHOLDER_ESC)) {
    candidates.push({ start: m.index, end: m.index + m[0].length, ph: '<' + m[1] + '_' + m[2] + '>', raw: m[0], escaped: true })
  }
  for (const m of xml.matchAll(RE_PLACEHOLDER_ESC_LOOSE)) {
    const ph = '<' + m[1] + '_' + m[2] + '>'
    if (candidates.some((c) => c.start === m.index)) continue
    candidates.push({ start: m.index, end: m.index + m[0].length, ph, raw: m[0], escaped: true, loose: true })
  }
  for (const m of xml.matchAll(RE_PLACEHOLDER)) {
    // 跳过已被实体形态覆盖的位置
    if (candidates.some((c) => m.index >= c.start && m.index < c.end)) continue
    candidates.push({ start: m.index, end: m.index + m[0].length, ph: m[0], raw: m[0], escaped: false })
  }
  for (const m of xml.matchAll(RE_PLACEHOLDER_LOOSE)) {
    if (candidates.some((c) => m.index >= c.start && m.index < c.end)) continue
    candidates.push({ start: m.index, end: m.index + m[0].length, ph: m[0], raw: m[0], escaped: false, loose: true })
  }

  if (candidates.length === 0) return { xml, restored: 0, unresolved: 0 }

  // 位置升序，去重叠
  candidates.sort((a, b) => a.start - b.start)
  const chosen = []
  let cursor = -1
  for (const c of candidates) {
    if (c.start < cursor) continue
    chosen.push(c)
    cursor = c.end
  }

  // 逐个查表 + 判定是否在标签内
  const pieces = []
  let last = 0
  for (const c of chosen) {
    let value = lookup(c.ph)
    if (value === undefined && c.loose) {
      // 宽松形态：归一化后重试（<phone_1a2b3c4d> → <PHONE_1a2b3c4d>）
      const m = /^<([A-Za-z][A-Za-z0-9]{0,15})[\s\-_]([0-9a-fA-F]{8})>$/.exec(c.ph)
      if (m !== null) value = lookup('<' + m[1].toUpperCase() + '_' + m[2].toLowerCase() + '>')
    }
    if (value === undefined) {
      unresolved += 1
      continue
    }
    // 标签内部的占位符不动（会破坏标签名）
    if (isInsideTag(xml, c.start)) continue
    pieces.push({ start: c.start, end: c.end, replacement: encodeXmlEntities(value) })
    restored += 1
  }

  if (pieces.length === 0) return { xml, restored: 0, unresolved }

  // 拼接输出
  let out = ''
  let pos = 0
  for (const p of pieces) {
    out += xml.slice(pos, p.start) + p.replacement
    pos = p.end
  }
  out += xml.slice(pos)

  return { xml: out, restored, unresolved }
}

/**
 * 对 office 文档做占位符还原。
 * @param {Buffer} buf 原始文件字节。
 * @param {string} ext 扩展名（小写，不含点）。
 * @param {(ph: string) => string|undefined} lookup 查表。
 * @returns {{ok: boolean, output: Buffer, restored: number, unresolved: number, parts: number, reason?: string}} 结果。
 */
export function restoreOfficeDocument(buf, ext, lookup) {
  const kind = OFFICE_KINDS[ext]
  if (kind === undefined) {
    return { ok: false, output: buf, restored: 0, unresolved: 0, parts: 0, reason: 'unsupported_extension' }
  }

  let entries
  try {
    entries = readZipEntries(buf)
  } catch (err) {
    return { ok: false, output: buf, restored: 0, unresolved: 0, parts: 0, reason: String(err.message ?? err) }
  }
  if (entries.length === 0) {
    return { ok: false, output: buf, restored: 0, unresolved: 0, parts: 0, reason: '不是有效的 zip 容器（OOXML 损坏）' }
  }

  let restored = 0
  let unresolved = 0
  let parts = 0
  const outEntries = entries.map((entry) => {
    if (!isBodyXml(entry.name, kind.xmlPrefixes)) return entry
    const text = entry.data.toString('utf8')
    if (!text.includes('<')) return entry
    const r = replaceInXml(text, lookup)
    if (r.restored === 0 && r.unresolved === 0) return entry
    restored += r.restored
    unresolved += r.unresolved
    parts += 1
    return { name: entry.name, method: entry.method, data: Buffer.from(r.xml, 'utf8') }
  })

  if (restored === 0) {
    return { ok: false, output: buf, restored: 0, unresolved, parts, reason: '文档里没有可还原的占位符' }
  }

  let output
  try {
    output = writeZipEntries(outEntries)
  } catch (err) {
    return { ok: false, output: buf, restored: 0, unresolved, parts, reason: '重新打包失败: ' + String(err.message ?? err) }
  }

  return { ok: true, output, restored, unresolved, parts }
}

/** 该扩展名是否是受支持的 office 格式。 */
export function isOfficeExtension(ext) {
  return Object.prototype.hasOwnProperty.call(OFFICE_KINDS, String(ext ?? '').toLowerCase())
}

/** 该扩展名对应的中文标签。 */
export function officeLabel(ext) {
  return OFFICE_KINDS[String(ext ?? '').toLowerCase()]?.label ?? String(ext ?? '')
}
