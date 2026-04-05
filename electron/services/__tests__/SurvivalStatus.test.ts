import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseService } from '../DatabaseService'
import { AtomicScanService, ScanMode } from '../AtomicScanService'
import { DataDistributing } from '../DataDistributingRepository'
import { DataResources } from '../DataResourcesRepository'

/**
 * 存续状态逻辑测试
 *
 * 存续状态通过 scan_found_count 字段体现：
 * - 0 = 删除（之前有，现在没有）
 * - 1 = 新增（之前没有，现在有）
 * - >1 = 正常（累计扫描次数）
 */
describe('SurvivalStatus', () => {
  let testDir: string
  let scanDir: string
  let sqlPath: string
  let dbPath: string
  let dbService: DatabaseService
  let scanService: AtomicScanService

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `survival-status-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    // 创建扫描目录
    scanDir = path.join(testDir, 'scandir')
    await fs.mkdir(scanDir, { recursive: true })

    // 创建 database.sql
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

-- 扫描任务表 scan_task
CREATE TABLE scan_task (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_type TEXT NOT NULL,
    file_scan_range TEXT,
    heartbeat INTEGER NOT NULL,
    workspace_path TEXT,
    task_state INTEGER NOT NULL,
    task_phase TEXT,
    task_error_message TEXT,
    scan_args TEXT,
    file_total INTEGER,
    file_scanned_count INTEGER,
    file_all_suffix_count INTEGER,
    file_count_suffix_count TEXT,
    workspace_count INTEGER,
    end_time DATETIME,
    scan_log TEXT,
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
    scanService = new AtomicScanService(dbService.getDb(), 10)
  })

  afterEach(async () => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
    // 清理扫描目录中的文件
    const files = await fs.readdir(scanDir)
    for (const file of files) {
      const filePath = path.join(scanDir, file)
      const stat = await fs.stat(filePath)
      if (stat.isFile()) {
        await fs.unlink(filePath)
      } else if (stat.isDirectory()) {
        await fs.rm(filePath, { recursive: true, force: true })
      }
    }
  })

  /**
   * 辅助函数：获取所有 data_distributing 记录
   */
  function getAllDistributing(): DataDistributing[] {
    return dbService.getDb().prepare(`
      SELECT * FROM data_distributing
    `).all() as DataDistributing[]
  }

  /**
   * 辅助函数：获取所有 data_resources 记录
   */
  function getAllResources(): DataResources[] {
    return dbService.getDb().prepare(`
      SELECT * FROM data_resources
    `).all() as DataResources[]
  }

  /**
   * 辅助函数：根据路径获取 data_distributing 记录
   */
  function getDistributingByPath(filePath: string): DataDistributing | undefined {
    return dbService.getDb().prepare(`
      SELECT * FROM data_distributing WHERE path = ?
    `).get(filePath) as DataDistributing | undefined
  }

  /**
   * 辅助函数：设置首次普查时间（模拟已进行首次普查）
   */
  function setFullInventoryTime(): void {
    const now = new Date().toISOString()
    dbService.getDb().prepare(`
      INSERT INTO system_config (key, type, value, describe, create_time, update_time, disable)
      VALUES ('FULL_INVENTORY_TIME', 'string', ?, '首次普查时间', ?, ?, 0)
    `).run(now, now, now)
  }

  describe('新文件情况', () => {
    it('首次扫描时所有文件的 scan_found_count 应为 1', async () => {
      // 创建测试文件
      await fs.writeFile(path.join(scanDir, 'file1.doc'), 'Content 1')
      await fs.writeFile(path.join(scanDir, 'file2.doc'), 'Content 2')
      await fs.writeFile(path.join(scanDir, 'file3.doc'), 'Content 3')

      // 执行首次普查
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      expect(result.success).toBe(true)
      expect(result.scannedFiles).toBe(3)

      // 验证 data_distributing 表
      const distributing = getAllDistributing()
      expect(distributing.length).toBe(3)

      for (const record of distributing) {
        expect(record.scan_found_count).toBe(1)
      }

      // 验证 data_resources 表
      const resources = getAllResources()
      expect(resources.length).toBe(3) // 三个不同内容的文件，三个不同的 MD5
    })

    it('日常盘点时新增文件的 scan_found_count 应为 1', async () => {
      // 创建初始文件并进行首次普查
      await fs.writeFile(path.join(scanDir, 'existing.doc'), 'Existing content')

      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // 验证首次普查结果
      let distributing = getAllDistributing()
      expect(distributing.length).toBe(1)
      expect(distributing[0].scan_found_count).toBe(1)

      // 添加新文件
      await fs.writeFile(path.join(scanDir, 'new_file.doc'), 'New content')

      // 执行日常盘点
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      expect(result.success).toBe(true)

      // 验证存续状态
      distributing = getAllDistributing()
      expect(distributing.length).toBe(2)

      const existingRecord = getDistributingByPath(path.join(scanDir, 'existing.doc'))
      const newRecord = getDistributingByPath(path.join(scanDir, 'new_file.doc'))

      expect(existingRecord).toBeDefined()
      expect(existingRecord!.scan_found_count).toBe(2) // 正常文件，计数加1

      expect(newRecord).toBeDefined()
      expect(newRecord!.scan_found_count).toBe(1) // 新文件，计数为1

      // 验证 data_resources 表有新记录
      const resources = getAllResources()
      expect(resources.length).toBe(2) // 两个不同内容的文件
    })
  })

  describe('删除文件情况', () => {
    it('日常盘点时删除文件的 scan_found_count 应为 0', async () => {
      // 创建初始文件并进行首次普查
      const file1Path = path.join(scanDir, 'file1.doc')
      const file2Path = path.join(scanDir, 'file2.doc')

      await fs.writeFile(file1Path, 'Content 1')
      await fs.writeFile(file2Path, 'Content 2')

      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // 验证首次普查结果
      let distributing = getAllDistributing()
      expect(distributing.length).toBe(2)

      // 删除一个文件（测试用例可以删除测试文件）
      await fs.unlink(file2Path)

      // 执行日常盘点
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      expect(result.success).toBe(true)

      // 验证存续状态
      distributing = getAllDistributing()
      expect(distributing.length).toBe(2) // 记录数不变

      const file1Record = getDistributingByPath(file1Path)
      const file2Record = getDistributingByPath(file2Path)

      expect(file1Record).toBeDefined()
      expect(file1Record!.scan_found_count).toBe(2) // 正常文件，计数加1

      expect(file2Record).toBeDefined()
      expect(file2Record!.scan_found_count).toBe(0) // 删除文件，计数为0

      // 验证 data_resources 表的 source_count 已减少
      const resources = getAllResources()
      const deletedResource = resources.find(r => r.content_sign === file2Record!.content_sign)
      expect(deletedResource).toBeDefined()
      expect(deletedResource!.source_count).toBe(0) // source_count 应减为 0
    })
  })

  describe('正常文件情况', () => {
    it('日常盘点时正常文件的 scan_found_count 应大于 1', async () => {
      // 创建测试文件并进行首次普查
      const filePath = path.join(scanDir, 'persistent.doc')
      await fs.writeFile(filePath, 'Persistent content')

      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // 验证首次普查结果
      let record = getDistributingByPath(filePath)
      expect(record).toBeDefined()
      expect(record!.scan_found_count).toBe(1)

      // 执行第一次日常盘点
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      record = getDistributingByPath(filePath)
      expect(record!.scan_found_count).toBe(2)

      // 执行第二次日常盘点
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      record = getDistributingByPath(filePath)
      expect(record!.scan_found_count).toBe(3)

      // 执行第三次日常盘点
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      record = getDistributingByPath(filePath)
      expect(record!.scan_found_count).toBe(4)
    })

    it('多次日常盘点应累加 scan_found_count', async () => {
      // 创建多个测试文件
      await fs.writeFile(path.join(scanDir, 'file1.doc'), 'Content 1')
      await fs.writeFile(path.join(scanDir, 'file2.doc'), 'Content 2')

      // 首次普查
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // 执行5次日常盘点
      for (let i = 0; i < 5; i++) {
        await scanService.scan({
          directory: scanDir,
          extensions: ['.doc'],
          scan_mode: ScanMode.DAILY_CHECK
        })
      }

      // 验证所有文件的 scan_found_count 为 6（1次首次普查 + 5次日常盘点）
      const distributing = getAllDistributing()
      expect(distributing.length).toBe(2)

      for (const record of distributing) {
        expect(record.scan_found_count).toBe(6)
      }
    })
  })

  describe('混合场景', () => {
    it('应正确处理新增、删除、正常文件的混合情况', async () => {
      // 创建初始文件
      const keepFile = path.join(scanDir, 'keep.doc')
      const deleteFile = path.join(scanDir, 'delete.doc')

      await fs.writeFile(keepFile, 'Keep content')
      await fs.writeFile(deleteFile, 'Delete content')

      // 首次普查
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // 删除一个文件，添加一个新文件
      await fs.unlink(deleteFile)
      const newFile = path.join(scanDir, 'new.doc')
      await fs.writeFile(newFile, 'New content')

      // 日常盘点
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      expect(result.success).toBe(true)

      // 验证
      const keepRecord = getDistributingByPath(keepFile)
      const deleteRecord = getDistributingByPath(deleteFile)
      const newRecord = getDistributingByPath(newFile)

      // 正常文件
      expect(keepRecord).toBeDefined()
      expect(keepRecord!.scan_found_count).toBe(2)

      // 删除文件
      expect(deleteRecord).toBeDefined()
      expect(deleteRecord!.scan_found_count).toBe(0)

      // 新文件
      expect(newRecord).toBeDefined()
      expect(newRecord!.scan_found_count).toBe(1)

      // 验证 data_resources 表
      const resources = getAllResources()
      expect(resources.length).toBe(3) // 三个不同内容的文件
    })

    it('删除文件后再次出现应作为新文件处理', async () => {
      // 创建初始文件
      const filePath = path.join(scanDir, 'cycle.doc')
      const fileContent = 'Cycle content'
      await fs.writeFile(filePath, fileContent)

      // 首次普查
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      let record = getDistributingByPath(filePath)
      expect(record!.scan_found_count).toBe(1)

      // 删除文件
      await fs.unlink(filePath)

      // 日常盘点（标记为删除）
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      record = getDistributingByPath(filePath)
      expect(record!.scan_found_count).toBe(0) // 已删除

      // 重新创建相同路径的文件
      await fs.writeFile(filePath, fileContent)

      // 再次日常盘点
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      // 由于路径相同，应该被识别为正常文件（scan_found_count + 1）
      // 注意：这里的行为取决于实现，如果原记录 scan_found_count 为 0，
      // 当文件再次出现时，应该将其 scan_found_count 从 0 变为 1（作为新出现）
      // 还是 0 + 1 = 1？
      // 根据当前实现，getActiveByPathMap 会获取所有 disable=0 的记录，
      // 包括 scan_found_count=0 的记录，所以这个文件会被识别为"正常文件"
      // 其 scan_found_count 会变成 0 + 1 = 1
      record = getDistributingByPath(filePath)
      expect(record!.scan_found_count).toBe(1)
    })
  })

  describe('data_resources 表更新', () => {
    it('新文件应在 data_resources 表中增加 source_count', async () => {
      // 创建初始文件
      await fs.writeFile(path.join(scanDir, 'file1.doc'), 'Same content')

      // 首次普查
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      let resources = getAllResources()
      expect(resources.length).toBe(1)
      expect(resources[0].source_count).toBe(1)

      // 添加相同内容的新文件（不同路径）
      await fs.writeFile(path.join(scanDir, 'file2.doc'), 'Same content')

      // 日常盘点
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      // 验证 source_count 增加
      resources = getAllResources()
      expect(resources.length).toBe(1) // 同一个 MD5
      expect(resources[0].source_count).toBe(2) // source_count 增加
    })

    it('删除文件应在 data_resources 表中减少 source_count', async () => {
      // 创建多个相同内容的文件
      const file1 = path.join(scanDir, 'dup1.doc')
      const file2 = path.join(scanDir, 'dup2.doc')
      const content = 'Duplicate content'

      await fs.writeFile(file1, content)
      await fs.writeFile(file2, content)

      // 首次普查
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      let resources = getAllResources()
      expect(resources.length).toBe(1)
      expect(resources[0].source_count).toBe(2)

      // 删除一个文件
      await fs.unlink(file2)

      // 日常盘点
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      // 验证 source_count 减少
      resources = getAllResources()
      expect(resources[0].source_count).toBe(1)
    })
  })

  describe('边界情况', () => {
    it('空目录的日常盘点应将所有文件标记为删除', async () => {
      // 创建初始文件
      await fs.writeFile(path.join(scanDir, 'file1.doc'), 'Content 1')
      await fs.writeFile(path.join(scanDir, 'file2.doc'), 'Content 2')

      // 首次普查
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      let distributing = getAllDistributing()
      expect(distributing.length).toBe(2)

      // 删除所有文件
      await fs.unlink(path.join(scanDir, 'file1.doc'))
      await fs.unlink(path.join(scanDir, 'file2.doc'))

      // 日常盘点
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      // 验证所有文件被标记为删除
      distributing = getAllDistributing()
      expect(distributing.length).toBe(2)
      for (const record of distributing) {
        expect(record.scan_found_count).toBe(0)
      }
    })

    it('首次日常盘点（无历史数据）应将所有文件标记为新增', async () => {
      // 设置首次普查时间（模拟已进行首次普查，但数据被清空）
      setFullInventoryTime()

      // 创建测试文件
      await fs.writeFile(path.join(scanDir, 'file1.doc'), 'Content 1')
      await fs.writeFile(path.join(scanDir, 'file2.doc'), 'Content 2')

      // 执行日常盘点（没有历史数据）
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      expect(result.success).toBe(true)

      // 所有文件都应该被视为新文件
      const distributing = getAllDistributing()
      expect(distributing.length).toBe(2)
      for (const record of distributing) {
        expect(record.scan_found_count).toBe(1)
      }
    })
  })
})
