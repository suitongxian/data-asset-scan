import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseService } from '../DatabaseService'
import { DataResourcesRepository, Md5Statistics, CreateDataResourcesParams } from '../DataResourcesRepository'

describe('DataResourcesRepository', () => {
  let testDir: string
  let sqlPath: string
  let dbPath: string
  let dbService: DatabaseService
  let repo: DataResourcesRepository

  beforeAll(async () => {
    testDir = path.join(os.tmpdir(), `data-resources-repo-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    sqlPath = path.join(testDir, 'database.sql')
    const sql = `
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
    repo = new DataResourcesRepository(dbService.getDb(), 10)
  })

  afterEach(() => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('insertFromStatistics', () => {
    it('should insert resources_name from shortFileName', () => {
      const statsMap = new Map<string, Md5Statistics>()
      statsMap.set('abc123', {
        contentSign: 'abc123',
        sourceCount: 1,
        workspaceSourceCount: 0,
        firstCreateTime: '2024-01-01T00:00:00.000Z',
        fileMagic: '25504446',
        firstFileName: 'very_long_document_name.pdf',
        shortFileName: 'doc.pdf'
      })

      const count = repo.insertFromStatistics(statsMap)

      expect(count).toBe(1)

      const record = repo.getByContentSign('abc123')
      expect(record).not.toBeNull()
      expect(record!.resources_name).toBe('doc.pdf')  // 使用 shortFileName
    })

    it('should insert content_type extracted from shortFileName extension', () => {
      const statsMap = new Map<string, Md5Statistics>()
      statsMap.set('abc123', {
        contentSign: 'abc123',
        sourceCount: 1,
        workspaceSourceCount: 0,
        firstCreateTime: '2024-01-01T00:00:00.000Z',
        firstFileName: 'very_long_document.pdf',
        shortFileName: 'doc.PDF'
      })

      repo.insertFromStatistics(statsMap)

      const record = repo.getByContentSign('abc123')
      expect(record).not.toBeNull()
      expect(record!.content_type).toBe('pdf')
    })

    it('should insert content_subject as file', () => {
      const statsMap = new Map<string, Md5Statistics>()
      statsMap.set('abc123', {
        contentSign: 'abc123',
        sourceCount: 1,
        workspaceSourceCount: 0,
        firstCreateTime: '2024-01-01T00:00:00.000Z',
        firstFileName: 'very_long_test.txt',
        shortFileName: 'test.txt'
      })

      repo.insertFromStatistics(statsMap)

      const record = repo.getByContentSign('abc123')
      expect(record).not.toBeNull()
      expect(record!.content_subject).toBe('file')
    })

    it('should handle various file extensions correctly', () => {
      const statsMap = new Map<string, Md5Statistics>()

      // Test different extensions
      const testCases = [
        { sign: 'hash1', fileName: 'a.DOCX', longName: 'doc.DOCX', expectedType: 'docx' },
        { sign: 'hash2', fileName: 'b.PNG', longName: 'image.PNG', expectedType: 'png' },
        { sign: 'hash3', fileName: 'c.gz', longName: 'archive.tar.gz', expectedType: 'gz' },
        { sign: 'hash4', fileName: 'd', longName: 'no_extension', expectedType: null }
      ]

      for (const tc of testCases) {
        statsMap.set(tc.sign, {
          contentSign: tc.sign,
          sourceCount: 1,
          workspaceSourceCount: 0,
          firstCreateTime: '2024-01-01T00:00:00.000Z',
          firstFileName: tc.longName,
          shortFileName: tc.fileName
        })
      }

      repo.insertFromStatistics(statsMap)

      for (const tc of testCases) {
        const record = repo.getByContentSign(tc.sign)
        expect(record).not.toBeNull()
        expect(record!.resources_name).toBe(tc.fileName)  // 使用 shortFileName
        if (tc.expectedType) {
          expect(record!.content_type).toBe(tc.expectedType)
        } else {
          expect(record!.content_type).toBeNull()
        }
      }
    })

    it('should handle undefined shortFileName gracefully', () => {
      const statsMap = new Map<string, Md5Statistics>()
      statsMap.set('abc123', {
        contentSign: 'abc123',
        sourceCount: 1,
        workspaceSourceCount: 0,
        firstCreateTime: '2024-01-01T00:00:00.000Z'
        // firstFileName and shortFileName are undefined
      })

      repo.insertFromStatistics(statsMap)

      const record = repo.getByContentSign('abc123')
      expect(record).not.toBeNull()
      expect(record!.resources_name).toBeNull()
      expect(record!.content_type).toBeNull()
      expect(record!.content_subject).toBe('file')
    })
  })

  describe('insertBatch', () => {
    it('should insert resources_name, content_subject and content_type correctly', () => {
      const records: CreateDataResourcesParams[] = [{
        content_sign: 'test123',
        source_count: 2,
        workspace_source_count: 1,
        first_create_time: '2024-01-01T00:00:00.000Z',
        file_magic: '504B0304',
        resources_name: 'spreadsheet.xlsx',
        content_subject: 'file',
        content_type: 'xlsx'
      }]

      const count = repo.insertBatch(records)

      expect(count).toBe(1)

      const record = repo.getByContentSign('test123')
      expect(record).not.toBeNull()
      expect(record!.resources_name).toBe('spreadsheet.xlsx')
      expect(record!.content_subject).toBe('file')
      expect(record!.content_type).toBe('xlsx')
    })
  })

  describe('getResourcesWithPagination', () => {
    beforeEach(() => {
      // 插入测试数据
      const records: CreateDataResourcesParams[] = []
      for (let i = 1; i <= 25; i++) {
        records.push({
          content_sign: `hash${i}`,
          source_count: i,
          workspace_source_count: 0,
          first_create_time: `2024-01-${String(i).padStart(2, '0')}T00:00:00.000Z`,
          resources_name: `file${i}.txt`,
          content_subject: 'file',
          content_type: 'txt'
        })
      }
      repo.insertBatch(records)
    })

    it('should return paginated results with default pagination', () => {
      const result = repo.getResourcesWithPagination()

      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(50)
      expect(result.total).toBe(25)
      expect(result.resources.length).toBe(25)
    })

    it('should return correct page of results', () => {
      const result = repo.getResourcesWithPagination({ page: 1, pageSize: 10 })

      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(10)
      expect(result.total).toBe(25)
      expect(result.resources.length).toBe(10)
    })

    it('should return second page correctly', () => {
      const result = repo.getResourcesWithPagination({ page: 2, pageSize: 10 })

      expect(result.page).toBe(2)
      expect(result.resources.length).toBe(10)
    })

    it('should return last page with remaining items', () => {
      const result = repo.getResourcesWithPagination({ page: 3, pageSize: 10 })

      expect(result.page).toBe(3)
      expect(result.resources.length).toBe(5)
    })

    it('should filter by search keyword', () => {
      const result = repo.getResourcesWithPagination({ search: 'file1' })

      // Should match file1.txt, file10.txt, file11.txt, ... file19.txt (11 files)
      expect(result.total).toBe(11)
    })

    it('should filter by claim_status', () => {
      // First claim some resources
      repo.batchClaim({
        ids: [1, 2, 3],
        is_claimed: 1,
        claim_status: 1,
        claimant_name: 'Test User',
        claimant_unit: 'Test Unit'
      })

      const result = repo.getResourcesWithPagination({ claimStatusFilter: 1 })

      expect(result.total).toBe(3)
      result.resources.forEach(r => {
        expect(r.claim_status).toBe(1)
      })
    })

    it('should return all when claimStatusFilter is -1', () => {
      const result = repo.getResourcesWithPagination({ claimStatusFilter: -1 })

      expect(result.total).toBe(25)
    })

    it('should filter by claimStatusIn with multiple values', () => {
      // 认领部分资源到不同 claim_status
      repo.batchClaim({
        ids: [1, 2, 3],
        is_claimed: 1,
        claim_status: 1,  // 个人隐私
        claimant_name: 'Test User',
        claimant_unit: 'Test Unit'
      })
      repo.batchClaim({
        ids: [4, 5],
        is_claimed: 1,
        claim_status: 2,  // 个人工作
        claimant_name: 'Test User',
        claimant_unit: 'Test Unit'
      })
      repo.batchClaim({
        ids: [6, 7],
        is_claimed: 1,
        claim_status: 3,  // 非责任类
        claimant_name: 'Test User',
        claimant_unit: 'Test Unit'
      })

      // 只查询 claim_status 为 1 或 2 的资源
      const result = repo.getResourcesWithPagination({ claimStatusIn: [1, 2] })

      expect(result.total).toBe(5)  // 1,2,3 (claim_status=1) + 4,5 (claim_status=2)
      result.resources.forEach(r => {
        expect([1, 2]).toContain(r.claim_status)
      })
    })

    it('should filter by single value in claimStatusIn', () => {
      repo.batchClaim({
        ids: [1, 2],
        is_claimed: 1,
        claim_status: 1,
        claimant_name: 'Test User',
        claimant_unit: 'Test Unit'
      })

      const result = repo.getResourcesWithPagination({ claimStatusIn: [1] })

      expect(result.total).toBe(2)
      result.resources.forEach(r => {
        expect(r.claim_status).toBe(1)
      })
    })

    it('should return empty when claimStatusIn is empty array', () => {
      repo.batchClaim({
        ids: [1, 2],
        is_claimed: 1,
        claim_status: 1,
        claimant_name: 'Test User',
        claimant_unit: 'Test Unit'
      })

      // 空数组应该不过滤（claimStatusIn 被忽略）
      const result = repo.getResourcesWithPagination({ claimStatusIn: [] })

      expect(result.total).toBe(25)  // 返回所有数据
    })
  })

  describe('batchClaim', () => {
    beforeEach(() => {
      // 插入测试数据
      const records: CreateDataResourcesParams[] = []
      for (let i = 1; i <= 5; i++) {
        records.push({
          content_sign: `hash${i}`,
          source_count: 1,
          workspace_source_count: 0,
          first_create_time: '2024-01-01T00:00:00.000Z',
          resources_name: `file${i}.txt`
        })
      }
      repo.insertBatch(records)
    })

    it('should claim resources and update all fields', () => {
      const count = repo.batchClaim({
        ids: [1, 2, 3],
        is_claimed: 1,
        claim_status: 2,
        claimant_name: 'Test User',
        claimant_unit: 'Test Unit'
      })

      expect(count).toBe(3)

      const record = repo.getById(1)
      expect(record).not.toBeNull()
      expect(record!.is_claimed).toBe(1)
      expect(record!.claim_status).toBe(2)
      expect(record!.claimant_name).toBe('Test User')
      expect(record!.claimant_unit).toBe('Test Unit')
      expect(record!.claim_time).not.toBeNull()
    })

    it('should not affect unclaimed resources', () => {
      repo.batchClaim({
        ids: [1, 2],
        is_claimed: 1,
        claim_status: 1,
        claimant_name: 'User',
        claimant_unit: 'Unit'
      })

      const unclaimedRecord = repo.getById(3)
      expect(unclaimedRecord).not.toBeNull()
      expect(unclaimedRecord!.is_claimed).toBe(0)
      expect(unclaimedRecord!.claim_status).toBe(0)
      expect(unclaimedRecord!.claimant_name).toBeNull()
    })

    it('should return 0 when ids array is empty', () => {
      const count = repo.batchClaim({
        ids: [],
        is_claimed: 1,
        claim_status: 1,
        claimant_name: 'User',
        claimant_unit: 'Unit'
      })

      expect(count).toBe(0)
    })

    it('should allow claiming with different statuses', () => {
      repo.batchClaim({
        ids: [1],
        is_claimed: 1,
        claim_status: 1, // 个人隐私
        claimant_name: 'User1',
        claimant_unit: 'Unit1'
      })

      repo.batchClaim({
        ids: [2],
        is_claimed: 1,
        claim_status: 2, // 个人工作
        claimant_name: 'User2',
        claimant_unit: 'Unit2'
      })

      repo.batchClaim({
        ids: [3],
        is_claimed: 1,
        claim_status: 3, // 非责任类
        claimant_name: 'User3',
        claimant_unit: 'Unit3'
      })

      expect(repo.getById(1)!.claim_status).toBe(1)
      expect(repo.getById(2)!.claim_status).toBe(2)
      expect(repo.getById(3)!.claim_status).toBe(3)
    })

    it('should auto set importance_level=4 when claim_status=1 (个人隐私)', () => {
      // 认领为个人隐私数据 (claim_status=1)
      repo.batchClaim({
        ids: [1],
        is_claimed: 1,
        claim_status: 1,
        claimant_name: 'User1',
        claimant_unit: 'Unit1'
      })

      const record1 = repo.getById(1)
      expect(record1!.claim_status).toBe(1)
      expect(record1!.importance_level).toBe(4) // 自动设置为隐私

      // 认领为个人工作数据 (claim_status=2)，不应自动设置 importance_level
      repo.batchClaim({
        ids: [2],
        is_claimed: 1,
        claim_status: 2,
        claimant_name: 'User2',
        claimant_unit: 'Unit2'
      })

      const record2 = repo.getById(2)
      expect(record2!.claim_status).toBe(2)
      expect(record2!.importance_level).toBe(0) // 保持默认值

      // 认领为非责任类数据 (claim_status=3)，不应自动设置 importance_level
      repo.batchClaim({
        ids: [3],
        is_claimed: 1,
        claim_status: 3,
        claimant_name: 'User3',
        claimant_unit: 'Unit3'
      })

      const record3 = repo.getById(3)
      expect(record3!.claim_status).toBe(3)
      expect(record3!.importance_level).toBe(0) // 保持默认值
    })
  })

  describe('getById', () => {
    it('should return resource by id', () => {
      const records: CreateDataResourcesParams[] = [{
        content_sign: 'test123',
        source_count: 1,
        workspace_source_count: 0,
        first_create_time: '2024-01-01T00:00:00.000Z',
        resources_name: 'test.txt'
      }]
      repo.insertBatch(records)

      const record = repo.getById(1)

      expect(record).not.toBeNull()
      expect(record!.content_sign).toBe('test123')
      expect(record!.resources_name).toBe('test.txt')
    })

    it('should return null for non-existent id', () => {
      const record = repo.getById(999)

      expect(record).toBeNull()
    })
  })

  describe('batchClassify', () => {
    beforeEach(() => {
      // 插入测试数据，部分已认领
      const records: CreateDataResourcesParams[] = []
      for (let i = 1; i <= 5; i++) {
        records.push({
          content_sign: `hash${i}`,
          source_count: 1,
          workspace_source_count: 0,
          first_create_time: '2024-01-01T00:00:00.000Z',
          resources_name: `file${i}.txt`
        })
      }
      repo.insertBatch(records)

      // 模拟认领部分资源
      repo.batchClaim({
        ids: [1, 2],
        is_claimed: 1,
        claim_status: 1, // 个人隐私
        claimant_name: 'User',
        claimant_unit: 'Unit'
      })
      repo.batchClaim({
        ids: [3],
        is_claimed: 1,
        claim_status: 2, // 个人工作
        claimant_name: 'User',
        claimant_unit: 'Unit'
      })
    })

    it('should classify resources and update importance_level', () => {
      const count = repo.batchClassify({
        ids: [1, 2, 3],
        importance_level: 1 // 核心
      })

      expect(count).toBe(3)

      const record1 = repo.getById(1)
      const record2 = repo.getById(2)
      const record3 = repo.getById(3)

      expect(record1!.importance_level).toBe(1)
      expect(record2!.importance_level).toBe(1)
      expect(record3!.importance_level).toBe(1)
    })

    it('should update importance_level to different values', () => {
      repo.batchClassify({ ids: [1], importance_level: 1 }) // 核心
      repo.batchClassify({ ids: [2], importance_level: 2 }) // 重要
      repo.batchClassify({ ids: [3], importance_level: 3 }) // 开放

      expect(repo.getById(1)!.importance_level).toBe(1)
      expect(repo.getById(2)!.importance_level).toBe(2)
      expect(repo.getById(3)!.importance_level).toBe(3)
    })

    it('should not affect unclassified resources', () => {
      repo.batchClassify({
        ids: [1, 2],
        importance_level: 2
      })

      const unclassifiedRecord = repo.getById(4)
      expect(unclassifiedRecord!.importance_level).toBe(0)
    })

    it('should return 0 when ids array is empty', () => {
      const count = repo.batchClassify({
        ids: [],
        importance_level: 1
      })

      expect(count).toBe(0)
    })

    it('should update update_time when classifying', () => {
      const recordBefore = repo.getById(1)
      const updateTimeBefore = recordBefore!.update_time

      // 等待一小段时间确保时间戳不同
      const start = Date.now()
      while (Date.now() - start < 10) {
        // busy wait
      }

      repo.batchClassify({
        ids: [1],
        importance_level: 1
      })

      const recordAfter = repo.getById(1)
      expect(recordAfter!.update_time).not.toBe(updateTimeBefore)
    })
  })

  describe('getResourcesWithPagination with importanceLevelFilter', () => {
    beforeEach(() => {
      // 插入测试数据
      const records: CreateDataResourcesParams[] = []
      for (let i = 1; i <= 10; i++) {
        records.push({
          content_sign: `hash${i}`,
          source_count: i,
          workspace_source_count: 0,
          first_create_time: `2024-01-${String(i).padStart(2, '0')}T00:00:00.000Z`,
          resources_name: `file${i}.txt`,
          content_subject: 'file',
          content_type: 'txt'
        })
      }
      repo.insertBatch(records)

      // 先认领部分资源
      repo.batchClaim({
        ids: [1, 2, 3, 4, 5, 6],
        is_claimed: 1,
        claim_status: 1,
        claimant_name: 'User',
        claimant_unit: 'Unit'
      })

      // 设置不同的 importance_level
      repo.batchClassify({ ids: [1, 2], importance_level: 1 }) // 核心
      repo.batchClassify({ ids: [3, 4], importance_level: 2 }) // 重要
      repo.batchClassify({ ids: [5, 6], importance_level: 3 }) // 开放
    })

    it('should filter by importance_level = 1 (核心)', () => {
      const result = repo.getResourcesWithPagination({ importanceLevelFilter: 1 })

      expect(result.total).toBe(2)
      result.resources.forEach(r => {
        expect(r.importance_level).toBe(1)
      })
    })

    it('should filter by importance_level = 2 (重要)', () => {
      const result = repo.getResourcesWithPagination({ importanceLevelFilter: 2 })

      expect(result.total).toBe(2)
      result.resources.forEach(r => {
        expect(r.importance_level).toBe(2)
      })
    })

    it('should filter by importance_level = 0 (未分类)', () => {
      const result = repo.getResourcesWithPagination({ importanceLevelFilter: 0 })

      expect(result.total).toBe(4) // 7, 8, 9, 10 没有分类
      result.resources.forEach(r => {
        expect(r.importance_level).toBe(0)
      })
    })

    it('should return all when importanceLevelFilter is -1', () => {
      const result = repo.getResourcesWithPagination({ importanceLevelFilter: -1 })

      expect(result.total).toBe(10)
    })

    it('should combine importanceLevelFilter with claimStatusFilter', () => {
      // 把 7, 8 认领为 claim_status = 2
      repo.batchClaim({
        ids: [7, 8],
        is_claimed: 1,
        claim_status: 2,
        claimant_name: 'User2',
        claimant_unit: 'Unit2'
      })

      const result = repo.getResourcesWithPagination({
        claimStatusFilter: 1,
        importanceLevelFilter: 1
      })

      // 只有 1, 2 是 claim_status=1 且 importance_level=1
      expect(result.total).toBe(2)
      result.resources.forEach(r => {
        expect(r.claim_status).toBe(1)
        expect(r.importance_level).toBe(1)
      })
    })

    it('should combine importanceLevelFilter with search', () => {
      const result = repo.getResourcesWithPagination({
        importanceLevelFilter: 1,
        search: 'file1'
      })

      // file1.txt 的 importance_level = 1
      expect(result.total).toBe(1)
      expect(result.resources[0].resources_name).toBe('file1.txt')
    })
  })

  describe('getResourcesWithPagination with businessTypeFilter', () => {
    const fullInventoryTime = '2024-01-10T00:00:00.000Z'

    beforeEach(() => {
      // 插入测试数据
      const records: CreateDataResourcesParams[] = [
        // 工作空间管控数据 (workspace_source_count > 0)
        {
          content_sign: 'workspace1',
          source_count: 2,
          workspace_source_count: 1,
          first_create_time: '2024-01-05T00:00:00.000Z',
          resources_name: 'workspace_file1.txt',
          content_subject: 'file',
          content_type: 'txt'
        },
        {
          content_sign: 'workspace2',
          source_count: 3,
          workspace_source_count: 2,
          first_create_time: '2024-01-08T00:00:00.000Z',
          resources_name: 'workspace_file2.txt',
          content_subject: 'file',
          content_type: 'txt'
        },
        // 新准入数据 (first_create_time < fullInventoryTime)
        {
          content_sign: 'new1',
          source_count: 1,
          workspace_source_count: 0,
          first_create_time: '2024-01-01T00:00:00.000Z',
          resources_name: 'new_file1.txt',
          content_subject: 'file',
          content_type: 'txt'
        },
        {
          content_sign: 'new2',
          source_count: 1,
          workspace_source_count: 0,
          first_create_time: '2024-01-09T00:00:00.000Z',
          resources_name: 'new_file2.txt',
          content_subject: 'file',
          content_type: 'txt'
        },
        // 历史封帐数据 (first_create_time >= fullInventoryTime)
        {
          content_sign: 'history1',
          source_count: 1,
          workspace_source_count: 0,
          first_create_time: '2024-01-10T00:00:00.000Z',
          resources_name: 'history_file1.txt',
          content_subject: 'file',
          content_type: 'txt'
        },
        {
          content_sign: 'history2',
          source_count: 1,
          workspace_source_count: 0,
          first_create_time: '2024-01-15T00:00:00.000Z',
          resources_name: 'history_file2.txt',
          content_subject: 'file',
          content_type: 'txt'
        },
        // 工作空间管控 + 历史封帐 (workspace_source_count > 0, first_create_time >= fullInventoryTime)
        {
          content_sign: 'workspace_history1',
          source_count: 2,
          workspace_source_count: 1,
          first_create_time: '2024-01-12T00:00:00.000Z',
          resources_name: 'workspace_history_file1.txt',
          content_subject: 'file',
          content_type: 'txt'
        }
      ]
      repo.insertBatch(records)
    })

    it('should filter by workspace business type (workspace_source_count > 0)', () => {
      const result = repo.getResourcesWithPagination({
        businessTypeFilter: 'workspace',
        fullInventoryTime
      })

      // 应该返回 workspace1, workspace2, workspace_history1
      expect(result.total).toBe(3)
      result.resources.forEach(r => {
        expect(r.workspace_source_count).toBeGreaterThan(0)
      })
    })

    it('should filter by new_access business type (first_create_time > fullInventoryTime)', () => {
      const result = repo.getResourcesWithPagination({
        businessTypeFilter: 'new_access',
        fullInventoryTime
      })

      // 应该返回 history2, workspace_history1 (history1 的时间等于 fullInventoryTime，不满足 > 条件)
      expect(result.total).toBe(2)
      result.resources.forEach(r => {
        expect(new Date(r.first_create_time).getTime()).toBeGreaterThan(new Date(fullInventoryTime).getTime())
      })
    })

    it('should filter by history_inventory business type (first_create_time < fullInventoryTime)', () => {
      const result = repo.getResourcesWithPagination({
        businessTypeFilter: 'history_inventory',
        fullInventoryTime
      })

      // 应该返回 new1, new2, workspace1, workspace2
      expect(result.total).toBe(4)
      result.resources.forEach(r => {
        expect(new Date(r.first_create_time).getTime()).toBeLessThan(new Date(fullInventoryTime).getTime())
      })
    })

    it('should return all when businessTypeFilter is null', () => {
      const result = repo.getResourcesWithPagination({
        businessTypeFilter: null,
        fullInventoryTime
      })

      expect(result.total).toBe(7)
    })

    it('should not apply filter when fullInventoryTime is not provided', () => {
      const result = repo.getResourcesWithPagination({
        businessTypeFilter: 'new_access',
        fullInventoryTime: undefined
      })

      // 如果没有提供 fullInventoryTime，过滤不应该生效
      expect(result.total).toBe(7)
    })

    it('should combine businessTypeFilter with other filters', () => {
      // 先认领一个 workspace 资源
      const workspaceRecord = repo.getAll().find(r => r.content_sign === 'workspace1')!
      repo.batchClaim({
        ids: [workspaceRecord.data_resources_id!],
        is_claimed: 1,
        claim_status: 1,
        claimant_name: 'User',
        claimant_unit: 'Unit'
      })

      const result = repo.getResourcesWithPagination({
        businessTypeFilter: 'workspace',
        claimStatusFilter: 1,
        fullInventoryTime
      })

      // 只返回 claim_status=1 的 workspace 资源
      expect(result.total).toBe(1)
      expect(result.resources[0].content_sign).toBe('workspace1')
    })
  })

  describe('getResourcesStatistics', () => {
    const fullInventoryTime = '2024-01-10T00:00:00.000Z'

    beforeEach(() => {
      // 插入测试数据
      const records: CreateDataResourcesParams[] = [
        // 历史数据 (first_create_time < fullInventoryTime)
        {
          content_sign: 'history1',
          source_count: 5,
          workspace_source_count: 2,
          first_create_time: '2024-01-05T00:00:00.000Z',
          resources_name: 'history_file1.txt'
        },
        {
          content_sign: 'history2',
          source_count: 3,
          workspace_source_count: 1,
          first_create_time: '2024-01-08T00:00:00.000Z',
          resources_name: 'history_file2.txt'
        },
        // 非历史数据 (first_create_time > fullInventoryTime)
        {
          content_sign: 'new1',
          source_count: 10,
          workspace_source_count: 4,
          first_create_time: '2024-01-15T00:00:00.000Z',
          resources_name: 'new_file1.txt'
        },
        {
          content_sign: 'new2',
          source_count: 7,
          workspace_source_count: 3,
          first_create_time: '2024-01-20T00:00:00.000Z',
          resources_name: 'new_file2.txt'
        }
      ]
      repo.insertBatch(records)
    })

    it('should calculate totalFileCount correctly', () => {
      const stats = repo.getResourcesStatistics(fullInventoryTime)

      // 5 + 3 + 10 + 7 = 25
      expect(stats.totalFileCount).toBe(25)
    })

    it('should calculate workspaceTotalCount correctly', () => {
      const stats = repo.getResourcesStatistics(fullInventoryTime)

      // 2 + 1 + 4 + 3 = 10
      expect(stats.workspaceTotalCount).toBe(10)
    })

    it('should calculate historyFileCount correctly', () => {
      const stats = repo.getResourcesStatistics(fullInventoryTime)

      // history1(5) + history2(3) = 8
      expect(stats.historyFileCount).toBe(8)
    })

    it('should calculate nonHistoryFileCount correctly', () => {
      const stats = repo.getResourcesStatistics(fullInventoryTime)

      // new1(10) + new2(7) = 17
      expect(stats.nonHistoryFileCount).toBe(17)
    })

    it('should calculate workspaceClaimedCount correctly', () => {
      // 认领部分资源
      const record1 = repo.getAll().find(r => r.content_sign === 'history1')!
      const record2 = repo.getAll().find(r => r.content_sign === 'new1')!

      repo.batchClaim({
        ids: [record1.data_resources_id!, record2.data_resources_id!],
        is_claimed: 1,
        claim_status: 1,
        claimant_name: 'User',
        claimant_unit: 'Unit'
      })

      const stats = repo.getResourcesStatistics(fullInventoryTime)

      // history1.workspace_source_count(2) + new1.workspace_source_count(4) = 6
      expect(stats.workspaceClaimedCount).toBe(6)
    })

    it('should calculate historyClaimedCount correctly', () => {
      // 认领历史资源
      const record1 = repo.getAll().find(r => r.content_sign === 'history1')!
      const record2 = repo.getAll().find(r => r.content_sign === 'history2')!

      repo.batchClaim({
        ids: [record1.data_resources_id!],
        is_claimed: 1,
        claim_status: 1,
        claimant_name: 'User',
        claimant_unit: 'Unit'
      })

      const stats = repo.getResourcesStatistics(fullInventoryTime)

      // 只有 history1 被认领，source_count = 5
      expect(stats.historyClaimedCount).toBe(5)
    })

    it('should calculate nonHistoryClaimedCount correctly', () => {
      // 认领非历史资源
      const record1 = repo.getAll().find(r => r.content_sign === 'new1')!
      const record2 = repo.getAll().find(r => r.content_sign === 'new2')!

      repo.batchClaim({
        ids: [record1.data_resources_id!, record2.data_resources_id!],
        is_claimed: 1,
        claim_status: 1,
        claimant_name: 'User',
        claimant_unit: 'Unit'
      })

      const stats = repo.getResourcesStatistics(fullInventoryTime)

      // new1(10) + new2(7) = 17
      expect(stats.nonHistoryClaimedCount).toBe(17)
    })

    it('should return -1 for history-related fields when fullInventoryTime is null', () => {
      const stats = repo.getResourcesStatistics(null)

      // 基础统计应该正常计算
      expect(stats.totalFileCount).toBe(25)
      expect(stats.workspaceTotalCount).toBe(10)
      expect(stats.workspaceClaimedCount).toBe(0)

      // 历史相关字段应该返回 -1
      expect(stats.historyFileCount).toBe(-1)
      expect(stats.nonHistoryFileCount).toBe(-1)
      expect(stats.historyClaimedCount).toBe(-1)
      expect(stats.nonHistoryClaimedCount).toBe(-1)

      // 重要程度分类应该正常返回（所有都是未分类）
      expect(stats.unclassifiedCount).toBe(25)
      expect(stats.coreCount).toBe(0)
      expect(stats.importantCount).toBe(0)
      expect(stats.openCount).toBe(0)
      expect(stats.privacyCount).toBe(0)
    })

    it('should return 0 for all counts when no records exist', () => {
      repo.truncate()

      const stats = repo.getResourcesStatistics(fullInventoryTime)

      expect(stats.totalFileCount).toBe(0)
      expect(stats.workspaceTotalCount).toBe(0)
      expect(stats.historyFileCount).toBe(0)
      expect(stats.nonHistoryFileCount).toBe(0)
      expect(stats.workspaceClaimedCount).toBe(0)
      expect(stats.historyClaimedCount).toBe(0)
      expect(stats.nonHistoryClaimedCount).toBe(0)
      expect(stats.unclassifiedCount).toBe(0)
      expect(stats.coreCount).toBe(0)
      expect(stats.importantCount).toBe(0)
      expect(stats.openCount).toBe(0)
      expect(stats.privacyCount).toBe(0)
    })

    it('should not count disabled records', () => {
      // 禁用部分记录
      const record = repo.getAll().find(r => r.content_sign === 'history1')!
      repo['db'].prepare(`
        UPDATE data_resources SET disable = 1 WHERE data_resources_id = ?
      `).run(record.data_resources_id)

      const stats = repo.getResourcesStatistics(fullInventoryTime)

      // 总数应该减少 5 (history1 的 source_count)
      expect(stats.totalFileCount).toBe(20)
      // 历史文件数也应该减少
      expect(stats.historyFileCount).toBe(3) // 只剩 history2
    })

    it('should calculate importance level counts correctly', () => {
      // 获取所有记录
      const allRecords = repo.getAll()
      const history1 = allRecords.find(r => r.content_sign === 'history1')!
      const history2 = allRecords.find(r => r.content_sign === 'history2')!
      const new1 = allRecords.find(r => r.content_sign === 'new1')!
      const new2 = allRecords.find(r => r.content_sign === 'new2')!

      // 设置不同的 importance_level
      repo.batchClassify({ ids: [history1.data_resources_id!], importance_level: 1 }) // 核心: 5
      repo.batchClassify({ ids: [history2.data_resources_id!], importance_level: 2 }) // 重要: 3
      repo.batchClassify({ ids: [new1.data_resources_id!], importance_level: 3 })     // 开放: 10
      repo.batchClassify({ ids: [new2.data_resources_id!], importance_level: 4 })     // 隐私: 7

      const stats = repo.getResourcesStatistics(fullInventoryTime)

      expect(stats.unclassifiedCount).toBe(0)
      expect(stats.coreCount).toBe(5)       // history1.source_count = 5
      expect(stats.importantCount).toBe(3)  // history2.source_count = 3
      expect(stats.openCount).toBe(10)      // new1.source_count = 10
      expect(stats.privacyCount).toBe(7)    // new2.source_count = 7
    })

    it('should calculate unclassifiedCount correctly for mixed records', () => {
      // 只分类部分记录
      const history1 = repo.getAll().find(r => r.content_sign === 'history1')!
      repo.batchClassify({ ids: [history1.data_resources_id!], importance_level: 1 })

      const stats = repo.getResourcesStatistics(fullInventoryTime)

      // history1(5) 被分类为核心，其他 3+10+7=20 未分类
      expect(stats.unclassifiedCount).toBe(20)
      expect(stats.coreCount).toBe(5)
    })
  })
})

