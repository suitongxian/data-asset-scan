import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseService } from '../DatabaseService'
import { DataResourcesRepository, CreateDataResourcesParams } from '../DataResourcesRepository'
import { DataDistributingRepository, CreateDataDistributingParams } from '../DataDistributingRepository'

describe('DataResourcesRepository - Sync Methods', () => {
  let testDir: string
  let sqlPath: string
  let dbPath: string
  let dbService: DatabaseService
  let resourceRepo: DataResourcesRepository
  let distributingRepo: DataDistributingRepository

  beforeAll(async () => {
    testDir = path.join(os.tmpdir(), `data-resources-sync-test-${Date.now()}`)
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
    resourceRepo = new DataResourcesRepository(dbService.getDb(), 10)
    distributingRepo = new DataDistributingRepository(dbService.getDb(), 10)
  })

  afterEach(() => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('getPendingSyncRecords', () => {
    it('should return records with local IP and MAC addresses', () => {
      // 插入 data_resources 记录
      const resourcesRecords: CreateDataResourcesParams[] = [
        {
          content_sign: 'abc123',
          source_count: 10,
          workspace_source_count: 5,
          first_create_time: '2024-01-01T00:00:00.000Z'
        },
        {
          content_sign: 'def456',
          source_count: 5,
          workspace_source_count: 2,
          first_create_time: '2024-01-01T00:00:00.000Z'
        }
      ]
      resourceRepo.insertBatch(resourcesRecords)

      const records = resourceRepo.getPendingSyncRecords()

      expect(records.length).toBe(2)
      expect(records[0].content_sign).toBe('abc123')
      expect(records[0].source_count).toBe(10)
      // IP 和 MAC 应该是本机的，而不是从 data_distributing 获取的
      expect(records[0].source_ip).toBeDefined()
      expect(records[0].source_mac).toBeDefined()

      expect(records[1].content_sign).toBe('def456')
      expect(records[1].source_count).toBe(5)
      // 同一次查询，所有记录的 IP 和 MAC 应该相同（都是本机的）
      expect(records[1].source_ip).toBe(records[0].source_ip)
      expect(records[1].source_mac).toBe(records[0].source_mac)
    })

    it('should filter records by update_time since parameter', async () => {
      // 插入第一条记录
      resourceRepo.insertBatch([
        {
          content_sign: 'abc123',
          source_count: 10,
          workspace_source_count: 5,
          first_create_time: '2024-01-01T00:00:00.000Z'
        }
      ])

      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 20))

      // 插入第二条记录
      resourceRepo.insertBatch([
        {
          content_sign: 'def456',
          source_count: 5,
          workspace_source_count: 2,
          first_create_time: '2024-01-01T00:00:00.000Z'
        }
      ])

      // 获取第一条记录的 update_time
      const firstRecord = resourceRepo.getByContentSign('abc123')
      const sinceTime = firstRecord!.update_time

      // 使用 sinceTime 过滤，应该只返回第二条记录
      const records = resourceRepo.getPendingSyncRecords(sinceTime)

      expect(records.length).toBe(1)
      expect(records[0].content_sign).toBe('def456')
    })

    it('should support limit and offset for pagination', () => {
      const resourceRecords: CreateDataResourcesParams[] = []

      // 创建 150 条记录
      for (let i = 1; i <= 150; i++) {
        resourceRecords.push({
          content_sign: `hash${i}`,
          source_count: i,
          workspace_source_count: 0,
          first_create_time: '2024-01-01T00:00:00.000Z'
        })
      }

      resourceRepo.insertBatch(resourceRecords)

      // 获取第一页
      const page1 = resourceRepo.getPendingSyncRecords(null, 100, 0)
      expect(page1.length).toBe(100)

      // 获取第二页
      const page2 = resourceRepo.getPendingSyncRecords(null, 100, 100)
      expect(page2.length).toBe(50)

      // 获取第三页（空）
      const page3 = resourceRepo.getPendingSyncRecords(null, 100, 200)
      expect(page3.length).toBe(0)
    })

    it('should always return local IP and MAC for all records', () => {
      // 只插入 data_resources 记录
      resourceRepo.insertBatch([
        {
          content_sign: 'abc123',
          source_count: 10,
          workspace_source_count: 5,
          first_create_time: '2024-01-01T00:00:00.000Z'
        }
      ])

      const records = resourceRepo.getPendingSyncRecords()

      expect(records.length).toBe(1)
      expect(records[0].content_sign).toBe('abc123')
      // IP 和 MAC 应该是本机的值，不为 null
      expect(records[0].source_ip).toBeDefined()
      expect(records[0].source_mac).toBeDefined()
      expect(records[0].source_ip).not.toBeNull()
      expect(records[0].source_mac).not.toBeNull()
    })

    it('should return empty array when no records exist', () => {
      const records = resourceRepo.getPendingSyncRecords()
      expect(records).toEqual([])
    })

    it('should not return disabled records', () => {
      // 插入记录
      resourceRepo.insertBatch([
        {
          content_sign: 'abc123',
          source_count: 10,
          workspace_source_count: 5,
          first_create_time: '2024-01-01T00:00:00.000Z'
        }
      ])

      // 逻辑删除记录
      dbService.getDb().prepare(`
        UPDATE data_resources SET disable = 1 WHERE content_sign = 'abc123'
      `).run()

      const records = resourceRepo.getPendingSyncRecords()
      expect(records).toEqual([])
    })

    it('should return additional fields for sync API', () => {
      // 插入 data_resources 记录，包含所有同步需要的字段
      resourceRepo.insertBatch([
        {
          content_sign: 'sync123',
          source_count: 10,
          workspace_source_count: 5,
          first_create_time: '2024-01-01T10:00:00.000Z',
          content_subject: 'file',
          content_type: 'pdf',
          file_magic: '25504446'
        }
      ])

      // 更新 claim_status, claim_time, importance_level, data_share
      dbService.getDb().prepare(`
        UPDATE data_resources
        SET claim_status = 1,
            claim_time = '2024-01-02T12:00:00.000Z',
            importance_level = 2,
            data_share = '0'
        WHERE content_sign = 'sync123'
      `).run()

      const records = resourceRepo.getPendingSyncRecords()

      expect(records.length).toBe(1)
      const record = records[0]

      // 验证基础字段
      expect(record.content_sign).toBe('sync123')
      expect(record.source_count).toBe(10)
      expect(record.source_ip).toBeDefined()
      expect(record.source_mac).toBeDefined()

      // 验证新增的同步字段
      expect(record.first_create_time).toBe('2024-01-01T10:00:00.000Z')
      expect(record.content_subject).toBe('file')
      expect(record.content_type).toBe('pdf')
      expect(record.file_magic).toBe('25504446')
      expect(record.claim_status).toBe(1)
      expect(record.claim_time).toBe('2024-01-02T12:00:00.000Z')
      expect(record.importance_level).toBe(2)
      expect(record.data_share).toBe('0')
    })

    it('should return null for optional fields when not set', () => {
      // 插入 data_resources 记录，只有必填字段
      resourceRepo.insertBatch([
        {
          content_sign: 'simple123',
          source_count: 3,
          workspace_source_count: 1,
          first_create_time: '2024-01-01T00:00:00.000Z'
        }
      ])

      const records = resourceRepo.getPendingSyncRecords()

      expect(records.length).toBe(1)
      const record = records[0]

      // 验证必填字段
      expect(record.content_sign).toBe('simple123')
      expect(record.source_count).toBe(3)
      expect(record.first_create_time).toBe('2024-01-01T00:00:00.000Z')

      // 验证可选字段为 null
      expect(record.content_subject).toBeNull()
      expect(record.content_type).toBeNull()
      expect(record.file_magic).toBeNull()
      expect(record.claim_status).toBe(0) // 默认值
      expect(record.claim_time).toBeNull()
      expect(record.importance_level).toBe(0) // 默认值
      expect(record.data_share).toBeNull()
    })
  })

  describe('countPendingSyncRecords', () => {
    it('should count all records when sinceTime is null', () => {
      resourceRepo.insertBatch([
        {
          content_sign: 'abc123',
          source_count: 10,
          workspace_source_count: 5,
          first_create_time: '2024-01-01T00:00:00.000Z'
        },
        {
          content_sign: 'def456',
          source_count: 5,
          workspace_source_count: 2,
          first_create_time: '2024-01-01T00:00:00.000Z'
        },
        {
          content_sign: 'ghi789',
          source_count: 3,
          workspace_source_count: 1,
          first_create_time: '2024-01-01T00:00:00.000Z'
        }
      ])

      const count = resourceRepo.countPendingSyncRecords()
      expect(count).toBe(3)
    })

    it('should count only records with update_time after sinceTime', async () => {
      // 插入第一条记录
      resourceRepo.insertBatch([
        {
          content_sign: 'abc123',
          source_count: 10,
          workspace_source_count: 5,
          first_create_time: '2024-01-01T00:00:00.000Z'
        }
      ])

      // 获取第一条记录的 update_time
      const firstRecord = resourceRepo.getByContentSign('abc123')
      const sinceTime = firstRecord!.update_time

      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 20))

      // 插入两条新记录
      resourceRepo.insertBatch([
        {
          content_sign: 'def456',
          source_count: 5,
          workspace_source_count: 2,
          first_create_time: '2024-01-01T00:00:00.000Z'
        },
        {
          content_sign: 'ghi789',
          source_count: 3,
          workspace_source_count: 1,
          first_create_time: '2024-01-01T00:00:00.000Z'
        }
      ])

      const count = resourceRepo.countPendingSyncRecords(sinceTime)
      expect(count).toBe(2)
    })

    it('should count zero when no records exist', () => {
      const count = resourceRepo.countPendingSyncRecords()
      expect(count).toBe(0)
    })

    it('should not count disabled records', () => {
      resourceRepo.insertBatch([
        {
          content_sign: 'abc123',
          source_count: 10,
          workspace_source_count: 5,
          first_create_time: '2024-01-01T00:00:00.000Z'
        }
      ])

      // 逻辑删除记录
      dbService.getDb().prepare(`
        UPDATE data_resources SET disable = 1 WHERE content_sign = 'abc123'
      `).run()

      const count = resourceRepo.countPendingSyncRecords()
      expect(count).toBe(0)
    })
  })
})
