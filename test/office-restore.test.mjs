// test/office-restore.test.mjs — office 文档（docx/xlsx/pptx）占位符还原回归。
//
// 背景：护盾的承诺是「模型只见占位符、落盘是真人」。原先还原只支持纯文本，
// agent 生成的 report.docx / table.xlsx 若带占位符就无法还原 —— 承诺断在最后一环。
// 这里把 office 三件套的还原行为、XML 安全边界、失败处理全部锁死。
import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { restoreOfficeDocument, readZipEntries, writeZipEntries, isOfficeExtension, officeLabel } from '../lib/office-restore.js'
import { extractText } from '../lib/scan-doc.js'

const here = dirname(fileURLToPath(import.meta.url))
const TMP = join(here, '..', 'state', 'test-office')

const PHONE = '<PHONE_1a2b3c4d>'
const EMAIL = '<EMAIL_5e6f7a8b>'
const NAME = '<PERSON_00ff11aa>'
// OOXML 里的真实形态：占位符含 < >，在 XML 里必须编码成实体
const PHONE_ESC = '&lt;PHONE_1a2b3c4d&gt;'
const EMAIL_ESC = '&lt;EMAIL_5e6f7a8b&gt;'
const NAME_ESC = '&lt;PERSON_00ff11aa&gt;'

const TRUTH = {
  [PHONE]: '13800138000',
  [EMAIL]: 'zhangwei@acme.com',
  [NAME]: '张伟',
}
const lookup = (ph) => TRUTH[ph]

/** 造一个 zip（method 8 = deflate，真实 Office 产物即此压缩方式）。 */
function makeZip(files, method = 8) {
  const chunks = []
  const central = []
  let offset = 0
  for (const [name, data] of Object.entries(files)) {
    const nb = Buffer.from(name, 'utf8')
    const raw = Buffer.from(data, 'utf8')
    const payload = method === 8 ? deflateRawSync(raw) : raw
    const lfh = Buffer.alloc(30)
    lfh.writeUInt32LE(0x04034b50, 0)
    lfh.writeUInt16LE(20, 4)
    lfh.writeUInt16LE(method, 8)
    lfh.writeUInt32LE(payload.length, 18)
    lfh.writeUInt32LE(raw.length, 22)
    lfh.writeUInt16LE(nb.length, 26)
    chunks.push(lfh, nb, payload)
    const cdh = Buffer.alloc(46)
    cdh.writeUInt32LE(0x02014b50, 0)
    cdh.writeUInt16LE(20, 4)
    cdh.writeUInt16LE(20, 6)
    cdh.writeUInt16LE(method, 10)
    cdh.writeUInt32LE(payload.length, 20)
    cdh.writeUInt32LE(raw.length, 24)
    cdh.writeUInt16LE(nb.length, 28)
    cdh.writeUInt32LE(offset, 42)
    central.push(cdh, nb)
    offset += 30 + nb.length + payload.length
  }
  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(files).length, 8)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, cd, eocd])
}

test('docx：占位符还原为真值', () => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>客户${PHONE_ESC}，邮箱 ${EMAIL_ESC}</w:t></w:r></w:p></w:body></w:document>`
  const buf = makeZip({ 'word/document.xml': xml })
  const r = restoreOfficeDocument(buf, 'docx', lookup)
  assert.equal(r.ok, true)
  assert.equal(r.restored, 2)
  const doc = readZipEntries(r.output).find((e) => e.name === 'word/document.xml').data.toString('utf8')
  assert.ok(doc.includes('13800138000'))
  assert.ok(doc.includes('zhangwei@acme.com'))
  assert.ok(!doc.includes(PHONE_ESC))
  assert.ok(doc.includes('<w:document') && doc.includes('</w:document>'))
})

test('docx：非正文部件不被改动（二进制原样保留）', () => {
  const buf = makeZip({
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>${PHONE_ESC}</w:t></w:r></w:p></w:body></w:document>`,
    'word/styles.xml': `<?xml version="1.0"?><styles><w:style w:val="${PHONE}"/></styles>`,
    'word/media/image1.png': Buffer.from('89504e470d0a1a0a', 'hex'),
  })
  const r = restoreOfficeDocument(buf, 'docx', lookup)
  const entries = readZipEntries(r.output)
  assert.equal(entries.length, 3)
  assert.ok(entries.find((e) => e.name === 'word/styles.xml').data.toString('utf8').includes(PHONE))
  assert.equal(entries.find((e) => e.name === 'word/media/image1.png').data.toString('hex'), '89504e470d0a1a0a')
})

