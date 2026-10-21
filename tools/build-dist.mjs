// tools/build-dist.mjs — 产出可分发目录 release/dsh-privacy-shield/ 以及 .zip / .tgz（零依赖，纯 Node）。
//
// 用法：node tools/build-dist.mjs
// 产物：
//   release/dsh-privacy-shield/            可直接 install_bundle 的目录
//   release/dsh-privacy-shield-<version>.zip
//   release/dsh-privacy-shield-<version>.tgz
//
// 打包白名单见下方 INCLUDE；release/ 自身绝不进入产物。zip 用 store（不压缩，纯文本包体积无关痛痒），
// tar.gz 走 zlib。两个归档都不依赖外部命令，Windows / Linux / macOS 均可直接运行。

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { basename, dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(ROOT, 'release')
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const VERSION = PACKAGE.version ?? '0.0.0'
const DIR_NAME = `dsh-privacy-shield`
const DIR = join(OUT, DIR_NAME)

/** 进入分发包的文件与目录（相对 ROOT）。 */
const INCLUDE = [
  'index.js',
  'client.js',
  'package.json',
  'cordis.patch.yml',
  'icon.svg',
  'LICENSE',
  'README.md',
  'README.zh.md',
  'lib',
  'locale',
  'tools',
  'docs',
  'test',
]

// ---------- 1. 组装可分发目录 ----------

rmSync(OUT, { recursive: true, force: true })
mkdirSync(DIR, { recursive: true })

/** 收集目录下全部文件（相对 ROOT 的 posix 风格路径）。 */
function collectFiles(target, prefix, into) {
  const stat = statSync(target)
  if (stat.isDirectory()) {
    for (const entry of readdirSync(target)) {
      collectFiles(join(target, entry), `${prefix}/${entry}`, into)
    }
  } else {
    into.push(prefix.slice(1))
  }
}

const files = []
for (const item of INCLUDE) {
  const target = join(ROOT, item)
  try {
    statSync(target)
  } catch {
    console.warn(`警告：白名单里的 ${item} 不存在，已跳过`)
    continue
  }
  cpSync(target, join(DIR, item), { recursive: true })
  collectFiles(target, `/${item}`, files)
}
files.sort()
console.log(`已组装 ${DIR}（${files.length} 个文件）`)

// ---------- 2. ZIP（store 方法，自算 CRC-32） ----------

/** CRC-32 表（IEEE 802.3，多项式 0xEDB88320）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** DOS 时间戳（本地时间，zip 的最低公分母格式）。 */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear())
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { dosTime, dosDate }
}

function buildZip(entries) {
  const chunks = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const data = entry.data
    const crc = crc32(data)
    const { dosTime, dosDate } = dosDateTime(entry.mtime)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4)         // version needed
    local.writeUInt16LE(0x0800, 6)     // flags: UTF-8 names
    local.writeUInt16LE(0, 8)          // method: store
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)         // extra length
    chunks.push(local, nameBuf, data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)    // central directory signature
    cd.writeUInt16LE(20, 4)            // version made by
    cd.writeUInt16LE(20, 6)            // version needed
    cd.writeUInt16LE(0x0800, 8)        // flags: UTF-8 names
    cd.writeUInt16LE(0, 10)            // method: store
    cd.writeUInt16LE(dosTime, 12)
    cd.writeUInt16LE(dosDate, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(0, 30)            // extra + comment length
    cd.writeUInt16LE(0, 34)            // disk number
    cd.writeUInt16LE(0, 36)            // internal attrs
    cd.writeUInt32LE(0, 38)            // external attrs
    cd.writeUInt32LE(offset, 42)       // local header offset
    central.push(Buffer.concat([cd, nameBuf]))
    offset += 30 + nameBuf.length + data.length
  }
  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, centralBuf, end])
}

// ---------- 3. TAR.GZ（ustar） ----------

function tarHeader(name, size, mtime, isDir) {
  const header = Buffer.alloc(512)
  const nameBuf = Buffer.from(name, 'utf8')
  // 长名字走 prefix 拆分（ustar），超过 100+155 的直接报错。
  if (nameBuf.length <= 100) {
    nameBuf.copy(header, 0)
  } else {
    const parts = name.split('/')
    const base = parts.pop()
    const prefix = parts.join('/')
    if (Buffer.byteLength(base) > 100 || Buffer.byteLength(prefix) > 155) {
      throw new Error(`tar 路径过长：${name}`)
    }
    header.write(base, 0)
    header.write(prefix, 345)
  }
  header.write(isDir ? '0000755' : '0000644', 100, 8)
  header.write('0000000', 108, 8)   // uid
  header.write('0000000', 116, 8)   // gid
  header.write(size.toString(8).padStart(11, '0'), 124, 12)
  header.write(mtime.toString(8).padStart(11, '0'), 136, 12)
  header.write('        ', 148, 8)  // checksum 占位（空格）
  header.write(isDir ? '5' : '0', 156)
  header.write('ustar', 257, 5)
  header.write('00', 263, 2)
  header.write('dsh-privacy-shield', 265, 32) // uname
  let sum = 0
  for (let i = 0; i < 512; i += 1) sum += header[i]
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return header
}

function buildTarGz(entries) {
  const chunks = []
  for (const entry of entries) {
    if (entry.isDir) {
      chunks.push(tarHeader(`${entry.name}/`, 0, entry.mtime, true))
      continue
    }
    chunks.push(tarHeader(entry.name, entry.data.length, entry.mtime, false), entry.data)
    const pad = (512 - (entry.data.length % 512)) % 512
    if (pad > 0) chunks.push(Buffer.alloc(pad))
  }
  chunks.push(Buffer.alloc(1024)) // 结束块
  return gzipSync(Buffer.concat(chunks), { level: 9 })
}

// ---------- 4. 产出归档 ----------
//
// 两种归档根目录不同，用途也不同：
//   .zip  → 根目录 dsh-privacy-shield/：人工解压后把该目录给 install_bundle（target=绝对路径）；
//   .tgz  → 根目录 package/：npm pack 约定，可直接被 pnpm/npm 以「tarball URL」安装
//           （DSH 插件页「安装」/ plugin_manager 的 target 支持 tarball URL）。

const zipEntries = []
const tarEntries = []
for (const file of files) {
  const full = join(DIR, file)
  const stat = statSync(full)
  const data = readFileSync(full)
  const posix = file.split(sep).join('/')
  zipEntries.push({ name: `${DIR_NAME}/${posix}`, data, mtime: stat.mtime })
  tarEntries.push({ name: `package/${posix}`, data, mtime: Math.floor(stat.mtimeMs / 1000), isDir: false })
}

const zipPath = join(OUT, `dsh-privacy-shield-${VERSION}.zip`)
const tgzPath = join(OUT, `dsh-privacy-shield-${VERSION}.tgz`)
writeFileSync(zipPath, buildZip(zipEntries))
writeFileSync(tgzPath, buildTarGz(tarEntries))

for (const path of [zipPath, tgzPath]) {
  const sha = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
  console.log(`${basename(path)}  ${(statSync(path).size / 1024).toFixed(1)} KiB  sha256:${sha}`)
}
console.log('完成。分发：发送 .zip 或 .tgz，对方解压后 install_bundle 指向解压出的 dsh-privacy-shield 目录。')
