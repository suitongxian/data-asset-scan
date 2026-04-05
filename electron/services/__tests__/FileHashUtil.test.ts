import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { calculateFileHash, calculateFileHashSync } from '../FileHashUtil'

describe('FileHashUtil', () => {
  let testDir: string
  let smallFilePath: string
  let largeFilePath: string

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `file-hash-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    // 创建小文件（< 5MB）
    smallFilePath = path.join(testDir, 'small.txt')
    const smallContent = 'Hello, this is a small test file for MD5 calculation.'
    await fs.writeFile(smallFilePath, smallContent)

    // 创建大文件（> 5MB）- 6MB
    largeFilePath = path.join(testDir, 'large.bin')
    const largeSize = 6 * 1024 * 1024 // 6MB
    const largeBuffer = Buffer.alloc(largeSize)
    // 填充一些非零数据以确保哈希不同
    for (let i = 0; i < largeSize; i++) {
      largeBuffer[i] = i % 256
    }
    await fs.writeFile(largeFilePath, largeBuffer)
  })

  afterAll(async () => {
    // 清理测试目录
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('calculateFileHash (async)', () => {
    it('should calculate correct MD5 for small files', async () => {
      const result = await calculateFileHash(smallFilePath)

      // 验证返回结构
      expect(result).toHaveProperty('hash')
      expect(result).toHaveProperty('size')
      expect(result).toHaveProperty('isPartialHash')

      // 小文件应该使用完整哈希
      expect(result.isPartialHash).toBe(false)

      // 验证哈希值正确（与 Node.js 标准 crypto 比较）
      const expectedHash = crypto.createHash('md5')
        .update(await fs.readFile(smallFilePath))
        .digest('hex')
      expect(result.hash).toBe(expectedHash)
    })

    it('should use partial hash for large files', async () => {
      const result = await calculateFileHash(largeFilePath)

      // 大文件应该使用部分哈希
      expect(result.isPartialHash).toBe(true)
      expect(result.size).toBe(6 * 1024 * 1024)

      // 验证哈希格式（32位十六进制）
      expect(result.hash).toMatch(/^[a-f0-9]{32}$/)
    })

    it('should return correct file size', async () => {
      const smallResult = await calculateFileHash(smallFilePath)
      const largeResult = await calculateFileHash(largeFilePath)

      const smallStat = await fs.stat(smallFilePath)
      const largeStat = await fs.stat(largeFilePath)

      expect(smallResult.size).toBe(smallStat.size)
      expect(largeResult.size).toBe(largeStat.size)
    })

    it('should produce consistent results for same file', async () => {
      const result1 = await calculateFileHash(smallFilePath)
      const result2 = await calculateFileHash(smallFilePath)

      expect(result1.hash).toBe(result2.hash)
    })

    it('should throw error for non-existent file', async () => {
      await expect(
        calculateFileHash(path.join(testDir, 'non-existent.txt'))
      ).rejects.toThrow()
    })

    it('should handle exactly 5MB file as small file', async () => {
      const exactFilePath = path.join(testDir, 'exact-5mb.bin')
      const exactSize = 5 * 1024 * 1024 // exactly 5MB
      const exactBuffer = Buffer.alloc(exactSize, 0)
      await fs.writeFile(exactFilePath, exactBuffer)

      const result = await calculateFileHash(exactFilePath)

      // 正好 5MB 应该使用完整哈希
      expect(result.isPartialHash).toBe(false)
      expect(result.size).toBe(exactSize)

      await fs.unlink(exactFilePath)
    })

    it('should handle empty file', async () => {
      const emptyFilePath = path.join(testDir, 'empty.txt')
      await fs.writeFile(emptyFilePath, '')

      const result = await calculateFileHash(emptyFilePath)

      expect(result.isPartialHash).toBe(false)
      expect(result.size).toBe(0)
      // MD5 of empty string
      expect(result.hash).toBe('d41d8cd98f00b204e9800998ecf8427e')

      await fs.unlink(emptyFilePath)
    })
  })

  describe('calculateFileHashSync', () => {
    it('should calculate correct MD5 for small files', () => {
      const result = calculateFileHashSync(smallFilePath)

      expect(result.isPartialHash).toBe(false)

      // 验证哈希值正确
      const expectedHash = crypto.createHash('md5')
        .update(fsSync.readFileSync(smallFilePath))
        .digest('hex')
      expect(result.hash).toBe(expectedHash)
    })

    it('should use partial hash for large files', () => {
      const result = calculateFileHashSync(largeFilePath)

      expect(result.isPartialHash).toBe(true)
      expect(result.size).toBe(6 * 1024 * 1024)
      expect(result.hash).toMatch(/^[a-f0-9]{32}$/)
    })

    it('should produce same results as async version', async () => {
      const asyncResult = await calculateFileHash(smallFilePath)
      const syncResult = calculateFileHashSync(smallFilePath)

      expect(syncResult.hash).toBe(asyncResult.hash)
      expect(syncResult.size).toBe(asyncResult.size)
      expect(syncResult.isPartialHash).toBe(asyncResult.isPartialHash)
    })

    it('should produce same partial hash as async version for large files', async () => {
      const asyncResult = await calculateFileHash(largeFilePath)
      const syncResult = calculateFileHashSync(largeFilePath)

      expect(syncResult.hash).toBe(asyncResult.hash)
      expect(syncResult.size).toBe(asyncResult.size)
      expect(syncResult.isPartialHash).toBe(asyncResult.isPartialHash)
    })

    it('should throw error for non-existent file', () => {
      expect(() => {
        calculateFileHashSync(path.join(testDir, 'non-existent.txt'))
      }).toThrow()
    })
  })

  describe('partial hash correctness', () => {
    it('should compute partial hash from first and last 4096 bytes', async () => {
      // 手动计算预期的部分哈希
      const content = await fs.readFile(largeFilePath)
      const head = content.subarray(0, 4096)
      const tail = content.subarray(content.length - 4096)

      const expectedHash = crypto.createHash('md5')
        .update(head)
        .update(tail)
        .digest('hex')

      const result = await calculateFileHash(largeFilePath)

      expect(result.hash).toBe(expectedHash)
    })
  })
})
