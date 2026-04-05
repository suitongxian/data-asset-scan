import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseService } from '../DatabaseService'
import { DataDistributingRepository, CreateDataDistributingParams } from '../DataDistributingRepository'

describe('DataDistributingRepository - Windows Path Support', () => {
  let testDir: string
  let sqlPath: string
  let dbPath: string
  let dbService: DatabaseService
  let repo: DataDistributingRepository

  const createTestRecord = (overrides: Partial<CreateDataDistributingParams> = {}): CreateDataDistributingParams => ({
    path: '/test/file.txt',
    data_type: 1,
    content_sign: 'abc123',
    file_suffix: '.txt',
    file_size: 1024,
    ip: '192.168.1.1',
    mac_address: 'AA:BB:CC:DD:EE:FF',
    scan_time: new Date().toISOString(),
    ...overrides
  })

  beforeAll(async () => {
    testDir = path.join(os.tmpdir(), `data-dist-windows-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    sqlPath = path.join(testDir, 'database.sql')
    const sql = `
-- 数据分布表 data_distributing
CREATE TABLE data_distributing (
    data_distribution_id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_task_id INTEGER,
    path TEXT NOT NULL,
    data_type INTEGER NOT NULL,
    scan_found_count INTEGER NOT NULL,
    content_sign TEXT NOT NULL,
    file_suffix TEXT,
    file_magic TEXT,
    file_create_time DATETIME,
    file_update_time DATETIME,
    file_read_time DATETIME,
    file_size INTEGER NOT NULL,
    file_hide INTEGER DEFAULT 0,
    upload_state INTEGER DEFAULT 0,
    ip TEXT NOT NULL,
    mac_address TEXT NOT NULL,
    parent_id INTEGER,
    scan_time DATETIME NOT NULL,
    create_time DATETIME NOT NULL,
    update_time DATETIME NOT NULL,
    disable INTEGER NOT NULL DEFAULT 0
);

-- 数据资源表 data_resources (用于 getFilesWithPagination 的 JOIN)
CREATE TABLE data_resources (
    data_resource_id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_sign TEXT NOT NULL,
    source_count INTEGER DEFAULT 1,
    disable INTEGER NOT NULL DEFAULT 0
);
`
    await fs.writeFile(sqlPath, sql)
  })

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    dbPath = path.join(testDir, `test-${Date.now()}.db`)
    dbService = new DatabaseService({ dbPath, sqlPath })
    dbService.init()
    repo = new DataDistributingRepository(dbService.getDb(), 10)
  })

  afterEach(() => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('getActiveByPathMapWithPrefix - Windows path', () => {
    it('should find records with Windows backslash paths', () => {
      // 模拟 Windows 路径
      repo.insertBatch([
        createTestRecord({ path: 'C:\\Users\\da_ju\\我的工作空间\\file1.txt', content_sign: 'sign1' }),
        createTestRecord({ path: 'C:\\Users\\da_ju\\我的工作空间\\subdir\\file2.txt', content_sign: 'sign2' }),
        createTestRecord({ path: 'C:\\Users\\other\\file3.txt', content_sign: 'sign3' })
      ])

      const result = repo.getActiveByPathMapWithPrefix('C:\\Users\\da_ju\\我的工作空间')

      expect(result.size).toBe(2)
      expect(result.has('C:\\Users\\da_ju\\我的工作空间\\file1.txt')).toBe(true)
      expect(result.has('C:\\Users\\da_ju\\我的工作空间\\subdir\\file2.txt')).toBe(true)
      expect(result.has('C:\\Users\\other\\file3.txt')).toBe(false)
    })

    it('should handle Windows path with trailing backslash', () => {
      repo.insertBatch([
        createTestRecord({ path: 'C:\\Users\\test\\file.txt', content_sign: 'sign1' })
      ])

      const result = repo.getActiveByPathMapWithPrefix('C:\\Users\\test\\')

      expect(result.size).toBe(1)
      expect(result.has('C:\\Users\\test\\file.txt')).toBe(true)
    })

    it('should still work with Unix forward slash paths', () => {
      repo.insertBatch([
        createTestRecord({ path: '/home/user/workspace/file1.txt', content_sign: 'sign1' }),
        createTestRecord({ path: '/home/user/workspace/subdir/file2.txt', content_sign: 'sign2' }),
        createTestRecord({ path: '/home/other/file3.txt', content_sign: 'sign3' })
      ])

      const result = repo.getActiveByPathMapWithPrefix('/home/user/workspace')

      expect(result.size).toBe(2)
      expect(result.has('/home/user/workspace/file1.txt')).toBe(true)
      expect(result.has('/home/user/workspace/subdir/file2.txt')).toBe(true)
    })
  })

  describe('getFilesWithPagination - Windows path', () => {
    it('should filter files inside Windows workspace correctly', () => {
      repo.insertBatch([
        createTestRecord({ path: 'C:\\Users\\da_ju\\我的工作空间\\file1.txt', content_sign: 'sign1' }),
        createTestRecord({ path: 'C:\\Users\\da_ju\\我的工作空间\\subdir\\file2.txt', content_sign: 'sign2' }),
        createTestRecord({ path: 'C:\\Users\\other\\file3.txt', content_sign: 'sign3' })
      ])

      const result = repo.getFilesWithPagination({
        workspacePath: 'C:\\Users\\da_ju\\我的工作空间',
        workspaceFilter: 'inside'
      })

      expect(result.total).toBe(2)
      expect(result.files.length).toBe(2)
      expect(result.files.every(f => f.path.startsWith('C:\\Users\\da_ju\\我的工作空间'))).toBe(true)
    })

    it('should filter files outside Windows workspace correctly', () => {
      repo.insertBatch([
        createTestRecord({ path: 'C:\\Users\\da_ju\\我的工作空间\\file1.txt', content_sign: 'sign1' }),
        createTestRecord({ path: 'C:\\Users\\other\\file2.txt', content_sign: 'sign2' })
      ])

      const result = repo.getFilesWithPagination({
        workspacePath: 'C:\\Users\\da_ju\\我的工作空间',
        workspaceFilter: 'outside'
      })

      expect(result.total).toBe(1)
      expect(result.files[0].path).toBe('C:\\Users\\other\\file2.txt')
    })

    it('should handle Chinese characters in Windows paths', () => {
      repo.insertBatch([
        createTestRecord({ path: 'C:\\Users\\用户\\文档\\测试文件.txt', content_sign: 'sign1' }),
        createTestRecord({ path: 'C:\\Users\\用户\\文档\\子目录\\另一个文件.txt', content_sign: 'sign2' })
      ])

      const result = repo.getFilesWithPagination({
        workspacePath: 'C:\\Users\\用户\\文档',
        workspaceFilter: 'inside'
      })

      expect(result.total).toBe(2)
    })
  })

  describe('getAllFilesWithCopyCount - Windows path', () => {
    it('should filter files with Windows paths correctly', () => {
      repo.insertBatch([
        createTestRecord({ path: 'C:\\Work\\project\\src\\main.ts', content_sign: 'sign1' }),
        createTestRecord({ path: 'C:\\Work\\project\\test\\test.ts', content_sign: 'sign2' }),
        createTestRecord({ path: 'D:\\Other\\file.txt', content_sign: 'sign3' })
      ])

      const result = repo.getAllFilesWithCopyCount({
        workspacePath: 'C:\\Work\\project',
        workspaceFilter: 'inside'
      })

      expect(result.length).toBe(2)
      expect(result.every(f => f.path.startsWith('C:\\Work\\project'))).toBe(true)
    })
  })
})
