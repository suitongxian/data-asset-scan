import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { calculateFileTlsh, calculateTlshDistance, calculateFileSimilarity } from '../TlsHUtil'

describe('TlsHUtil', () => {
  let testDir: string

  beforeAll(async () => {
    testDir = path.join(os.tmpdir(), `tlsh-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('calculateFileTlsh', () => {
    it('should compute hash for a valid file', async () => {
      const filePath = path.join(testDir, 'test.txt')
      const content = 'This is a test file content for TLSH. '.repeat(50)
      await fs.writeFile(filePath, content)

      const result = await calculateFileTlsh(filePath)

      expect(result.hash).toMatch(/^[0-9A-Fa-f]{70}$/)
      expect(result.error).toBeUndefined()
    })

    it('should return error for non-existent file', async () => {
      const result = await calculateFileTlsh(path.join(testDir, 'nonexistent.txt'))
      expect(result.hash).toBe('')
      expect(result.error).toBeDefined()
    })
  })

  describe('calculateTlshDistance', () => {
    it('should return 0 for identical hashes', () => {
      const hash = '6FF02BEF718027B0160B4391212923ED7F1A463D563B1549B86CF62973B197AD2731F8'.padEnd(70, '0')
      expect(calculateTlshDistance(hash, hash)).toBe(0)
    })

    it('should return positive value for different hashes', () => {
      const hash1 = '6FF02BEF718027B0160B4391212923ED7F1A463D563B1549B86CF62973B197AD2731F8'.padEnd(70, '0')
      const hash2 = '301124198C869A5A4F0F9380A9AE92F2B9278F42089EA34272885F0FB2D34E6911444C'.padEnd(70, '0')
      const distance = calculateTlshDistance(hash1, hash2)

      expect(distance).toBeGreaterThan(0)
    })
  })

  describe('calculateFileSimilarity', () => {
    it('should detect identical files as high similarity', async () => {
      const content = 'This is test content for similarity detection. '.repeat(100)
      const filePath1 = path.join(testDir, 'identical1.txt')
      const filePath2 = path.join(testDir, 'identical2.txt')

      await Promise.all([
        fs.writeFile(filePath1, content),
        fs.writeFile(filePath2, content)
      ])

      const result = await calculateFileSimilarity(filePath1, filePath2)

      expect(result.distance).toBe(0)
      expect(result.similarity).toBe('high')
    })

    it('should detect different files as lower similarity', async () => {
      const content1 = 'Completely different content file one. '.repeat(100)
      const content2 = 'Totally distinct content file two. '.repeat(100)

      const filePath1 = path.join(testDir, 'diff1.txt')
      const filePath2 = path.join(testDir, 'diff2.txt')

      await Promise.all([
        fs.writeFile(filePath1, content1),
        fs.writeFile(filePath2, content2)
      ])

      const result = await calculateFileSimilarity(filePath1, filePath2)

      expect(result.distance).toBeGreaterThan(0)
      expect(['medium', 'low', 'none']).toContain(result.similarity)
    })
  })


  describe('集成测试', () => {
    it.skip('pages文件相似度比较', async () => {
      // 此测试需要特定的测试文件，已跳过
      // 如有需要，请创建临时测试文件后再运行
    })
  })
})


//
//
function test(){

}