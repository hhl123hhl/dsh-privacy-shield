// lib/crypto.js — 占位符哈希密钥管理（node:crypto，零外部依赖）。
//
// 为什么需要：v0.2.1 及更早的占位符哈希是 FNV-1a，**非密码学**——能猜到真值的攻击者可
// 重算哈希、确认"这个 <PHONE_xxxxxxxx> 就是某个具体号码"。v0.3.0 起默认改用
// HMAC-SHA256（密钥本地托管），占位符从"可离线验证的指纹"变成"不可确认的随机标识"。
//
// 密钥策略（诚实说明，不夸大）：
// - 首选落盘 `$DSH_HOME/shield/.placeholder.key`（32 字节随机，权限 600 尽力而为）。
//   同一台机器、同一个 DSH_HOME 下，占位符跨进程/重启稳定。
// - 落盘失败（只读目录/权限问题）→ 退到进程内存随机密钥：本次运行内稳定，重启后变化。
//   这只影响"重启后旧占位符的还原"（vault 本就内存态），不影响本次运行的脱敏效果。
// - 密钥永远不进日志、不进规则包、不进审计。
// - 配置 placeholderHash: legacy 可整体回退到 FNV-1a（兼容/降级场景）。

import { createHmac, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { rulesRoot } from './rules.js'

/** HMAC-SHA256 前 4 字节 → 8 位十六进制（与 legacy 的 hash8 等宽，占位符形态不变）。 */
export function hmac8(key, input) {
  return createHmac('sha256', key).update(input, 'utf8').digest().subarray(0, 4).toString('hex')
}

/** 密钥文件路径。 */
export function keyPath(env = process.env) {
  return join(rulesRoot(env), '.placeholder.key')
}

/**
 * 载入（或首用生成）占位符密钥。
 * @param {Record<string, string|undefined>} [env] 环境变量。
 * @returns {{key: Buffer, source: 'file'|'memory', warning: string|null}}
 *   key 一定可用（最差也是本次进程的随机密钥）；warning 说明降级情况。
 */
export function loadPlaceholderKey(env = process.env) {
  const path = keyPath(env)
  try {
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8').trim()
      const key = Buffer.from(text, 'hex')
      if (key.length === 32) return { key, source: 'file', warning: null }
      return { key: randomBytes(32), source: 'memory', warning: `密钥文件 ${path} 内容异常（非 64 位十六进制），本次运行使用内存密钥` }
    }
    const key = randomBytes(32)
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, key.toString('hex'), { encoding: 'utf8', mode: 0o600 })
      try { chmodSync(path, 0o600) } catch { /* Windows 无 chmod 语义，尽力而为 */ }
      return { key, source: 'file', warning: null }
    } catch {
      return { key, source: 'memory', warning: `密钥无法落盘（${path}），本次运行使用内存密钥：重启后旧占位符将无法还原` }
    }
  } catch (error) {
    return {
      key: randomBytes(32),
      source: 'memory',
      warning: `密钥载入失败：${error instanceof Error ? error.message : String(error)}；本次运行使用内存密钥`,
    }
  }
}

/** 占位符哈希输入的标准分隔符（与 legacy 算法逐字节一致，保证别名可互算）。 */
const SEP = '\u0000'

/**
 * 按配置构造占位符哈希器。
 * @param {object} config 已归一化配置（placeholderHash）。
 * @param {Record<string, string|undefined>} [env] 环境变量。
 * @returns {{hasher: (label: string, value: string) => string, mode: 'hmac'|'legacy', warning: string|null, keySource: 'file'|'memory'|null}}
 */
export function makePlaceholderHasher(config, env = process.env) {
  if (config?.placeholderHash !== 'hmac') {
    return { hasher: legacyHasher(), mode: 'legacy', warning: null, keySource: null }
  }
  const { key, source, warning } = loadPlaceholderKey(env)
  return {
    hasher: (label, value) => hmac8(key, `${label}${SEP}${value}`),
    mode: 'hmac',
    warning,
    keySource: source,
  }
}

/**
 * legacy（FNV-1a）哈希器——与 lib/engine.js 的 hash8 算法保持一致，
 * 用于 placeholderHash: legacy 回退，以及 vault 登记旧式占位符别名（跨版本还原）。
 */
export function legacyHasher() {
  return (label, value) => legacyHash8(label, value)
}

/** legacy 占位符哈希本体（`<LABEL_hash>` 里的 hash 部分）。 */
export function legacyHash8(label, value) {
  const input = `${label}${SEP}${value}`
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 由 legacy 哈希拼出完整占位符（vault 别名登记用）。 */
export function legacyPlaceholder(label, value) {
  return `<${label}_${legacyHash8(label, value)}>`
}
