import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseService } from '../DatabaseService'
import { DataDistributingRepository, CreateDataDistributingParams } from '../DataDistributingRepository'

describe('DataDistributingRepository', () => {
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
    testDir = path.join(os.tmpdir(), `data-dist-repo-test-${Date.now()}`)
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
    ip TEXT NOT NULL,
    mac_address TEXT NOT NULL,
    parent_id INTEGER,
    scan_time DATETIME NOT NULL,
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
    repo = new DataDistributingRepository(dbService.getDb(), 10) // 小批量用于测试
  })

  afterEach(() => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('add', () => {
    it('should add record to buffer', () => {
      const flushed = repo.add(createTestRecord())

      expect(flushed).toBe(0) // 未触发 flush
      expect(repo.getBufferSize()).toBe(1)
    })

    it('should auto flush when buffer is full', () => {
      // batchSize = 10
      for (let i = 0; i < 9; i++) {
        const flushed = repo.add(createTestRecord({ path: `/file${i}.txt` }))
        expect(flushed).toBe(0)
      }

      // 第10条应该触发 flush
      const flushed = repo.add(createTestRecord({ path: '/file9.txt' }))

      expect(flushed).toBe(10)
      expect(repo.getBufferSize()).toBe(0)
      expect(repo.count()).toBe(10)
    })
  })

  describe('flush', () => {
    it('should write buffered records to database', () => {
      repo.add(createTestRecord({ path: '/a.txt' }))
      repo.add(createTestRecord({ path: '/b.txt' }))
      repo.add(createTestRecord({ path: '/c.txt' }))

      expect(repo.getBufferSize()).toBe(3)
      expect(repo.count()).toBe(0)

      const flushed = repo.flush()

      expect(flushed).toBe(3)
      expect(repo.getBufferSize()).toBe(0)
      expect(repo.count()).toBe(3)
    })

    it('should return 0 when buffer is empty', () => {
      const flushed = repo.flush()
      expect(flushed).toBe(0)
    })

    it('should use transaction for batch write', () => {
      // 添加一些记录
      for (let i = 0; i < 5; i++) {
        repo.add(createTestRecord({ path: `/file${i}.txt`, content_sign: `sign${i}` }))
      }

      repo.flush()

      // 验证所有记录都已写入
      expect(repo.count()).toBe(5)
    })
  })

  describe('insertBatch', () => {
    it('should insert records directly without buffering', () => {
      const records = [
        createTestRecord({ path: '/a.txt', content_sign: 'sign1' }),
        createTestRecord({ path: '/b.txt', content_sign: 'sign2' }),
        createTestRecord({ path: '/c.txt', content_sign: 'sign3' })
      ]

      const inserted = repo.insertBatch(records)

      expect(inserted).toBe(3)
      expect(repo.count()).toBe(3)
      expect(repo.getBufferSize()).toBe(0) // buffer 应该不受影响
    })

    it('should return 0 for empty array', () => {
      const inserted = repo.insertBatch([])
      expect(inserted).toBe(0)
    })
  })

  describe('getByContentSign', () => {
    it('should find records by content sign', () => {
      repo.insertBatch([
        createTestRecord({ path: '/a.txt', content_sign: 'same-sign' }),
        createTestRecord({ path: '/b.txt', content_sign: 'same-sign' }),
        createTestRecord({ path: '/c.txt', content_sign: 'different-sign' })
      ])

      const results = repo.getByContentSign('same-sign')

      expect(results.length).toBe(2)
      expect(results.every(r => r.content_sign === 'same-sign')).toBe(true)
    })

    it('should not return disabled records', () => {
      repo.insertBatch([
        createTestRecord({ path: '/a.txt', content_sign: 'test-sign' })
      ])

      // 手动禁用记录
      dbService.getDb().prepare('UPDATE data_distributing SET disable = 1 WHERE content_sign = ?').run('test-sign')

      const results = repo.getByContentSign('test-sign')
      expect(results.length).toBe(0)
    })

    it('should return empty array when no match', () => {
      const results = repo.getByContentSign('non-existent')
      expect(results).toEqual([])
    })
  })

  describe('count', () => {
    it('should return correct count', () => {
      expect(repo.count()).toBe(0)

      repo.insertBatch([
        createTestRecord({ path: '/a.txt' }),
        createTestRecord({ path: '/b.txt' }),
        createTestRecord({ path: '/c.txt' })
      ])

      expect(repo.count()).toBe(3)
    })

    it('should not count disabled records', () => {
      repo.insertBatch([createTestRecord()])

      dbService.getDb().prepare('UPDATE data_distributing SET disable = 1').run()

      expect(repo.count()).toBe(0)
    })
  })

  describe('data integrity', () => {
    it('should store all fields correctly', () => {
      const now = new Date().toISOString()
      const record = createTestRecord({
        path: '/test/document.pdf',
        data_type: 1,
        content_sign: 'md5hash123',
        file_suffix: '.pdf',
        file_magic: 'PDF-1.4',
        file_create_time: now,
        file_update_time: now,
        file_read_time: now,
        file_size: 2048,
        file_hide: 1,
        ip: '10.0.0.1',
        mac_address: '11:22:33:44:55:66',
        parent_id: 5,
        scan_time: now
      })

      repo.insertBatch([record])

      const results = repo.getByContentSign('md5hash123')
      expect(results.length).toBe(1)

      const stored = results[0]
      expect(stored.path).toBe('/test/document.pdf')
      expect(stored.data_type).toBe(1)
      expect(stored.content_sign).toBe('md5hash123')
      expect(stored.file_suffix).toBe('.pdf')
      expect(stored.file_magic).toBe('PDF-1.4')
      expect(stored.file_size).toBe(2048)
      expect(stored.file_hide).toBe(1)
      expect(stored.ip).toBe('10.0.0.1')
      expect(stored.mac_address).toBe('11:22:33:44:55:66')
      expect(stored.parent_id).toBe(5)
      expect(stored.scan_found_count).toBe(1)
    })
  })

  describe('performance', () => {
    it('should handle large batch efficiently', () => {
      const records: CreateDataDistributingParams[] = []
      for (let i = 0; i < 1000; i++) {
        records.push(createTestRecord({
          path: `/file${i}.txt`,
          content_sign: `sign${i}`
        }))
      }

      const startTime = Date.now()
      repo.insertBatch(records)
      const endTime = Date.now()

      expect(repo.count()).toBe(1000)
      // 1000条记录应该在合理时间内完成（通常 < 500ms）
      expect(endTime - startTime).toBeLessThan(5000)
    })
  })
})
