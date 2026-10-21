// lib/pack-crypto.js — 规则包加密（AES-256-GCM + scrypt 派生密钥，零依赖）。
//
// 文件格式（文本）：
//   第 1 行：DSH-SHIELD-ENC/v1
//   第 2 行：base64( salt[16] | iv[12] | tag[16] | ciphertext )
// 口令用 scrypt（N=2^15, r=8, p=1）派生 32 字节密钥；GCM 认证失败统一报"口令错误或文件损坏"。
//
// 用途：规则包可能含敏感专有名词词表，加密后可通过低信任通道传输。
// 注意：口令强度决定安全性；丢失口令无法找回内容。

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/** 加密包文件头（第 1 行）。 */
export const ENC_MAGIC = 'DSH-SHIELD-ENC/v1'

/** 载荷布局长度。 */
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16

/**
 * 加密规则包文本。
 * @param {string} plaintext 明文规则包（JSON）。
 * @param {string} passphrase 口令。
 * @returns {string} 加密包文本。
 */
export function encryptPackText(plaintext, passphrase) {
  const secret = String(passphrase ?? '')
  if (secret === '') throw new Error('口令不能为空')
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const key = scryptSync(secret, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENC_MAGIC}\n${Buffer.concat([salt, iv, tag, data]).toString('base64')}\n`
}

/**
 * 判断文本是否为加密规则包。
 * @param {string} text 文件文本。
 * @returns {boolean} 是否加密包。
 */
export function isEncryptedPackText(text) {
  return typeof text === 'string' && text.split('\n', 1)[0] === ENC_MAGIC
}

/**
 * 解密规则包文本。
 * @param {string} text 加密包文本。
 * @param {string} passphrase 口令。
 * @returns {string} 明文规则包（JSON）。
 * @throws {Error} 口令错误或文件损坏 / 格式不识别。
 */
export function decryptPackText(text, passphrase) {
  if (!isEncryptedPackText(text)) throw new Error('不是加密规则包（缺少 DSH-SHIELD-ENC/v1 头）')
  const secret = String(passphrase ?? '')
  if (secret === '') throw new Error('该规则包已加密：请用 /shield import <路径> --pass <口令> 导入')
  const lines = text.split('\n')
  let blob
  try {
    blob = Buffer.from((lines[1] ?? '').trim(), 'base64')
  } catch {
    blob = Buffer.alloc(0)
  }
  if (blob.length < SALT_LEN + IV_LEN + TAG_LEN + 1) throw new Error('加密包文件损坏（载荷过短）')
  const salt = blob.subarray(0, SALT_LEN)
  const iv = blob.subarray(SALT_LEN, SALT_LEN + IV_LEN)
  const tag = blob.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN)
  const data = blob.subarray(SALT_LEN + IV_LEN + TAG_LEN)
  const key = scryptSync(secret, salt, 32)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    // 统一口径，避免区分"认证失败"与"格式错误"。
    throw new Error('口令错误或文件损坏')
  }
}
