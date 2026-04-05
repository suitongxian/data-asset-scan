/**
 * TLSH (Trend Locality Sensitive Hash) 工具类
 * 用于计算文件的局部敏感哈希和相似度距离
 */

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import tlsh from 'tlsh'

export interface TlsHResult {
  hash: string
  error?: string
}

export interface SimilarityResult {
  distance: number
  similarity: 'high' | 'medium' | 'low' | 'none'
}

/**
 * 计算文件内容的 TLSH 哈希（异步）
 */
export async function calculateFileTlsh(filePath: string): Promise<TlsHResult> {
  try {
    const content = await fs.readFile(filePath)
    const hash = tlsh(content.toString('hex'))
    return { hash }
  } catch (error) {
    return { hash: '', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 计算文件内容的 TLSH 哈希（同步）
 */
export function calculateFileTlshSync(filePath: string): TlsHResult {
  try {
    const content = fsSync.readFileSync(filePath, 'utf-8')
    const hash = tlsh(content)
    return { hash }
  } catch (error) {
    return { hash: '', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 计算 TLSH 距离
 * TLSH 距离越小，两个文件越相似
 *
 * @param hash1 第一个 TLSH 哈希
 * @param hash2 第二个 TLSH 哈希
 * @returns 距离值，0 表示完全相同
 */
export function calculateTlshDistance(hash1: string, hash2: string): number {
  // 简单的汉明距离计算（仅用于演示）
  // 实际应使用 tlsh-js 库的 Digest 对象计算
  if (hash1 === hash2) return 0

  const bytes1 = hexToBytes(hash1)
  const bytes2 = hexToBytes(hash2)

  let distance = 0
  const len = Math.min(bytes1.length, bytes2.length)
  for (let i = 0; i < len; i++) {
    const xor = bytes1[i] ^ bytes2[i]
    distance += popcount(xor)
  }

  return distance
}

/**
 * 计算两个文件的相似度
 */
export async function calculateFileSimilarity(
  filePath1: string,
  filePath2: string
): Promise<SimilarityResult> {
  const result1 = await calculateFileTlsh(filePath1)
  const result2 = await calculateFileTlsh(filePath2)

  if (result1.error) {
    throw new Error(`Failed to compute hash for ${filePath1}: ${result1.error}`)
  }
  if (result2.error) {
    throw new Error(`Failed to compute hash for ${filePath2}: ${result2.error}`)
  }

  const distance = calculateTlshDistance(result1.hash, result2.hash)
  return { distance, similarity: getSimilarityLevel(distance) }
}

function getSimilarityLevel(distance: number): 'high' | 'medium' | 'low' | 'none' {
  if (distance <= 30) return 'high'
  if (distance <= 100) return 'medium'
  if (distance <= 200) return 'low'
  return 'none'
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16))
  }
  return bytes
}

function popcount(x: number): number {
  x = x - ((x >> 1) & 0x5555)
  x = (x & 0x3333) + ((x >> 2) & 0x3333)
  x = (x + (x >> 4)) & 0x0f0f
  return (x * 0x0101) >> 8
}
