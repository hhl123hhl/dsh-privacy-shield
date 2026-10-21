// tools/sync-client.mjs — 把 locale/*.json + lib/constants.js + package.json
// 生成到 client.js 的标记区块里（client.js 是纯浏览器文件，不能 import、也没有构建步骤，
// 所以用"生成 + 提交产物 + 一致性测试"的办法保证单一来源）。
//
// 用法：
//   node tools/sync-client.mjs            # 生成/刷新标记区块
//   node tools/sync-client.mjs --check    # 只校验是否已同步（测试与 CI 用）
//
// 标记区块：
//   /* @@GENERATED:SHIELD-UI:START@@ */ … /* @@GENERATED:SHIELD-UI:END@@ */
// 区块外的手写代码不要依赖"区块内变量很少"这个假设：区块会整体重写。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ENTITY_LABELS } from '../lib/constants.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT_PATH = join(ROOT, 'client.js')
const START = '/* @@GENERATED:SHIELD-UI:START@@ */'
const END = '/* @@GENERATED:SHIELD-UI:END@@ */'

/** 读一个 JSON 文件。 */
function readJson(relative) {
  return JSON.parse(readFileSync(join(ROOT, relative), 'utf8'))
}

/**
 * 把一个普通对象渲染成缩进友好的 JS 字面量。
 * @param {object} value 数据。
 * @param {number} indent 该值所在行的缩进宽度（闭合括号对齐到这一列）。
 * @returns {string} 多行字面量。
 */
function jsValue(value, indent) {
  const lines = JSON.stringify(value, null, 2).split('\n')
  const pad = ' '.repeat(indent)
  return lines.map((line, index) => {
    if (index === 0) return line
    return line.startsWith('}') ? ' '.repeat(indent) + line : pad + line
  }).join('\n')
}

/** 占位符标签 → 实体 id 的反查表（由协议表推出，不手写）。 */
function labelEntityTable() {
  const out = {}
  for (const [id, label] of Object.entries(ENTITY_LABELS)) out[label] = id
  return out
}

/**
 * 生成标记区块的完整文本（含两行标记）。
 * @returns {string} 带缩进的 JS 源码块。
 */
export function buildGeneratedBlock() {
  const zh = readJson('locale/zh.json')
  const en = readJson('locale/en.json')
  const version = readJson('package.json').version
  const at = (value) => jsValue(value, 6)

  return [
    `    ${START}`,
    '    // 本区块由 `node tools/sync-client.mjs` 从 locale/*.json + lib/constants.js + package.json 生成。',
    '    // 请勿手改：改文案改 locale/*.json，改协议标签改 lib/constants.js，改版本号改 package.json，然后重跑生成。',
    '',
    '    /** 编译期版本（= package.json version）：用于和 host status.version 比对，提示"需重启生效"。 */',
    `    const CLIENT_VERSION = ${JSON.stringify(version)};`,
    '',
    '    /** 文案表（与 locale/*.json 的 status 段同源；中文为默认语言）。 */',
    '    const COPY = {',
    `      zh: ${at(zh.status)},`,
    `      en: ${at(en.status)},`,
    '    };',
    '',
    '    /** 实体 id → 显示名（28 类）：只影响 UI 文案，协议 id 与占位符标签保持不变。 */',
    '    const ENTITY_NAMES = {',
    `      zh: ${at(zh.entities)},`,
    `      en: ${at(en.entities)},`,
    '    };',
    '',
    '    /** 实体敏感度分级 → 显示名。 */',
    '    const SENSITIVITY_NAMES = {',
    `      zh: ${at(zh.sensitivity)},`,
    `      en: ${at(en.sensitivity)},`,
    '    };',
    '',
    '    /** 覆盖面（脱敏分面）→ 显示名，key 与 host 侧 surfaces 配置一致。 */',
    '    const SURFACE_NAMES = {',
    `      zh: ${at(zh.surfaces)},`,
    `      en: ${at(en.surfaces)},`,
    '    };',
    '',
    '    /** 词表分类标签（ORG/PROJ/…）→ 显示名。 */',
    '    const TERM_LABELS = {',
    `      zh: ${at(zh.termLabels)},`,
    `      en: ${at(en.termLabels)},`,
    '    };',
    '',
    '    /** 候选来源（host 返回的中文键）→ 显示名；未知来源原样显示。 */',
    '    const CANDIDATE_SOURCE_NAMES = {',
    `      zh: ${at(zh.candidateSources)},`,
    `      en: ${at(en.candidateSources)},`,
    '    };',
    '',
    '    /** 占位符标签 → 实体 id（由 lib/constants.js 的 ENTITY_LABELS 反推）。 */',
    `    const LABEL_ENTITY = ${jsValue(labelEntityTable(), 4)};`,
    `    ${END}`,
  ].join('\n')
}

/** 取出 client.js 里现有的标记区块正文（含标记，含所在行缩进）。 */
export function readGeneratedBlock(source) {
  const startAt = source.indexOf(START)
  if (startAt === -1) return null
  const endAt = source.indexOf(END, startAt)
  if (endAt === -1) return null
  // 从标记所在行的行首开始取，保证与 buildGeneratedBlock() 的可比性（含 4 空格缩进）。
  const lineStart = source.lastIndexOf('\n', startAt - 1) + 1
  return source.slice(lineStart, endAt + END.length)
}

/**
 * 生成新的 client.js 文本：
 *   - 有标记 → 整体替换；
 *   - 没有标记（首次迁移）→ 把旧的内联文案/名称表整块换成标记区块。
 * @param {string} source 现有 client.js 文本。
 * @returns {{text: string, migrated: boolean}}
 */
export function syncSource(source) {
  const block = buildGeneratedBlock()
  const existing = readGeneratedBlock(source)
  if (existing !== null) {
    return { text: source.replace(existing, block), migrated: false }
  }
  // 首次迁移：从"文案表"注释到 LABEL_ENTITY 表的收尾 `};`。
  const startAnchor = '    /** 文案表（与 locale/*.json 同源；中文为默认语言）。 */'
  const labelAnchor = '    const LABEL_ENTITY = {'
  const startAt = source.indexOf(startAnchor)
  const labelAt = source.indexOf(labelAnchor)
  if (startAt === -1 || labelAt === -1 || labelAt < startAt) {
    throw new Error('client.js 里找不到可迁移的内联文案区块（标记与锚点都缺失）')
  }
  const closeAt = source.indexOf('    };\n', labelAt)
  if (closeAt === -1) throw new Error('LABEL_ENTITY 表没有正常收尾')
  const endAt = closeAt + '    };\n'.length
  const text = source.slice(0, startAt) + block + '\n' + source.slice(endAt)
  return { text, migrated: true }
}

/** 直接对 client.js 跑一次同步（供 CLI 用）。 */
function main() {
  const check = process.argv.includes('--check')
  const source = readFileSync(CLIENT_PATH, 'utf8')
  const { text, migrated } = syncSource(source)
  if (text === source) {
    console.log('[sync-client] 已是最新，无需改动')
    return 0
  }
  if (check) {
    console.log('[sync-client] client.js 与 locale/package 不同步：请运行 node tools/sync-client.mjs')
    return 1
  }
  writeFileSync(CLIENT_PATH, text)
  console.log('[sync-client] 已写入 client.js' + (migrated ? '（首次迁移标记区块）' : ''))
  return 0
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main()
}
