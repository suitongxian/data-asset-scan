import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseService } from '../DatabaseService'
import { FileStatisticsRepository } from '../FileStatisticsRepository'
import { DataDistributingRepository, CreateDataDistributingParams } from '../DataDistributingRepository'
import { SystemConfigRepository } from '../SystemConfigRepository'

describe('FileStatisticsRepository', () => {
  let testDir: string
  let sqlPath: string
  let dbPath: string
  let dbService: DatabaseService
  let statsRepo: FileStatisticsRepository
  let dataRepo: DataDistributingRepository
  let configRepo: SystemConfigRepository

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
    testDir = path.join(os.tmpdir(), `file-stats-repo-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    sqlPath = path.join(testDir, 'database.sql')
    const sql = `
-- 系统配置表 system_config
CREATE TABLE system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    value TEXT,
    describe TEXT,
    create_time DATETIME NOT NULL,
    update_time DATETIME NOT NULL,
    disable INTEGER NOT NULL DEFAULT 0
);

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

-- 文件数量统计表 file_statistics
CREATE TABLE file_statistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_task_id INTEGER NOT NULL,
    file_total INTEGER NOT NULL DEFAULT 0,
    workspace_file_total INTEGER NOT NULL DEFAULT 0,
    history_file_count INTEGER NOT NULL DEFAULT 0,
    non_history_file_count INTEGER NOT NULL DEFAULT 0,
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
    statsRepo = new FileStatisticsRepository(dbService.getDb())
    dataRepo = new DataDistributingRepository(dbService.getDb(), 100)
    configRepo = new SystemConfigRepository(dbService.getDb())
  })

  afterEach(() => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('create', () => {
    it('should create a statistics record', () => {
      const id = statsRepo.create({
        scan_task_id: 1,
        file_total: 100,
        workspace_file_total: 50,
        history_file_count: 30,
        non_history_file_count: 70
      })

      expect(id).toBeGreaterThan(0)
    })

    it('should store all fields correctly', () => {
      const id = statsRepo.create({
        scan_task_id: 1,
        file_total: 100,
        workspace_file_total: 50,
        history_file_count: 30,
        non_history_file_count: 70
      })

      const record = statsRepo.getByScanTaskId(1)

      expect(record).not.toBeNull()
      expect(record!.id).toBe(id)
      expect(record!.scan_task_id).toBe(1)
      expect(record!.file_total).toBe(100)
      expect(record!.workspace_file_total).toBe(50)
      expect(record!.history_file_count).toBe(30)
      expect(record!.non_history_file_count).toBe(70)
      expect(record!.disable).toBe(0)
    })
  })

  describe('calculateStatistics', () => {
    it('should calculate file total correctly', () => {
      // 插入测试数据
      dataRepo.insertBatch([
        createTestRecord({ path: '/file1.txt', content_sign: 'sign1' }),
        createTestRecord({ path: '/file2.txt', content_sign: 'sign2' }),
        createTestRecord({ path: '/file3.txt', content_sign: 'sign3' })
      ])

      const stats = statsRepo.calculateStatistics(null, null)

      expect(stats.fileTotal).toBe(3)
      expect(stats.workspaceFileTotal).toBe(0)
      expect(stats.historyFileCount).toBe(0)
      expect(stats.nonHistoryFileCount).toBe(3)
    })

    it('should calculate workspace file total correctly', () => {
      // 插入测试数据，部分在工作空间内
      dataRepo.insertBatch([
        createTestRecord({ path: '/workspace/file1.txt', content_sign: 'sign1' }),
        createTestRecord({ path: '/workspace/sub/file2.txt', content_sign: 'sign2' }),
        createTestRecord({ path: '/other/file3.txt', content_sign: 'sign3' })
      ])

      const stats = statsRepo.calculateStatistics('/workspace', null)

      expect(stats.fileTotal).toBe(3)
      expect(stats.workspaceFileTotal).toBe(2)
    })

    it('should calculate history file count correctly', () => {
      const now = new Date()
      const pastTime = new Date(now.getTime() - 86400000 * 30).toISOString() // 30天前
      const futureTime = new Date(now.getTime() + 86400000).toISOString() // 1天后
      const fullInventoryTime = now.toISOString()

      // 插入测试数据，部分文件创建时间在首次普查之前
      dataRepo.insertBatch([
        createTestRecord({ path: '/file1.txt', content_sign: 'sign1', file_create_time: pastTime }),
        createTestRecord({ path: '/file2.txt', content_sign: 'sign2', file_create_time: pastTime }),
        createTestRecord({ path: '/file3.txt', content_sign: 'sign3', file_create_time: futureTime })
      ])

      const stats = statsRepo.calculateStatistics(null, fullInventoryTime)

      expect(stats.fileTotal).toBe(3)
      expect(stats.historyFileCount).toBe(2)
      expect(stats.nonHistoryFileCount).toBe(1)
    })

    it('should not count disabled records', () => {
      dataRepo.insertBatch([
        createTestRecord({ path: '/file1.txt', content_sign: 'sign1' }),
        createTestRecord({ path: '/file2.txt', content_sign: 'sign2' })
      ])

      // 禁用一条记录
      dbService.getDb().prepare('UPDATE data_distributing SET disable = 1 WHERE path = ?').run('/file1.txt')

      const stats = statsRepo.calculateStatistics(null, null)

      expect(stats.fileTotal).toBe(1)
    })
  })

  describe('executeAndSave', () => {
    it('should calculate and save statistics', () => {
      // 插入测试数据
      dataRepo.insertBatch([
        createTestRecord({ path: '/workspace/file1.txt', content_sign: 'sign1' }),
        createTestRecord({ path: '/other/file2.txt', content_sign: 'sign2' })
      ])

      // 设置工作空间
      configRepo.setWorkspace('/workspace')

      const result = statsRepo.executeAndSave(1, '/workspace', null)

      expect(result.scan_task_id).toBe(1)
      expect(result.file_total).toBe(2)
      expect(result.workspace_file_total).toBe(1)
      expect(result.history_file_count).toBe(0)
      expect(result.non_history_file_count).toBe(2)

      // 验证已保存到数据库
      const saved = statsRepo.getByScanTaskId(1)
      expect(saved).not.toBeNull()
      expect(saved!.file_total).toBe(2)
    })
  })

  describe('getByScanTaskId', () => {
    it('should return null when not found', () => {
      const result = statsRepo.getByScanTaskId(999)
      expect(result).toBeNull()
    })

    it('should not return disabled records', () => {
      statsRepo.create({
        scan_task_id: 1,
        file_total: 100,
        workspace_file_total: 50,
        history_file_count: 30,
        non_history_file_count: 70
      })

      // 禁用记录
      dbService.getDb().prepare('UPDATE file_statistics SET disable = 1 WHERE scan_task_id = ?').run(1)

      const result = statsRepo.getByScanTaskId(1)
      expect(result).toBeNull()
    })
  })

  describe('getLatest', () => {
    it('should return the most recent record', () => {
      statsRepo.create({
        scan_task_id: 1,
        file_total: 100,
        workspace_file_total: 50,
        history_file_count: 30,
        non_history_file_count: 70
      })

      // 等待一小段时间确保时间戳不同
      const laterTime = new Date(Date.now() + 1000).toISOString()
      dbService.getDb().prepare(`
        INSERT INTO file_statistics (scan_task_id, file_total, workspace_file_total, history_file_count, non_history_file_count, create_time, update_time, disable)
        VALUES (2, 200, 100, 60, 140, ?, ?, 0)
      `).run(laterTime, laterTime)

      const latest = statsRepo.getLatest()

      expect(latest).not.toBeNull()
      expect(latest!.scan_task_id).toBe(2)
      expect(latest!.file_total).toBe(200)
    })

    it('should return null when no records exist', () => {
      const result = statsRepo.getLatest()
      expect(result).toBeNull()
    })
  })

  describe('getAll', () => {
    it('should return all non-disabled records', () => {
      statsRepo.create({
        scan_task_id: 1,
        file_total: 100,
        workspace_file_total: 50,
        history_file_count: 30,
        non_history_file_count: 70
      })

      statsRepo.create({
        scan_task_id: 2,
        file_total: 200,
        workspace_file_total: 100,
        history_file_count: 60,
        non_history_file_count: 140
      })

      const all = statsRepo.getAll()

      expect(all.length).toBe(2)
    })

    it('should not return disabled records', () => {
      statsRepo.create({
        scan_task_id: 1,
        file_total: 100,
        workspace_file_total: 50,
        history_file_count: 30,
        non_history_file_count: 70
      })

      statsRepo.create({
        scan_task_id: 2,
        file_total: 200,
        workspace_file_total: 100,
        history_file_count: 60,
        non_history_file_count: 140
      })

      // 禁用一条记录
      dbService.getDb().prepare('UPDATE file_statistics SET disable = 1 WHERE scan_task_id = ?').run(1)

      const all = statsRepo.getAll()

      expect(all.length).toBe(1)
      expect(all[0].scan_task_id).toBe(2)
    })
  })

  describe('getLatestTwo', () => {
    it('should return empty array when no records', () => {
      const result = statsRepo.getLatestTwo()
      expect(result).toEqual([])
    })

    it('should return one record when only one exists', () => {
      statsRepo.create({
        scan_task_id: 1,
        file_total: 100,
        workspace_file_total: 50,
        history_file_count: 30,
        non_history_file_count: 70
      })

      const result = statsRepo.getLatestTwo()

      expect(result.length).toBe(1)
      expect(result[0].scan_task_id).toBe(1)
    })

    it('should return two records ordered by create_time desc', () => {
      statsRepo.create({
        scan_task_id: 1,
        file_total: 100,
        workspace_file_total: 50,
        history_file_count: 30,
        non_history_file_count: 70
      })

      // 插入第二条记录，手动设置更晚的时间
      const laterTime = new Date(Date.now() + 1000).toISOString()
      dbService.getDb().prepare(`
        INSERT INTO file_statistics (scan_task_id, file_total, workspace_file_total, history_file_count, non_history_file_count, create_time, update_time, disable)
        VALUES (2, 200, 100, 60, 140, ?, ?, 0)
      `).run(laterTime, laterTime)

      const result = statsRepo.getLatestTwo()

      expect(result.length).toBe(2)
      expect(result[0].scan_task_id).toBe(2) // 最新的在前
      expect(result[1].scan_task_id).toBe(1)
    })

    it('should return only two records even when more exist', () => {
      for (let i = 1; i <= 5; i++) {
        const time = new Date(Date.now() + i * 1000).toISOString()
        dbService.getDb().prepare(`
          INSERT INTO file_statistics (scan_task_id, file_total, workspace_file_total, history_file_count, non_history_file_count, create_time, update_time, disable)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `).run(i, i * 100, i * 50, i * 30, i * 70, time, time)
      }

      const result = statsRepo.getLatestTwo()

      expect(result.length).toBe(2)
      expect(result[0].scan_task_id).toBe(5) // 最新的
      expect(result[1].scan_task_id).toBe(4) // 次新的
    })
  })

  describe('getStatisticsComparison', () => {
    it('should return empty comparison when no records', () => {
      const result = statsRepo.getStatisticsComparison()

      expect(result.hasComparison).toBe(false)
      expect(result.workspaceStatistics.currentCount).toBe(0)
      expect(result.workspaceStatistics.lastCount).toBe(0)
      expect(result.workspaceStatistics.growthCount).toBe(0)
      expect(result.workspaceStatistics.growthRate).toBe(0)
    })

    it('should return comparison with hasComparison=false when only one record', () => {
      statsRepo.create({
        scan_task_id: 1,
        file_total: 100,
        workspace_file_total: 50,
        history_file_count: 30,
        non_history_file_count: 70
      })

      const result = statsRepo.getStatisticsComparison()

      expect(result.hasComparison).toBe(false)
      expect(result.workspaceStatistics.currentCount).toBe(50)
      expect(result.workspaceStatistics.lastCount).toBe(0)
      expect(result.workspaceStatistics.growthCount).toBe(50)
      expect(result.workspaceStatistics.growthRate).toBe(100) // 从0增长到50，增涨率100%
    })

    it('should calculate growth correctly with two scans', () => {
      // 第一次扫描
      statsRepo.create({
        scan_task_id: 1,
        file_total: 100,
        workspace_file_total: 50,
        history_file_count: 30,
        non_history_file_count: 70
      })

      // 第二次扫描（带延迟以确保时间差异）
      const laterTime = new Date(Date.now() + 1000).toISOString()
      dbService.getDb().prepare(`
        INSERT INTO file_statistics (scan_task_id, file_total, workspace_file_total, history_file_count, non_history_file_count, create_time, update_time, disable)
        VALUES (2, 150, 80, 35, 115, ?, ?, 0)
      `).run(laterTime, laterTime)

      const result = statsRepo.getStatisticsComparison()

      expect(result.hasComparison).toBe(true)

      // 工作空间文件数统计
      expect(result.workspaceStatistics.lastCount).toBe(50)
      expect(result.workspaceStatistics.currentCount).toBe(80)
      expect(result.workspaceStatistics.growthCount).toBe(30)
      expect(result.workspaceStatistics.growthRate).toBe(60) // (80-50)/50 * 100 = 60%

      // 非历史文件数统计
      expect(result.nonHistoryStatistics.lastCount).toBe(70)
      expect(result.nonHistoryStatistics.currentCount).toBe(115)
      expect(result.nonHistoryStatistics.growthCount).toBe(45)
      expect(result.nonHistoryStatistics.growthRate).toBeCloseTo(64.29, 1) // (115-70)/70 * 100 ≈ 64.29%

      // 历史文件数统计
      expect(result.historyStatistics.lastCount).toBe(30)
      expect(result.historyStatistics.currentCount).toBe(35)
      expect(result.historyStatistics.growthCount).toBe(5)
      expect(result.historyStatistics.growthRate).toBeCloseTo(16.67, 1) // (35-30)/30 * 100 ≈ 16.67%
    })

    it('should handle negative growth (decrease in files)', () => {
      // 第一次扫描
      statsRepo.create({
        scan_task_id: 1,
        file_total: 100,
        workspace_file_total: 50,
        history_file_count: 30,
        non_history_file_count: 70
      })

      // 第二次扫描（文件数量减少）
      const laterTime = new Date(Date.now() + 1000).toISOString()
      dbService.getDb().prepare(`
        INSERT INTO file_statistics (scan_task_id, file_total, workspace_file_total, history_file_count, non_history_file_count, create_time, update_time, disable)
        VALUES (2, 80, 40, 25, 55, ?, ?, 0)
      `).run(laterTime, laterTime)

      const result = statsRepo.getStatisticsComparison()

      expect(result.hasComparison).toBe(true)

      // 工作空间文件数统计（减少）
      expect(result.workspaceStatistics.lastCount).toBe(50)
      expect(result.workspaceStatistics.currentCount).toBe(40)
      expect(result.workspaceStatistics.growthCount).toBe(-10)
      expect(result.workspaceStatistics.growthRate).toBe(-20) // (40-50)/50 * 100 = -20%
    })

    it('should handle zero to non-zero growth', () => {
      // 第一次扫描（所有数据为0）
      statsRepo.create({
        scan_task_id: 1,
        file_total: 0,
        workspace_file_total: 0,
        history_file_count: 0,
        non_history_file_count: 0
      })

      // 第二次扫描（有数据）
      const laterTime = new Date(Date.now() + 1000).toISOString()
      dbService.getDb().prepare(`
        INSERT INTO file_statistics (scan_task_id, file_total, workspace_file_total, history_file_count, non_history_file_count, create_time, update_time, disable)
        VALUES (2, 100, 50, 30, 70, ?, ?, 0)
      `).run(laterTime, laterTime)

      const result = statsRepo.getStatisticsComparison()

      expect(result.hasComparison).toBe(true)

      // 当上次数量为0时，增涨率应为100%（表示从无到有）
      expect(result.workspaceStatistics.lastCount).toBe(0)
      expect(result.workspaceStatistics.currentCount).toBe(50)
      expect(result.workspaceStatistics.growthCount).toBe(50)
      expect(result.workspaceStatistics.growthRate).toBe(100)
    })

    it('should correctly reflect growth across workspace, history and non-history files', () => {
      // 模拟真实场景：两次扫描统计
      // 第一次扫描
      const firstScanTime = new Date().toISOString()
      dbService.getDb().prepare(`
        INSERT INTO file_statistics (scan_task_id, file_total, workspace_file_total, history_file_count, non_history_file_count, create_time, update_time, disable)
        VALUES (1, 1000, 500, 300, 700, ?, ?, 0)
      `).run(firstScanTime, firstScanTime)

      // 第二次扫描（新增文件主要是非历史文件，因为历史文件不会增加）
      const secondScanTime = new Date(Date.now() + 1000).toISOString()
      dbService.getDb().prepare(`
        INSERT INTO file_statistics (scan_task_id, file_total, workspace_file_total, history_file_count, non_history_file_count, create_time, update_time, disable)
        VALUES (2, 1100, 580, 300, 800, ?, ?, 0)
      `).run(secondScanTime, secondScanTime)

      const result = statsRepo.getStatisticsComparison()

      expect(result.hasComparison).toBe(true)

      // 工作空间文件数增涨 16%
      expect(result.workspaceStatistics.lastCount).toBe(500)
      expect(result.workspaceStatistics.currentCount).toBe(580)
      expect(result.workspaceStatistics.growthCount).toBe(80)
      expect(result.workspaceStatistics.growthRate).toBe(16)

      // 历史文件数不变（0%增涨）
      expect(result.historyStatistics.lastCount).toBe(300)
      expect(result.historyStatistics.currentCount).toBe(300)
      expect(result.historyStatistics.growthCount).toBe(0)
      expect(result.historyStatistics.growthRate).toBe(0)

      // 非历史文件数增涨
      expect(result.nonHistoryStatistics.lastCount).toBe(700)
      expect(result.nonHistoryStatistics.currentCount).toBe(800)
      expect(result.nonHistoryStatistics.growthCount).toBe(100)
      expect(result.nonHistoryStatistics.growthRate).toBeCloseTo(14.29, 1)
    })
  })
})
