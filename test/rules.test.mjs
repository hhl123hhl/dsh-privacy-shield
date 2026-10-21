// test/rules.test.mjs — 规则包（导出/导入/校验）与词表文件读写的单元测试（node --test）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MAX_PACK_BYTES,
  appendJsonLine,
  buildRulesPack,
  canonicalTermLine,
  defaultRulesPath,
  mergeTermLines,
  parseRulesPackText,
  parseTermsFileText,
  readTextFile,
  resolveRulesPath,
  rulesRoot,
  serializeRulesPack,
  validateRulesPack,
  writeTextFile,
} from '../lib/rules.js'

/** 隔离的临时目录（文件类测试用）。 */
const TMP = mkdtempSync(join(tmpdir(), 'dsh-privacy-shield-rules-'))
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }) } catch { /* 清理失败无碍 */ } })

// ---------- 路径解析 ----------

test('rulesRoot：优先 DSH_HOME，否则退到 ~/.dsh/shield', () => {
  assert.equal(rulesRoot({ DSH_HOME: 'D:\\dsh-home' }), join('D:\\dsh-home', 'shield'))
  assert.equal(rulesRoot({}), join(homedir(), '.dsh', 'shield'))
})

test('resolveRulesPath：绝对路径原样，相对路径落到规则目录，引号被剥掉', () => {
  assert.equal(resolveRulesPath('D:/tmp/pack.json'), 'D:\\tmp\\pack.json')
  assert.equal(resolveRulesPath('pack.json', { DSH_HOME: 'D:\\dsh-home' }), join('D:\\dsh-home', 'shield', 'pack.json'))
  assert.equal(resolveRulesPath('"pack.json"', { DSH_HOME: 'D:\\dsh-home' }), join('D:\\dsh-home', 'shield', 'pack.json'))
  assert.equal(resolveRulesPath('  ', { DSH_HOME: 'D:\\dsh-home' }), null)
  assert.equal(resolveRulesPath(null, { DSH_HOME: 'D:\\dsh-home' }), null)
})

test('defaultRulesPath：生成 shield-rules-<时间戳>.json 且落在规则目录', () => {
  const path = defaultRulesPath({ DSH_HOME: 'D:\\dsh-home' }, new Date('2026-10-13T08:09:10.000Z'))
  assert.ok(path.startsWith(join('D:\\dsh-home', 'shield', 'shield-rules-2026-10-13T08-09-10')))
  assert.ok(path.endsWith('.json'))
})

// ---------- 规则包组装与序列化 ----------

test('canonicalTermLine：字符串与对象条目都规范成 "值 @分类"', () => {
  assert.equal(canonicalTermLine('甲公司 @company'), '甲公司 @company')
  assert.equal(canonicalTermLine('甲公司'), '甲公司')
  assert.equal(canonicalTermLine({ value: '乙公司', category: 'org' }), '乙公司 @org')
  assert.equal(canonicalTermLine({ value: '丙公司', label: 'ORG' }), '丙公司 @ORG')
  assert.equal(canonicalTermLine(42), '')
})

test('buildRulesPack：schema 固定、未知实体被丢弃、notes 截断、条目规范化', () => {
  const pack = buildRulesPack({
    version: '0.2.0',
    entities: ['phone-cn', 'not-an-entity', 'email'],
    terms: ['甲公司 @company', { value: '乙系统', category: 'system' }, ''],
    notes: 'x'.repeat(2100),
  })
  assert.equal(pack.schema, 'dsh-shield.rules/v1')
  assert.deepEqual(pack.entities, ['phone-cn', 'email'])
  assert.deepEqual(pack.terms, ['甲公司 @company', '乙系统 @system'])
  assert.equal(pack.notes.length, 2000)
  assert.equal(pack.plugin.name, 'dsh-privacy-shield')
  assert.equal(pack.plugin.version, '0.2.0')
})

test('导出→序列化→解析 完整往返后词表与实体不变', () => {
  const original = buildRulesPack({
    version: '0.2.0',
    entities: ['phone-cn', 'cn-org'],
    terms: ['甲公司 @company', 'HT-2024-001 @id'],
  })
  const { pack, warnings } = parseRulesPackText(serializeRulesPack(original))
  assert.deepEqual(warnings, [])
  assert.deepEqual(pack.entities, ['phone-cn', 'cn-org'])
  assert.deepEqual(pack.terms, ['甲公司 @company', 'HT-2024-001 @id'])
})

