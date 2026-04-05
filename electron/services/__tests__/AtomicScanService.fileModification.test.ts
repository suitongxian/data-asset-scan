/**
 * AtomicScanService 文件修改检测测试
 * 验证日常盘点模式下文件修改后 content_sign 能够正确更新
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { DatabaseService } from '../DatabaseService'
import { AtomicScanService, ScanMode } from '../AtomicScanService'
import { DataDistributing } from '../DataDistributingRepository'
import { DataResources } from '../DataResourcesRepository'

describe('AtomicScanService - 文件修改检测', () => {
  let testDir: string
  let scanDir: string
  let workspaceDir: string
  let sqlPath: string
  let dbPath: string
  let dbService: DatabaseService
  let scanService: AtomicScanService

  beforeAll(async () => {
    testDir = path.join(os.tmpdir(), `atomic-scan-modification-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    scanDir = path.join(testDir, 'scandir')
    await fs.mkdir(scanDir, { recursive: true })

    workspaceDir = path.join(testDir, 'workspace')
    await fs.mkdir(workspaceDir, { recursive: true })

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
    task_state TEXT NOT NULL,
    task_phase TEXT,
    task_error_message TEXT,
    scan_args TEXT,
    file_total INTEGER,
    file_scanned_count INTEGER,
    file_all_suffix_count INTEGER,
    file_count_suffix_count INTEGER,
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
    file_magic TEXT,
    is_claimed INTEGER DEFAULT 0,
    claim_status INTEGER DEFAULT 0,
    importance_level INTEGER DEFAULT 0,
    claim_time DATETIME,
    claimant_name TEXT,
    claimant_unit TEXT,
    data_level TEXT,
    data_share TEXT,
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

  beforeEach(async () => {
    dbPath = path.join(testDir, `test-${Date.now()}.db`)
    dbService = new DatabaseService({ dbPath, sqlPath })
    dbService.init()
    scanService = new AtomicScanService(dbService.getDb(), 10)

    // 清理工作空间和扫描目录
    const wsFiles = await fs.readdir(workspaceDir)
    for (const file of wsFiles) {
      await fs.rm(path.join(workspaceDir, file), { force: true })
    }
    const scanFiles = await fs.readdir(scanDir)
    for (const file of scanFiles) {
      await fs.rm(path.join(scanDir, file), { recursive: true, force: true })
    }
  })

  afterEach(() => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('日常盘点模式 - 文件修改检测', () => {
    it('修改文件后，日常盘点应该更新 content_sign', async () => {
      // 1. 创建初始文件
      const testFilePath = path.join(workspaceDir, 'hello.md')
      const initialContent = 'Hello World - Initial Content'
      await fs.writeFile(testFilePath, initialContent)
      const initialMd5 = crypto.createHash('md5').update(initialContent).digest('hex')

      // 2. 首次普查
      const fullInventoryResult = await scanService.scan({
        directory: workspaceDir,
        extensions: ['.md'],
        workspace: workspaceDir,
        scan_mode: ScanMode.FULL_INVENTORY
      })
      expect(fullInventoryResult.success).toBe(true)

      // 验证首次普查的 content_sign
      const initialRecord = dbService.getDb().prepare(
        'SELECT content_sign, file_size FROM data_distributing WHERE path = ? AND disable = 0'
      ).get(testFilePath) as { content_sign: string; file_size: number }
      expect(initialRecord.content_sign).toBe(initialMd5)

      // 3. 修改文件内容
      const modifiedContent = 'Hello World - Modified Content 12345'
      await fs.writeFile(testFilePath, modifiedContent)
      const modifiedMd5 = crypto.createHash('md5').update(modifiedContent).digest('hex')

      // 等待一小段时间确保文件修改时间更新
      await new Promise(resolve => setTimeout(resolve, 100))

      // 4. 执行日常盘点
      const dailyCheckResult = await scanService.scan({
        directory: workspaceDir,
        extensions: ['.md'],
        workspace: workspaceDir,
        scan_mode: ScanMode.DAILY_CHECK
      })
      expect(dailyCheckResult.success).toBe(true)

      // 5. 验证 content_sign 已更新
      const updatedRecord = dbService.getDb().prepare(
        'SELECT content_sign, file_size, scan_found_count FROM data_distributing WHERE path = ? AND disable = 0'
      ).get(testFilePath) as { content_sign: string; file_size: number; scan_found_count: number }

      expect(updatedRecord.content_sign).toBe(modifiedMd5)
      expect(updatedRecord.content_sign).not.toBe(initialMd5)
      expect(updatedRecord.file_size).toBe(Buffer.byteLength(modifiedContent))
      // 修改后的文件 scan_found_count 应该重置为 1
      expect(updatedRecord.scan_found_count).toBe(1)
    })

    it('未修改文件时，日常盘点不应改变 content_sign', async () => {
      // 1. 创建初始文件
      const testFilePath = path.join(workspaceDir, 'unchanged.md')
      const content = 'Unchanged content'
      await fs.writeFile(testFilePath, content)
      const expectedMd5 = crypto.createHash('md5').update(content).digest('hex')

      // 2. 首次普查
      await scanService.scan({
        directory: workspaceDir,
        extensions: ['.md'],
        workspace: workspaceDir,
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // 3. 执行日常盘点（不修改文件）
      await scanService.scan({
        directory: workspaceDir,
        extensions: ['.md'],
        workspace: workspaceDir,
        scan_mode: ScanMode.DAILY_CHECK
      })

      // 4. 验证 content_sign 未变
      const record = dbService.getDb().prepare(
        'SELECT content_sign, scan_found_count FROM data_distributing WHERE path = ? AND disable = 0'
      ).get(testFilePath) as { content_sign: string; scan_found_count: number }

      expect(record.content_sign).toBe(expectedMd5)
      // 未修改的文件 scan_found_count 应该 +1
      expect(record.scan_found_count).toBe(2)
    })

    it('修改文件后，data_resources 表应该正确更新', async () => {
      // 1. 创建初始文件
      const testFilePath = path.join(workspaceDir, 'resource_test.md')
      const initialContent = 'Initial Resource Content'
      await fs.writeFile(testFilePath, initialContent)
      const initialMd5 = crypto.createHash('md5').update(initialContent).digest('hex')

      // 2. 首次普查
      await scanService.scan({
        directory: workspaceDir,
        extensions: ['.md'],
        workspace: workspaceDir,
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // 验证初始 data_resources
      const initialResource = dbService.getDb().prepare(
        'SELECT source_count, workspace_source_count FROM data_resources WHERE content_sign = ? AND disable = 0'
      ).get(initialMd5) as { source_count: number; workspace_source_count: number }
      expect(initialResource.source_count).toBe(1)
      expect(initialResource.workspace_source_count).toBe(1)

      // 3. 修改文件内容
      const modifiedContent = 'Modified Resource Content 67890'
      await fs.writeFile(testFilePath, modifiedContent)
      const modifiedMd5 = crypto.createHash('md5').update(modifiedContent).digest('hex')

      await new Promise(resolve => setTimeout(resolve, 100))

      // 4. 执行日常盘点
      await scanService.scan({
        directory: workspaceDir,
        extensions: ['.md'],
        workspace: workspaceDir,
        scan_mode: ScanMode.DAILY_CHECK
      })

      // 5. 验证旧 content_sign 的 source_count 减少
      const oldResource = dbService.getDb().prepare(
        'SELECT source_count, workspace_source_count FROM data_resources WHERE content_sign = ? AND disable = 0'
      ).get(initialMd5) as { source_count: number; workspace_source_count: number } | undefined

      if (oldResource) {
        expect(oldResource.source_count).toBe(0)
        expect(oldResource.workspace_source_count).toBe(0)
      }

      // 6. 验证新 content_sign 的记录已创建
      const newResource = dbService.getDb().prepare(
        'SELECT source_count, workspace_source_count FROM data_resources WHERE content_sign = ? AND disable = 0'
      ).get(modifiedMd5) as { source_count: number; workspace_source_count: number }
      expect(newResource.source_count).toBe(1)
      expect(newResource.workspace_source_count).toBe(1)
    })

    it('多个文件中有部分被修改，应该正确处理', async () => {
      // 1. 创建多个文件
      const file1 = path.join(workspaceDir, 'file1.md')
      const file2 = path.join(workspaceDir, 'file2.md')
      const file3 = path.join(workspaceDir, 'file3.md')

      const content1 = 'Content 1'
      const content2 = 'Content 2'
      const content3 = 'Content 3'

      await fs.writeFile(file1, content1)
      await fs.writeFile(file2, content2)
      await fs.writeFile(file3, content3)

      const md5_1 = crypto.createHash('md5').update(content1).digest('hex')
      const md5_2 = crypto.createHash('md5').update(content2).digest('hex')
      const md5_3 = crypto.createHash('md5').update(content3).digest('hex')

      // 2. 首次普查
      await scanService.scan({
        directory: workspaceDir,
        extensions: ['.md'],
        workspace: workspaceDir,
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // 3. 只修改 file2
      const modifiedContent2 = 'Modified Content 2 ABC'
      await fs.writeFile(file2, modifiedContent2)
      const modifiedMd5_2 = crypto.createHash('md5').update(modifiedContent2).digest('hex')

      await new Promise(resolve => setTimeout(resolve, 100))

      // 4. 执行日常盘点
      await scanService.scan({
        directory: workspaceDir,
        extensions: ['.md'],
        workspace: workspaceDir,
        scan_mode: ScanMode.DAILY_CHECK
      })

      // 5. 验证结果
      const record1 = dbService.getDb().prepare(
        'SELECT content_sign, scan_found_count FROM data_distributing WHERE path = ? AND disable = 0'
      ).get(file1) as { content_sign: string; scan_found_count: number }
      expect(record1.content_sign).toBe(md5_1)
      expect(record1.scan_found_count).toBe(2) // 未修改，+1

      const record2 = dbService.getDb().prepare(
        'SELECT content_sign, scan_found_count FROM data_distributing WHERE path = ? AND disable = 0'
      ).get(file2) as { content_sign: string; scan_found_count: number }
      expect(record2.content_sign).toBe(modifiedMd5_2)
      expect(record2.scan_found_count).toBe(1) // 修改后重置为 1

      const record3 = dbService.getDb().prepare(
        'SELECT content_sign, scan_found_count FROM data_distributing WHERE path = ? AND disable = 0'
      ).get(file3) as { content_sign: string; scan_found_count: number }
      expect(record3.content_sign).toBe(md5_3)
      expect(record3.scan_found_count).toBe(2) // 未修改，+1
    })

    it('定点扫描模式下也应该检测文件修改', async () => {
      // 1. 创建文件
      const testFilePath = path.join(workspaceDir, 'targeted.md')
      const initialContent = 'Targeted scan initial'
      await fs.writeFile(testFilePath, initialContent)
      const initialMd5 = crypto.createHash('md5').update(initialContent).digest('hex')

      // 2. 首次普查
      await scanService.scan({
        directory: workspaceDir,
        extensions: ['.md'],
        workspace: workspaceDir,
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // 3. 修改文件
      const modifiedContent = 'Targeted scan modified XYZ'
      await fs.writeFile(testFilePath, modifiedContent)
      const modifiedMd5 = crypto.createHash('md5').update(modifiedContent).digest('hex')

      await new Promise(resolve => setTimeout(resolve, 100))

      // 4. 执行定点扫描
      await scanService.scan({
        directory: workspaceDir,
        extensions: ['.md'],
        workspace: workspaceDir,
        scan_mode: ScanMode.TARGETED_SCAN
      })

      // 5. 验证 content_sign 已更新
      const record = dbService.getDb().prepare(
        'SELECT content_sign FROM data_distributing WHERE path = ? AND disable = 0'
      ).get(testFilePath) as { content_sign: string }
      expect(record.content_sign).toBe(modifiedMd5)
    })
  })

  describe('边界情况', () => {
    it('修改文件内容但 MD5 碰巧相同时（极端情况），不应视为修改', async () => {
      // 这是一个理论上的测试，实际上很难构造 MD5 碰撞
      // 这里只测试文件修改时间变化但内容不变的情况
      const testFilePath = path.join(workspaceDir, 'same_content.md')
      const content = 'Same content always'
      await fs.writeFile(testFilePath, content)
      const expectedMd5 = crypto.createHash('md5').update(content).digest('hex')

      // 首次普查
      await scanService.scan({
        directory: workspaceDir,
        extensions: ['.md'],
        workspace: workspaceDir,
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // "touch" 文件改变修改时间但内容不变
      await new Promise(resolve => setTimeout(resolve, 100))
      await fs.writeFile(testFilePath, content) // 写入相同内容

      // 日常盘点
      await scanService.scan({
        directory: workspaceDir,
        extensions: ['.md'],
        workspace: workspaceDir,
        scan_mode: ScanMode.DAILY_CHECK
      })

      // 验证 content_sign 不变，scan_found_count 增加
      const record = dbService.getDb().prepare(
        'SELECT content_sign, scan_found_count FROM data_distributing WHERE path = ? AND disable = 0'
      ).get(testFilePath) as { content_sign: string; scan_found_count: number }
      expect(record.content_sign).toBe(expectedMd5)
      expect(record.scan_found_count).toBe(2)
    })

    it('文件大小变化应该被检测', async () => {
      const testFilePath = path.join(workspaceDir, 'size_change.md')
      const shortContent = 'Short'
      await fs.writeFile(testFilePath, shortContent)

      // 首次普查
      await scanService.scan({
        directory: workspaceDir,
        extensions: ['.md'],
        workspace: workspaceDir,
        scan_mode: ScanMode.FULL_INVENTORY
      })

      const initialRecord = dbService.getDb().prepare(
        'SELECT file_size FROM data_distributing WHERE path = ? AND disable = 0'
      ).get(testFilePath) as { file_size: number }
      expect(initialRecord.file_size).toBe(Buffer.byteLength(shortContent))

      // 修改为更长的内容
      const longContent = 'This is a much longer content with more text'
      await fs.writeFile(testFilePath, longContent)

      await new Promise(resolve => setTimeout(resolve, 100))

      // 日常盘点
      await scanService.scan({
        directory: workspaceDir,
        extensions: ['.md'],
        workspace: workspaceDir,
        scan_mode: ScanMode.DAILY_CHECK
      })

      // 验证 file_size 已更新
      const updatedRecord = dbService.getDb().prepare(
        'SELECT file_size FROM data_distributing WHERE path = ? AND disable = 0'
      ).get(testFilePath) as { file_size: number }
      expect(updatedRecord.file_size).toBe(Buffer.byteLength(longContent))
    })
  })
})
