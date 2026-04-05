import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseService } from '../DatabaseService'
import { DataDistributingRepository, CreateDataDistributingParams } from '../DataDistributingRepository'

describe('DataDistributingRepository - upload_state', () => {
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
    testDir = path.join(os.tmpdir(), `upload-state-test-${Date.now()}`)
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

-- 信息资源表 data_resources
CREATE TABLE data_resources (
    data_resources_id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_sign TEXT NOT NULL,
    source_count INTEGER NOT NULL,
    workspace_source_count INTEGER NOT NULL,
    first_create_time DATETIME NOT NULL,
    resources_name TEXT,
    resources_desc TEXT,
    content_subject TEXT,
    content_type TEXT,
    is_claimed INTEGER DEFAULT 0,
    claim_status INTEGER DEFAULT 0,
    importance_level INTEGER DEFAULT 0,
    claim_time DATETIME,
    claimant_name TEXT,
    claimant_unit TEXT,
    data_level TEXT,
    data_share TEXT,
    file_magic TEXT,
    create_time DATETIME NOT NULL,
    update_time DATETIME NOT NULL,
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

  describe('updateUploadState', () => {
    it('should update upload_state for a specific record', () => {
      // 插入测试记录
      repo.insertBatch([createTestRecord({ path: '/test/file1.txt', content_sign: 'sign1' })])

      // 获取记录ID
      const record = repo.getByPath('/test/file1.txt')
      expect(record).not.toBeNull()
      expect(record!.upload_state).toBe(0) // 默认为0

      // 更新上传状态为1（已上传）
      repo.updateUploadState(record!.data_distribution_id!, 1)

      // 验证更新结果
      const updatedRecord = repo.getByPath('/test/file1.txt')
      expect(updatedRecord!.upload_state).toBe(1)
    })

    it('should update upload_state to failed (3) for failed upload', () => {
      repo.insertBatch([createTestRecord({ path: '/test/file2.txt', content_sign: 'sign2' })])

      const record = repo.getByPath('/test/file2.txt')
      repo.updateUploadState(record!.data_distribution_id!, 3)

      const updatedRecord = repo.getByPath('/test/file2.txt')
      expect(updatedRecord!.upload_state).toBe(3)
    })
  })

  describe('updateCopiesUploadState', () => {
    it('should update upload_state to 2 for all copies with same content_sign', () => {
      // 插入多个相同content_sign的记录
      repo.insertBatch([
        createTestRecord({ path: '/test/original.txt', content_sign: 'same-hash' }),
        createTestRecord({ path: '/test/copy1.txt', content_sign: 'same-hash' }),
        createTestRecord({ path: '/test/copy2.txt', content_sign: 'same-hash' }),
        createTestRecord({ path: '/test/different.txt', content_sign: 'different-hash' })
      ])

      // 获取原始文件记录
      const original = repo.getByPath('/test/original.txt')
      expect(original).not.toBeNull()

      // 更新原始文件为已上传
      repo.updateUploadState(original!.data_distribution_id!, 1)

      // 更新其他副本为副本状态
      const updatedCount = repo.updateCopiesUploadState('same-hash', original!.data_distribution_id!)
      expect(updatedCount).toBe(2) // 应该更新2个副本

      // 验证副本状态
      const copy1 = repo.getByPath('/test/copy1.txt')
      const copy2 = repo.getByPath('/test/copy2.txt')
      const different = repo.getByPath('/test/different.txt')

      expect(copy1!.upload_state).toBe(2) // 副本已上传
      expect(copy2!.upload_state).toBe(2) // 副本已上传
      expect(different!.upload_state).toBe(0) // 不同hash，不受影响
    })

    it('should not update already uploaded copies', () => {
      repo.insertBatch([
        createTestRecord({ path: '/test/file1.txt', content_sign: 'same-hash' }),
        createTestRecord({ path: '/test/file2.txt', content_sign: 'same-hash' })
      ])

      const file1 = repo.getByPath('/test/file1.txt')
      const file2 = repo.getByPath('/test/file2.txt')

      // 先将file2设为已上传
      repo.updateUploadState(file2!.data_distribution_id!, 1)

      // 尝试将file2更新为副本状态（应该不影响，因为只更新upload_state=0的记录）
      const updatedCount = repo.updateCopiesUploadState('same-hash', file1!.data_distribution_id!)
      expect(updatedCount).toBe(0) // file2已经是1，不应该被更新

      const file2After = repo.getByPath('/test/file2.txt')
      expect(file2After!.upload_state).toBe(1) // 保持已上传状态
    })

    it('should exclude the specified record from update', () => {
      repo.insertBatch([
        createTestRecord({ path: '/test/main.txt', content_sign: 'hash123' }),
        createTestRecord({ path: '/test/backup.txt', content_sign: 'hash123' })
      ])

      const main = repo.getByPath('/test/main.txt')

      // 更新副本，排除main
      repo.updateCopiesUploadState('hash123', main!.data_distribution_id!)

      // main应该不受影响
      const mainAfter = repo.getByPath('/test/main.txt')
      expect(mainAfter!.upload_state).toBe(0) // 原始记录不变

      // backup应该被更新
      const backupAfter = repo.getByPath('/test/backup.txt')
      expect(backupAfter!.upload_state).toBe(2)
    })
  })

  describe('getByPathWithUploadState', () => {
    it('should return record with upload_state field', () => {
      repo.insertBatch([createTestRecord({ path: '/test/myfile.txt', content_sign: 'mysign' })])

      const record = repo.getByPathWithUploadState('/test/myfile.txt')

      expect(record).not.toBeNull()
      expect(record!.path).toBe('/test/myfile.txt')
      expect(record!.upload_state).toBe(0)
      expect(record!.content_sign).toBe('mysign')
    })

    it('should return null for non-existent path', () => {
      const record = repo.getByPathWithUploadState('/non/existent/path.txt')
      expect(record).toBeNull()
    })

    it('should not return disabled records', () => {
      repo.insertBatch([createTestRecord({ path: '/test/disabled.txt' })])

      // 禁用记录
      dbService.getDb().prepare('UPDATE data_distributing SET disable = 1 WHERE path = ?').run('/test/disabled.txt')

      const record = repo.getByPathWithUploadState('/test/disabled.txt')
      expect(record).toBeNull()
    })
  })

  describe('upload workflow integration', () => {
    it('should correctly handle full upload workflow', () => {
      // 场景：上传一个文件，同时有2个副本
      const contentSign = 'workflow-test-hash'
      repo.insertBatch([
        createTestRecord({ path: '/docs/report.pdf', content_sign: contentSign }),
        createTestRecord({ path: '/backup/report.pdf', content_sign: contentSign }),
        createTestRecord({ path: '/archive/report.pdf', content_sign: contentSign })
      ])

      // 1. 获取要上传的文件
      const fileToUpload = repo.getByPathWithUploadState('/docs/report.pdf')
      expect(fileToUpload).not.toBeNull()
      expect(fileToUpload!.upload_state).toBe(0)

      // 2. 模拟上传成功
      repo.updateUploadState(fileToUpload!.data_distribution_id!, 1)

      // 3. 更新副本状态
      const copiesUpdated = repo.updateCopiesUploadState(contentSign, fileToUpload!.data_distribution_id!)
      expect(copiesUpdated).toBe(2)

      // 4. 验证最终状态
      const main = repo.getByPath('/docs/report.pdf')
      const backup = repo.getByPath('/backup/report.pdf')
      const archive = repo.getByPath('/archive/report.pdf')

      expect(main!.upload_state).toBe(1)   // 已上传
      expect(backup!.upload_state).toBe(2) // 副本已上传
      expect(archive!.upload_state).toBe(2) // 副本已上传
    })

    it('should handle upload failure correctly', () => {
      repo.insertBatch([
        createTestRecord({ path: '/docs/failed.pdf', content_sign: 'fail-hash' }),
        createTestRecord({ path: '/backup/failed.pdf', content_sign: 'fail-hash' })
      ])

      const file = repo.getByPathWithUploadState('/docs/failed.pdf')

      // 模拟上传失败
      repo.updateUploadState(file!.data_distribution_id!, 3)

      // 验证状态
      const failedFile = repo.getByPath('/docs/failed.pdf')
      const backupFile = repo.getByPath('/backup/failed.pdf')

      expect(failedFile!.upload_state).toBe(3) // 上传失败
      expect(backupFile!.upload_state).toBe(0) // 副本未受影响
    })
  })
})