// ---------- 校验与拒绝 ----------

test('validateRulesPack：出现 vault/values/secrets 字段直接拒绝（防误传还原表）', () => {
  for (const key of ['vault', 'values', 'secrets']) {
    const result = validateRulesPack({ schema: 'dsh-shield.rules/v1', [key]: {} })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((line) => line.includes(key)))
  }
})

test('validateRulesPack：schema 不符拒绝；非字符串/未知实体只告警不拒绝', () => {
  const bad = validateRulesPack({ schema: 'wrong' })
  assert.equal(bad.ok, false)

  const messy = validateRulesPack({
    schema: 'dsh-shield.rules/v1',
    entities: ['phone-cn', 7, 'unknown-entity', 'phone-cn'],
    terms: ['甲公司 @company', 42, '   '],
  })
  assert.equal(messy.ok, true)
  assert.deepEqual(messy.pack.entities, ['phone-cn'])
  assert.deepEqual(messy.pack.terms, ['甲公司 @company'])
  assert.ok(messy.warnings.length >= 3)
})

test('parseRulesPackText：空内容/非 JSON/超大 分别抛出可读错误', () => {
  assert.throws(() => parseRulesPackText(''), /为空/u)
  assert.throws(() => parseRulesPackText('{not json'), /不是合法 JSON/u)
  const oversize = JSON.stringify({ schema: 'dsh-shield.rules/v1', terms: ['x'.repeat(MAX_PACK_BYTES)] })
  assert.throws(() => parseRulesPackText(oversize), /过大/u)
})

// ---------- 词表合并 ----------

test('mergeTermLines：归一化去重、保留既有顺序、统计 added/duplicates', () => {
  const { terms, added, duplicates } = mergeTermLines(
    ['甲公司 @company', '乙公司 @company'],
    ['甲公司 @org', '丙公司', '乙公司 @company', '  丁公司 @company  '],
  )
  assert.deepEqual(terms, ['甲公司 @company', '乙公司 @company', '丙公司 @TERM', '丁公司 @company'])
  assert.equal(added, 2)
  assert.equal(duplicates, 2)
})

test('mergeTermLines：英文大小写不敏感（归一化后判定同一词条）', () => {
  const { terms, duplicates } = mergeTermLines(['Apollo @project'], ['apollo @system'])
  assert.deepEqual(terms, ['Apollo @project'])
  assert.equal(duplicates, 1)
})

// ---------- 词表文件与规则包 IO ----------

test('parseTermsFileText：注释行与超长短行计入 skipped，空行被跳过', () => {
  const text = [
    '# 公司词表',
    '// 也可以这样注释',
    '',
    '甲公司 @company',
    '   ',
    'x'.repeat(201), // 超过单条 200 字符上限 → 解析为 null
    '乙公司 @company # 行尾注释',
  ].join('\n')
  const { terms, skipped } = parseTermsFileText(text)
  assert.deepEqual(terms, ['甲公司 @company', '乙公司 @company'])
  assert.equal(skipped, 3) // 两种注释各 1 行 + 超长行 1 行
})

test('writeTextFile/readTextFile：自动建目录、往返一致、读失败给可读错误', () => {
  const path = join(TMP, 'deep', 'dir', 'pack.json')
  writeTextFile(path, 'hello')
  assert.ok(existsSync(path))
  assert.equal(readTextFile(path), 'hello')
  assert.throws(() => readTextFile(join(TMP, 'missing.json')), /读取失败/u)
})

test('appendJsonLine：逐行追加 JSON；失败返回 false 而不抛出', () => {
  const path = join(TMP, 'audit', 'audit.jsonl')
  assert.equal(appendJsonLine(path, { a: 1 }), true)
  assert.equal(appendJsonLine(path, { b: 2 }), true)
  const lines = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(lines, [{ a: 1 }, { b: 2 }])

  // 父路径是一个已存在的文件 → 写入必须静默失败（返回 false）。
  const blocker = join(TMP, 'blocker')
  writeFileSync(blocker, 'occupied')
  assert.equal(appendJsonLine(join(blocker, 'x.jsonl'), { c: 3 }), false)
})
