// test/stream-restore.test.mjs — 流式还原回归（2026-10-21 修复）
//
// 背景：push() 旧实现在"chunk 正好以 `<` 结尾"时立即放行，占位符被切成两半
// 后再也拼不回来（KTest 平台 P0 探针按多粒度切片复现）。改为纯长度扣留后，
// 这里把各粒度、边界切分、非占位符 `<` 全部锁死。
import test from 'node:test'
import assert from 'node:assert/strict'

import { StreamRestorer, Vault } from '../lib/vault.js'

const VALUE = '13800138000'
const PLACEHOLDER = '<PHONE_58a10cd8>'

function makeRestorer() {
  const vault = new Vault()
  vault.record(PLACEHOLDER, VALUE, 'PHONE')
  return new StreamRestorer({ lookup: (p) => vault.lookup(p) })
}

function feed(restorer, chunks) {
  const out = []
  for (const chunk of chunks) out.push(restorer.push(chunk))
  out.push(restorer.flush())
  return out.join('')
}

function chunkBy(text, size) {
  return text.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) || []
}

test('各粒度切片都能完整还原', () => {
  const text = `联系 ${PLACEHOLDER} 完毕，另一个 ${PLACEHOLDER} 收尾`
  for (const size of [1, 2, 3, 7, 16, 64]) {
    const restorer = makeRestorer()
    const out = feed(restorer, chunkBy(text, size))
    assert.equal(out, `联系 ${VALUE} 完毕，另一个 ${VALUE} 收尾`,
      `粒度 ${size} 还原失败：${out}`)
    assert.equal(restorer.stats.restored, 2, `粒度 ${size} 还原次数不对`)
  }
})

test('chunk 正好以 `<` 结尾时不漏放', () => {
  const restorer = makeRestorer()
  const out = feed(restorer, ['联系 ', '<', 'PHONE_58a', '10cd8>', ' 完毕'])
  assert.equal(out, `联系 ${VALUE} 完毕`)
  assert.equal(restorer.stats.restored, 1)
})

test('占位符被切在标签中间也能还原', () => {
  const restorer = makeRestorer()
  const out = feed(restorer, ['x ', '<PHO', 'NE_58a10cd8>', ' y'])
  assert.equal(out, `x ${VALUE} y`)
})

test('普通 `<` 文本不会被吞掉', () => {
  const restorer = makeRestorer()
  const text = '条件 a < b 且 c > d，还有 <not-a-placeholder> 结尾'
  for (const size of [1, 3, 16]) {
    assert.equal(feed(makeRestorer(), chunkBy(text, size)), text,
      `粒度 ${size} 普通尖括号文本被改写`)
  }
})

test('多个占位符相邻时逐个还原', () => {
  const restorer = makeRestorer()
  const text = `${PLACEHOLDER}${PLACEHOLDER}${PLACEHOLDER}`
  const out = feed(restorer, chunkBy(text, 2))
  assert.equal(out, VALUE.repeat(3))
  assert.equal(restorer.stats.restored, 3)
})

test('flush 后 pending 清空，可继续复用', () => {
  const restorer = makeRestorer()
  restorer.push('联系 <PHONE_58a')
  restorer.flush()
  assert.equal(restorer.pending, '')
  assert.equal(restorer.push(`${PLACEHOLDER}!`), `${VALUE}!`)
})

// ---- 2026-10-21 回灌：模型改写占位符格式（大小写/分隔符）时的宽松还原 ----

test('模型改写占位符大小写/分隔符：宽松还原兜底', () => {
  const restorer = makeRestorer()
  const out = feed(restorer, ['已记录 ', '<phone_58a10cd8>', ' 和 ', '<PHONE 58a10cd8>', '。'])
  assert.equal(out, `已记录 ${VALUE} 和 ${VALUE}。`)
  assert.equal(restorer.stats.restored, 2)
})

test('宽松还原按各粒度切片也成立（改写形态被切碎）', () => {
  // 注：仅覆盖"分隔符已可见"的形态（<PHONE 58a10cd8>）——大写标签走原 PARTIAL 正则，
  // 空格分隔走宽松尾串，各粒度都能扣住并还原。
  const text = 'a <PHONE 58a10cd8> b <PHONE 58a10cd8> c'
  for (const size of [1, 2, 3, 7, 16, 64]) {
    const out = feed(makeRestorer(), chunkBy(text, size))
    assert.equal(out, `a ${VALUE} b ${VALUE} c`, `粒度 ${size} 失败：${out}`)
  }
})

test('已知边界：小写占位符在分隔符可见前被切片会漏还原（仅占位符文本残留，真值不泄露）', () => {
  // '<p' / '<ph' 还看不出是占位符（与普通尖括号文本 <world 无法区分），
  // 按 DSH 侧"普通尖括号即时放行"的时序语义选择不扣留 → 该形态原样输出。
  // 隐私保证不受影响：漏的是占位符本身，不是真值。
  const restorer = makeRestorer()
  const out = feed(restorer, chunkBy('<phone_58a10cd8>', 1))
  assert.equal(out, '<phone_58a10cd8>')
  assert.equal(restorer.stats.restored, 0)
  // 分隔符一旦可见（粒度 ≥7）即可还原
  const restorer2 = makeRestorer()
  const out2 = feed(restorer2, chunkBy('<phone_58a10cd8>', 8))
  assert.equal(out2, VALUE)
})

test('宽松还原不会串到别的实体（未登记形态原样保留）', () => {
  const restorer = makeRestorer()
  const out = feed(restorer, ['<phone_deadbeef>', ' <PHONE 00000000>', ' <div 12345678>', ' <not-a-placeholder>'])
  assert.equal(out, '<phone_deadbeef> <PHONE 00000000> <div 12345678> <not-a-placeholder>')
  assert.equal(restorer.stats.restored, 0)
})

test('engine.restoreText 同样有宽松兜底', async () => {
  const { restoreText } = await import('../lib/engine.js')
  const vault = new Vault()
  vault.record(PLACEHOLDER, VALUE, 'PHONE')
  const out = restoreText('电话 <phone_58a10cd8> / <PHONE 58a10cd8> / <PHONE_58a10cd8>', (p) => vault.lookup(p))
  assert.equal(out, `电话 ${VALUE} / ${VALUE} / ${VALUE}`)
})
