import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { FileScannerService } from '../FileScannerService'

describe('FileScannerService', () => {
  let testDir: string
  let scanner: FileScannerService

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `file-scanner-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    // 创建测试文件结构
    // testDir/
    //   ├── file1.ts
    //   ├── file2.vue
    //   ├── file3.txt
    //   ├── subdir/
    //   │   ├── file4.ts
    //   │   └── file5.vue
    //   └── .hidden/
    //       └── hidden.ts

    await fs.writeFile(path.join(testDir, 'file1.ts'), 'export const a = 1')
    await fs.writeFile(path.join(testDir, 'file2.vue'), '<template></template>')
    await fs.writeFile(path.join(testDir, 'file3.txt'), 'text file')

    await fs.mkdir(path.join(testDir, 'subdir'))
    await fs.writeFile(path.join(testDir, 'subdir', 'file4.ts'), 'export const b = 2')
    await fs.writeFile(path.join(testDir, 'subdir', 'file5.vue'), '<template></template>')

    await fs.mkdir(path.join(testDir, '.hidden'))
    await fs.writeFile(path.join(testDir, '.hidden', 'hidden.ts'), 'hidden')

    scanner = new FileScannerService()
  })

  afterAll(async () => {
    // 清理测试目录
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('parseExtensions', () => {
    it('should parse comma-separated extensions', () => {
      const result = FileScannerService.parseExtensions('.ts,.vue,.js')
      expect(result).toEqual(['.ts', '.vue', '.js'])
    })

    it('should add dot prefix if missing', () => {
      const result = FileScannerService.parseExtensions('ts,vue,js')
      expect(result).toEqual(['.ts', '.vue', '.js'])
    })

    it('should handle mixed formats', () => {
      const result = FileScannerService.parseExtensions('.ts,vue,.js')
      expect(result).toEqual(['.ts', '.vue', '.js'])
    })

    it('should trim whitespace', () => {
      const result = FileScannerService.parseExtensions(' .ts , .vue , .js ')
      expect(result).toEqual(['.ts', '.vue', '.js'])
    })

    it('should filter empty strings', () => {
      const result = FileScannerService.parseExtensions('.ts,,,.vue')
      expect(result).toEqual(['.ts', '.vue'])
    })
  })

  describe('scan', () => {
    it('should scan for .ts files only', async () => {
      const result = await scanner.scan({
        directory: testDir,
        extensions: ['.ts']
      })

      expect(result.total).toBe(2)
      expect(result.files).toContain(path.join(testDir, 'file1.ts'))
      expect(result.files).toContain(path.join(testDir, 'subdir', 'file4.ts'))
    })

    it('should scan for multiple extensions', async () => {
      const result = await scanner.scan({
        directory: testDir,
        extensions: ['.ts', '.vue']
      })

      expect(result.total).toBe(4)
      expect(result.files).toContain(path.join(testDir, 'file1.ts'))
      expect(result.files).toContain(path.join(testDir, 'file2.vue'))
      expect(result.files).toContain(path.join(testDir, 'subdir', 'file4.ts'))
      expect(result.files).toContain(path.join(testDir, 'subdir', 'file5.vue'))
    })

    it('should skip hidden directories', async () => {
      const result = await scanner.scan({
        directory: testDir,
        extensions: ['.ts']
      })

      // 不应该包含 .hidden 目录中的文件
      expect(result.files).not.toContain(path.join(testDir, '.hidden', 'hidden.ts'))
    })

    it('should return empty array when no matching files', async () => {
      const result = await scanner.scan({
        directory: testDir,
        extensions: ['.xyz']
      })

      expect(result.total).toBe(0)
      expect(result.files).toEqual([])
    })

    it('should throw error for non-existent directory', async () => {
      await expect(
        scanner.scan({
          directory: '/non-existent-path-12345',
          extensions: ['.ts']
        })
      ).rejects.toThrow()
    })

    it('should throw error for file path (not directory)', async () => {
      const filePath = path.join(testDir, 'file1.ts')
      await expect(
        scanner.scan({
          directory: filePath,
          extensions: ['.ts']
        })
      ).rejects.toThrow('Path is not a directory')
    })

    it('should return only count when countOnly is true', async () => {
      const result = await scanner.scan({
        directory: testDir,
        extensions: ['.ts', '.vue'],
        countOnly: true
      })

      expect(result.total).toBe(4)
      expect(result.files).toEqual([])
    })

    it('should return count of zero when no matching files in countOnly mode', async () => {
      const result = await scanner.scan({
        directory: testDir,
        extensions: ['.xyz'],
        countOnly: true
      })

      expect(result.total).toBe(0)
      expect(result.files).toEqual([])
    })
  })
})