test('xlsx：共享字符串表还原', () => {
  const buf = makeZip({
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst count="2"><si><t>${NAME_ESC}</t></si><si><t>${PHONE_ESC}</t></si></sst>`,
    'xl/worksheets/sheet1.xml': '<?xml version="1.0"?><worksheet/>',
  })
  const r = restoreOfficeDocument(buf, 'xlsx', lookup)
  assert.equal(r.ok, true)
  assert.equal(r.restored, 2)
  const sst = readZipEntries(r.output).find((e) => e.name === 'xl/sharedStrings.xml').data.toString('utf8')
  assert.ok(sst.includes('张伟') && sst.includes('13800138000'))
})

test('pptx：幻灯片文本还原', () => {
  const buf = makeZip({
    'ppt/slides/slide1.xml': `<?xml version="1.0"?><p:sld xmlns:a="x"><a:t>${PHONE_ESC}</a:t><a:t>${NAME_ESC}</a:t></p:sld>`,
  })
  const r = restoreOfficeDocument(buf, 'pptx', lookup)
  assert.equal(r.ok, true)
  assert.equal(r.restored, 2)
  const slide = readZipEntries(r.output).find((e) => e.name === 'ppt/slides/slide1.xml').data.toString('utf8')
  assert.ok(slide.includes('13800138000') && slide.includes('张伟'))
})

test('XML 安全：真值里的 & < > 单双引号被转义，不破坏结构', () => {
  const TRICKY = '<EMAIL_aaaaaaaa>'
  const truth = { [TRICKY]: 'a&b<c>"d\'e' }
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>&lt;EMAIL_aaaaaaaa&gt;</w:t></w:r></w:p></w:body></w:document>`
  const buf = makeZip({ 'word/document.xml': xml })
  const r = restoreOfficeDocument(buf, 'docx', (ph) => truth[ph])
  assert.equal(r.ok, true)
  const doc = readZipEntries(r.output).find((e) => e.name === 'word/document.xml').data.toString('utf8')
  assert.ok(doc.includes('a&amp;b&lt;c&gt;&quot;d&apos;e'))
  assert.equal((doc.match(/<w:t>/g) ?? []).length, 1)
})

test('标签内的占位符不被替换（避免破坏标签名）', () => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p w:val="${PHONE}"/></w:body></w:document>`
  const buf = makeZip({ 'word/document.xml': xml })
  const r = restoreOfficeDocument(buf, 'docx', lookup)
  const doc = readZipEntries(r.output).find((e) => e.name === 'word/document.xml').data.toString('utf8')
  assert.ok(doc.includes(`w:val="${PHONE}"`))
})

test('宽松还原：小写占位符也能还原', () => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>&lt;phone_1a2b3c4d&gt;</w:t></w:r></w:p></w:body></w:document>`
  const buf = makeZip({ 'word/document.xml': xml })
  const r = restoreOfficeDocument(buf, 'docx', lookup)
  assert.equal(r.restored, 1)
})

test('失败处理：无占位符 / 非 zip / 扩展名不符 / 不支持扩展名', () => {
  const empty = makeZip({ 'word/document.xml': '<w:document xmlns:w="x"><w:body/></w:document>' })
  const r0 = restoreOfficeDocument(empty, 'docx', lookup)
  assert.equal(r0.ok, false)
  assert.equal(r0.reason, '文档里没有可还原的占位符')

  const r1 = restoreOfficeDocument(Buffer.from('not a zip at all'), 'docx', lookup)
  assert.equal(r1.ok, false)

  const r2 = restoreOfficeDocument(makeZip({ 'a.txt': 'x' }), 'xlsx', lookup)
  assert.equal(r2.ok, false)

  const r3 = restoreOfficeDocument(makeZip({ 'word/document.xml': '<w:t>x</w:t>' }), 'pdf', lookup)
  assert.equal(r3.ok, false)
  assert.equal(r3.reason, 'unsupported_extension')
})

test('store（无压缩）格式同样可处理', () => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>${PHONE_ESC}</w:t></w:r></w:p></w:body></w:document>`
  const buf = makeZip({ 'word/document.xml': xml }, 0)
  const r = restoreOfficeDocument(buf, 'docx', lookup)
  assert.equal(r.ok, true)
  assert.equal(r.restored, 1)
})

test('往返一致性：还原后的文档仍能被 scan 解析', () => {
  mkdirSync(TMP, { recursive: true })
  const out = join(TMP, 'roundtrip.docx')
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>客户${PHONE_ESC}</w:t></w:r></w:p></w:body></w:document>`
  const r = restoreOfficeDocument(makeZip({ 'word/document.xml': xml }), 'docx', lookup)
  writeFileSync(out, r.output)
  const text = extractText(out)
  assert.ok(text.includes('13800138000'))
  assert.ok(!text.includes('PHONE_1a2b3c4d'))
  rmSync(out, { force: true })
})

test('zip writer 往返：条目与内容保持一致', () => {
  const files = { 'a.txt': 'hello', 'b/c.txt': 'world' }
  const buf = makeZip(files, 8)
  const entries = readZipEntries(buf)
  assert.equal(entries.length, 2)
  assert.equal(entries.find((e) => e.name === 'b/c.txt').data.toString(), 'world')
  const again = readZipEntries(writeZipEntries(entries))
  assert.equal(again.length, 2)
  assert.equal(again.find((e) => e.name === 'a.txt').data.toString(), 'hello')
})

test('辅助函数：扩展名判定与标签', () => {
  assert.equal(isOfficeExtension('docx'), true)
  assert.equal(isOfficeExtension('XLSX'), true)
  assert.equal(isOfficeExtension('txt'), false)
  assert.equal(isOfficeExtension('pdf'), false)
  assert.ok(officeLabel('docx').includes('Word'))
})
