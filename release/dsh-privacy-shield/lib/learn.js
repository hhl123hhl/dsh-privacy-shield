// lib/learn.js — 从本地会话历史学习候选专名（零依赖）。
//
// 思路：扫描本地会话日志（user 消息的明文就在本地），统计"高频出现但引擎命不中"的
// 中文/字母数字片段，推荐进词表候选池。全程本地，不发出任何数据。
//
// 诚实边界：这是启发式召回，不是识别——推荐结果必须人工确认后才入词表（/shield terms adopt）。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { extractSuffixCandidates } from './scan-doc.js'
import { collectNameCandidates, mergeCandidateInto } from './name-candidates.js'

/** 扫描的会话文件数上限（按修改时间取最新）。 */
const MAX_FILES = 30
/** 单文件读取上限。 */
const MAX_BYTES = 8 * 1024 * 1024
/** 片段最短/最长。 */
const MIN_LEN = 2
const MAX_LEN = 16
/** 出现频次阈值。 */
const MIN_COUNT = 3

/** zstd magic（小端）。 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 常见停用片段：几乎不构成专名的短词（降低噪音，宁缺毋滥）。 */
const STOPWORDS = new Set([
  '我们', '你们', '他们', '这个', '那个', '什么', '怎么', '这样', '那样', '已经',
  '现在', '可以', '可能', '因为', '所以', '但是', '然后', '如果', '就是', '不是',
  '没有', '一个', '一些', '如下', '所示', '如下所', '请帮', '帮我', '一下', '谢谢',
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'file', 'path', 'true', 'false',
])

/**
 * 会话目录：$DSH_HOME/sessions（rulesRoot 的上一级就是 DSH_HOME）。
 * @param {Record<string, string|undefined>} [env] 环境变量。
 * @returns {string} 目录。
 */
export function sessionsDir(env = process.env) {
  const home = typeof env?.DSH_HOME === 'string' && env.DSH_HOME !== '' ? env.DSH_HOME : join(process.env.USERPROFILE ?? '', '.dsh')
  return join(home, 'sessions')
}

/**
 * 解码 zstd 帧串联文件（每帧独立解压拼接）。
 * 宿主 node 无 zstd 支持时返回 null（调用方降级）。
 */
function decodeZstdFrames(buf) {
  try {
    if (typeof zstdDecompressSync !== 'function') return null
    const chunks = []
    let pos = 0
    while (pos + 4 <= buf.length) {
      let magic = -1
      for (let i = pos; i + 4 <= buf.length; i++) {
        if (buf[i] === ZSTD_MAGIC[0] && buf[i + 1] === ZSTD_MAGIC[1]
          && buf[i + 2] === ZSTD_MAGIC[2] && buf[i + 3] === ZSTD_MAGIC[3]) { magic = i; break }
      }
      if (magic < 0) break
      try {
        chunks.push(zstdDecompressSync(buf.subarray(magic)))
        pos = magic + 4
      } catch {
        pos = magic + 4
      }
    }
    return chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : ''
  } catch {
    return null
  }
}

/** 递归收集会话文件（*.jsonl.zstd），按修改时间倒序。 */
function collectSessionFiles(dir, limit) {
  const out = []
  const walk = (current, depth) => {
    if (depth > 3) return
    let entries = []
    try { entries = readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.name.endsWith('.jsonl.zstd')) {
        try { out.push({ path: full, mtime: statSync(full).mtimeMs }) } catch { /* 忽略 */ }
      }
    }
  }
  walk(dir, 0)
  out.sort((a, b) => b.mtime - a.mtime)
  return out.slice(0, limit).map((item) => item.path)
}

/** 从会话事件文本里抓 user 消息明文。 */
function extractUserTexts(eventsText) {
  const texts = []
  for (const line of eventsText.split('\n')) {
    if (!line.includes('"user/message"')) continue
    if (!line.includes('"append"')) continue
    try {
      const event = JSON.parse(line)
      const content = event?.data?.content ?? event?.message?.content ?? []
      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type === 'text' && typeof block.text === 'string') texts.push(block.text)
      }
    } catch { /* 跳过坏行 */ }
  }
  return texts
}

/** 候选片段切分：CJK/字母数字连续段。 */
const RE_SEGMENT = /[\u4e00-\u9fa5A-Za-z0-9]{2,16}/g

/**
 * 扫描会话历史，产出候选表（结构同 scan-doc，source 标注"会话学习"）。
 * @param {import('./engine.js').MaskEngine} engine 现用引擎。
 * @param {object} [options] 选项。
 * @param {Record<string, string|undefined>} [options.env] 环境变量。
 * @param {number} [options.maxCandidates] 返回上限。
 * @returns {{scanned: number, texts: number, candidates: Array<object>}} 结果。
 */
export function learnFromSessions(engine, options = {}) {
  const dir = sessionsDir(options.env)
  if (!existsSync(dir)) return { scanned: 0, texts: 0, candidates: [] }
  const files = collectSessionFiles(dir, MAX_FILES)

  const counts = new Map() // key -> {value,count}
  let texts = 0
  let scanned = 0
  for (const path of files) {
    let buf
    try {
      const size = statSync(path).size
      if (size > MAX_BYTES) continue
      buf = readFileSync(path)
    } catch { continue }
    const text = decodeZstdFrames(buf)
    if (text === null) return { scanned, texts, candidates: [], degraded: '宿主 node 无 zstd 支持，无法读取会话日志' }
    scanned += 1
    const covered = new Set()
    const userTexts = extractUserTexts(text)
    for (const userText of userTexts) {
      texts += 1
      if (userText.length <= 2_000_000 && engine !== undefined && engine !== null) {
        for (const hit of engine.detect(userText)) covered.add(hit.value.normalize('NFKC').toLowerCase())
      }
      RE_SEGMENT.lastIndex = 0
      for (const match of userText.matchAll(RE_SEGMENT)) {
        const value = match[0]
        const key = value.normalize('NFKC').toLowerCase()
        if (covered.has(key) || STOPWORDS.has(key)) continue
        const existing = counts.get(key)
        if (existing !== undefined) existing.count += 1
        else counts.set(key, { value, count: 1 })
      }
      // 后缀词典扫描：整段正则切分抓不到的"昆仑数据库"这类专名。
      for (const { value } of extractSuffixCandidates(userText)) {
        const key = value.normalize('NFKC').toLowerCase()
        if (covered.has(key) || STOPWORDS.has(key)) continue
        const existing = counts.get(key)
        if (existing !== undefined) existing.count += 1
        else counts.set(key, { value, count: 1 })
      }
      // 多路召回（第 2 轮）：列语义 / 上下文同现 / 引号包裹 / 期次后缀 / 高频片段。
      // 会话里天然有用户贴的表与合同片段，这几路能把"无引导词项目名"捞出来。
      for (const item of collectNameCandidates(userText, { engine, minCount: 1, maxCandidates: 400 })) {
        const key = item.value.normalize('NFKC').toLowerCase()
        if (covered.has(key) || STOPWORDS.has(key)) continue
        mergeCandidateInto(counts, item)
      }
    }
  }

  const candidates = [...counts.values()]
    .filter((item) => item.count >= MIN_COUNT && item.value.length >= MIN_LEN && item.value.length <= MAX_LEN)
    .sort((a, b) => b.count - a.count || b.value.length - a.value.length)
    .slice(0, options.maxCandidates ?? 100)
    .map((item) => ({ ...item, label: item.label ?? 'TERM', source: item.source ?? '会话学习' }))
  return { scanned, texts, candidates }
}
