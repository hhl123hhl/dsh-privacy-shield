// test/locale-sync.test.mjs — locale 单一来源一致性。
//
// 0.3.3 起文案/实体名/敏感度/覆盖面只在 locale/{zh,en}.json 维护，
// client.js 的生成区块由 tools/sync-client.mjs 产出。本测试保证：
//   1) client.js 的生成区块与 locale/package.json 完全同步（防止手改 client.js 漂移）；
//   2) 中英两套 key 集合一致（防止漏翻）；
//   3) 实体名表覆盖 lib/constants.js 的全部实体 id。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { buildGeneratedBlock, readGeneratedBlock, syncSource } from '../tools/sync-client.mjs'
import { ENTITY_LABELS } from '../lib/constants.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(HERE, '..', rel), 'utf8')
const zh = JSON.parse(read('locale/zh.json'))
const en = JSON.parse(read('locale/en.json'))
const client = read('client.js')

test('client.js 生成区块与 locale/package.json 同步', () => {
  const existing = readGeneratedBlock(client)
  assert.ok(existing !== null, '找不到 @@GENERATED:SHIELD-UI 标记区块')
  assert.equal(existing, buildGeneratedBlock(), '生成区块已漂移：请运行 node tools/sync-client.mjs')
  assert.equal(syncSource(client).migrated, false, '标记区块缺失，仍处于旧的内联文案结构')
})

test('中英文案 key 集合一致（防止漏翻）', () => {
  assert.deepEqual(Object.keys(en.status).sort(), Object.keys(zh.status).sort())
  for (const section of ['entities', 'sensitivity', 'surfaces', 'termLabels', 'candidateSources']) {
    assert.deepEqual(Object.keys(en[section]).sort(), Object.keys(zh[section]).sort(), section + ' 中英 key 不一致')
  }
})

test('实体名表覆盖全部实体 id；新增 UI 文案齐全', () => {
  const ids = Object.keys(ENTITY_LABELS).sort()
  assert.deepEqual(Object.keys(zh.entities).sort(), ids)
  assert.deepEqual(Object.keys(en.entities).sort(), ids)
  const keys = [
    'settingsSearch', 'settingsSelected', 'settingsVersion', 'settingsDiag', 'settingsDiagHint',
    'versionMismatch', 'termsCategory', 'termsHits', 'termsSortHint', 'termsNoHits',
    'testReveal', 'testRevealHint', 'testPairsTitle',
  ]
  for (const key of keys) {
    assert.ok(typeof zh.status[key] === 'string' && zh.status[key] !== '', 'zh 缺文案 ' + key)
    assert.ok(typeof en.status[key] === 'string' && en.status[key] !== '', 'en 缺文案 ' + key)
  }
})
