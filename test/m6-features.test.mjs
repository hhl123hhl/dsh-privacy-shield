// test/m6-features.test.mjs — M6：规则包加密（AES-256-GCM+scrypt）、pause 放行、doctor 体检（node --test）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ShieldRuntime } from '../lib/runtime.js'
import { resolveConfig } from '../lib/config.js'
import { encryptPackText, decryptPackText, isEncryptedPackText, ENC_MAGIC } from '../lib/pack-crypto.js'
import { formatDoctor } from '../lib/report.js'
import { createStreamHandler } from '../lib/stream.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'shield-m6-'))
}

function makeRuntime() {
  return new ShieldRuntime(resolveConfig({ placeholderHash: 'legacy' }), { DSH_HOME: tempDir() })
}

// ---------- 规则包加解密 ----------

test('pack-crypto：加密 → 识别 → 解密还原；错误口令统一报错', () => {
  const plain = '{"schema":"dsh-shield/rules@1","entities":["email"],"terms":["甲公司 @org"]}'
  const encrypted = encryptPackText(plain, 'correct-horse')
  assert.ok(encrypted.startsWith(ENC_MAGIC))
  assert.ok(isEncryptedPackText(encrypted))
  assert.ok(!isEncryptedPackText(plain))
  assert.equal(decryptPackText(encrypted, 'correct-horse'), plain)
  assert.throws(() => decryptPackText(encrypted, 'wrong'), /口令错误或文件损坏/)
  assert.throws(() => decryptPackText(encrypted, ''), /请用.*--pass/)
  assert.throws(() => decryptPackText('not a pack', 'x'), /不是加密规则包/)
  assert.throws(() => encryptPackText(plain, ''), /口令不能为空/)
})

test('pack-crypto：密文不泄露明文内容', () => {
  const plain = '{"terms":["绝密项目甲 @proj"]}'
  const encrypted = encryptPackText(plain, 'pw')
  assert.ok(!encrypted.includes('绝密项目甲'))
})

// ---------- pause ----------

test('runtime.pause：放行窗口内 protecting=false，到期自动恢复', () => {
  const rt = makeRuntime()
  assert.equal(rt.protecting, true)
  const result = rt.pause(5)
  assert.equal(result.pausedRemainingMin, 5)
  assert.equal(rt.protecting, false)
  assert.equal(rt.isPaused(), true)
  assert.equal(rt.pausedRemaining(), 5)
  // 快照带剩余分钟。
  assert.ok(rt.snapshot().pausedRemainingMin >= 4)
  // 提前恢复。
  rt.resume()
  assert.equal(rt.protecting, true)
  assert.equal(rt.isPaused(), false)
  assert.equal(rt.pausedRemaining(), 0)
})

test('runtime.pause：边界钳制 1–720；非数字报 0 分钟（调用方校验）', () => {
  const rt = makeRuntime()
  assert.equal(rt.pause(0).pausedRemainingMin, 1) // 钳到 1
  rt.resume()
  assert.equal(rt.pause(9999).pausedRemainingMin, 720) // 钳到 720
  rt.resume()
  assert.equal(rt.pause('abc').pausedRemainingMin, 1)
  rt.resume()
})

test('stream：pause 期间不阻断 onUnmaskable=block 的请求，但审计标注 paused', async () => {
  const home = tempDir()
  const rt = new ShieldRuntime(resolveConfig({
    placeholderHash: 'legacy',
    onUnmaskable: 'block',
  }), { DSH_HOME: home })
  rt.pause(5)
  const audits = []
  const handler = createStreamHandler(rt, { onAudit: (record) => audits.push(record) })
  let blocked = false
  const options = { messages: [{ role: 'user', content: [{ type: 'text', text: '含明文 13800138000 的请求' }] }] }
  // 手搓（未冻结）请求：pause 期间也不该触发 block。
  try {
    const iterable = handler(options, () => (async function* () { yield { type: 'done' } })())
    for await (const event of iterable) void event
  } catch {
    blocked = true
  }
  assert.equal(blocked, false)
  assert.equal(audits.length, 1)
  assert.equal(audits[0].paused, true)
  rmSync(home, { recursive: true, force: true })
})

// ---------- doctor ----------

test('formatDoctor：补丁/模式/词表/审计逐项输出 ✅/⚠️', () => {
  const rt = makeRuntime()
  const text = formatDoctor(rt, rt.config, '0.3.0')
  assert.match(text, /doctor/)
  assert.match(text, /derive 补丁/)
  assert.match(text, /✅|⚠️/)
  // 空词表应有 ⚠️。
  assert.match(text, /⚠️ 词表/)
  // 加词表后 ⚠️ 消失。
  rt.addTermLines(['甲公司 @org'])
  const after = formatDoctor(rt, rt.config, '0.3.0')
  assert.match(after, /✅ 词表/)
  assert.match(after, /版本：0\.3\.0/)
})
