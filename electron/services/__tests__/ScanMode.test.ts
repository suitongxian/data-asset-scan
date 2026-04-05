/**
 * 扫描模式测试用例
 * 验证 FULL_INVENTORY、DAILY_CHECK、TARGETED_SCAN 三种扫描模式
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseService } from '../DatabaseService'
import { AtomicScanService, ScanMode } from '../AtomicScanService'
import { SystemConfigRepository } from '../SystemConfigRepository'

describe('ScanMode - 扫描模式测试', () => {
  let testDir: string
  let scanDir: string
  let workspaceDir: string
  let sqlPath: string
  let dbPath: string
  let dbService: DatabaseService
  let scanService: AtomicScanService
  let configRepo: SystemConfigRepository

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `scan-mode-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    // 创建扫描目录
    scanDir = path.join(testDir, 'scandir')
    await fs.mkdir(scanDir, { recursive: true })

    // 创建工作空间目录
    workspaceDir = path.join(testDir, 'workspace')
    await fs.mkdir(workspaceDir, { recursive: true })

    // 创建测试文件
    await fs.writeFile(path.join(scanDir, 'doc1.doc'), 'Document content 1')
    await fs.writeFile(path.join(scanDir, 'doc2.doc'), 'Document content 2')
    await fs.writeFile(path.join(scanDir, 'file.pdf'), 'PDF content')

    await fs.mkdir(path.join(scanDir, 'subdir'))
    await fs.writeFile(path.join(scanDir, 'subdir', 'doc3.doc'), 'Document 3')

    // 创建工作空间文件
    await fs.writeFile(path.join(workspaceDir, 'ws1.doc'), 'Workspace doc 1')
    await fs.writeFile(path.join(workspaceDir, 'ws2.xlsx'), 'Workspace xlsx')

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
    configRepo = new SystemConfigRepository(dbService.getDb())
  })

  afterEach(() => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('FULL_INVENTORY - 首次普查', () => {
    it('首次普查完成后应该设置 FULL_INVENTORY_TIME', async () => {
      // 验证开始时没有 FULL_INVENTORY_TIME
      expect(configRepo.hasFullInventory()).toBe(false)

      // 执行首次普查
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      expect(result.success).toBe(true)

      // 验证设置了 FULL_INVENTORY_TIME
      expect(configRepo.hasFullInventory()).toBe(true)
      const inventoryTime = configRepo.getFullInventoryTime()
      expect(inventoryTime).not.toBeNull()

      // 验证时间格式正确（ISO 日期格式）
      expect(() => new Date(inventoryTime!)).not.toThrow()
    })

    it('首次普查后 data_distributing 和 data_resources 不应有逻辑删除的记录', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      expect(result.success).toBe(true)

      // 检查 data_distributing 没有逻辑删除的记录
      const distribRecords = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing WHERE disable = 1'
      ).get() as { count: number }
      expect(distribRecords.count).toBe(0)

      // 检查 data_resources 没有逻辑删除的记录
      const resourceRecords = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_resources WHERE disable = 1'
      ).get() as { count: number }
      expect(resourceRecords.count).toBe(0)
    })

    it('重新首次普查没有 save_code 应该失败', async () => {
      // 先执行一次首次普查
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // 设置 save_code
      configRepo.setValue('save_code', 'test_save_code_123')

      // 尝试重新首次普查，不提供 save_code
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      expect(result.success).toBe(false)
      expect(result.errorMessage).toContain('save_code')
    })

    it('重新首次普查使用错误的 save_code 应该失败', async () => {
      // 先执行一次首次普查
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // 设置 save_code
      configRepo.setValue('save_code', 'correct_save_code')

      // 尝试使用错误的 save_code 重新首次普查
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY,
        save_code: 'wrong_save_code'
      })

      expect(result.success).toBe(false)
      expect(result.errorMessage).toContain('验证失败')
    })

    it('重新首次普查使用正确的 save_code 应该清空数据表', async () => {
      // 先执行一次首次普查
      const firstResult = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      expect(firstResult.success).toBe(true)

      // 验证有数据
      const initialDistribCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing'
      ).get() as { count: number }
      expect(initialDistribCount.count).toBeGreaterThan(0)

      const initialResourceCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_resources'
      ).get() as { count: number }
      expect(initialResourceCount.count).toBeGreaterThan(0)

      // 设置 save_code
      const saveCode = 'valid_save_code_123'
      configRepo.setValue('save_code', saveCode)

      // 重新首次普查
      const secondResult = await scanService.scan({
        directory: scanDir,
        extensions: ['.pdf'], // 使用不同的后缀
        scan_mode: ScanMode.FULL_INVENTORY,
        save_code: saveCode
      })

      expect(secondResult.success).toBe(true)

      // 验证旧数据已清除，只有新数据
      const finalDistribCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing'
      ).get() as { count: number }
      expect(finalDistribCount.count).toBe(1) // 只有 1 个 .pdf 文件

      const finalResourceCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_resources'
      ).get() as { count: number }
      expect(finalResourceCount.count).toBe(1)
    })
  })

  describe('DAILY_CHECK - 日常盘点', () => {
    it('没有首次普查时日常盘点应该失败', async () => {
      // 验证没有首次普查
      expect(configRepo.hasFullInventory()).toBe(false)

      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      expect(result.success).toBe(false)
      expect(result.errorMessage).toContain('首次普查')
    })

    it('日常盘点不应更新 FULL_INVENTORY_TIME', async () => {
      // 先执行首次普查
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      const inventoryTime = configRepo.getFullInventoryTime()

      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 100))

      // 执行日常盘点
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      expect(result.success).toBe(true)

      // 验证 FULL_INVENTORY_TIME 没有变化
      const newInventoryTime = configRepo.getFullInventoryTime()
      expect(newInventoryTime).toBe(inventoryTime)
    })

    it('日常盘点应该通过 scan_found_count=0 标记删除文件', async () => {
      // 先执行首次普查
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // 验证首次普查有数据
      const initialCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing WHERE disable = 0'
      ).get() as { count: number }
      expect(initialCount.count).toBe(3) // 3 个 .doc 文件

      // 等待一小段时间，确保时间差异
      await new Promise(resolve => setTimeout(resolve, 100))

      // 执行日常盘点（使用不同的目录，这样旧记录会被标记为删除）
      const emptyDir = path.join(testDir, 'empty_daily')
      await fs.mkdir(emptyDir, { recursive: true })

      const result = await scanService.scan({
        directory: emptyDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      expect(result.success).toBe(true)

      // 验证旧记录通过 scan_found_count=0 标记为删除（不是 disable=1）
      const deletedCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing WHERE disable = 0 AND scan_found_count = 0'
      ).get() as { count: number }
      expect(deletedCount.count).toBe(3) // 原来的 3 条被标记为删除

      // 清理
      await fs.rm(emptyDir, { recursive: true, force: true })
    })

    it('日常盘点正常文件的 scan_found_count 应该增加', async () => {
      // 先执行首次普查
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 100))

      // 执行日常盘点，扫描同样的目录
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      expect(result.success).toBe(true)

      // 所有记录应该保持活动状态，且 scan_found_count 增加到 2
      const activeCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing WHERE disable = 0 AND scan_found_count = 2'
      ).get() as { count: number }
      expect(activeCount.count).toBe(3) // 3 条记录的 scan_found_count 都是 2
    })
  })

  describe('TARGETED_SCAN - 定点扫描', () => {
    it('定点扫描必须指定 workspace', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.TARGETED_SCAN
      })

      expect(result.success).toBe(false)
      expect(result.errorMessage).toContain('workspace')
    })

    it('定点扫描只扫描 workspace 目录，忽略 directory', async () => {
      const result = await scanService.scan({
        directory: scanDir,  // 这个目录应该被忽略
        extensions: ['.doc', '.xlsx'],
        workspace: workspaceDir,
        scan_mode: ScanMode.TARGETED_SCAN
      })

      expect(result.success).toBe(true)

      // 验证只扫描了 workspace 中的文件
      const records = dbService.getDb().prepare(
        'SELECT path FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ path: string }>

      // workspace 中有 2 个文件：ws1.doc 和 ws2.xlsx
      expect(records.length).toBe(2)

      // 验证所有记录都在 workspace 目录下
      for (const record of records) {
        expect(record.path.startsWith(workspaceDir)).toBe(true)
      }

      // 验证没有扫描 scanDir 中的文件
      const scanDirRecords = records.filter(r => r.path.startsWith(scanDir))
      expect(scanDirRecords.length).toBe(0)
    })

    it('定点扫描不需要先进行首次普查', async () => {
      // 验证没有首次普查
      expect(configRepo.hasFullInventory()).toBe(false)

      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir,
        scan_mode: ScanMode.TARGETED_SCAN
      })

      expect(result.success).toBe(true)
    })

    it('定点扫描不应设置 FULL_INVENTORY_TIME', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir,
        scan_mode: ScanMode.TARGETED_SCAN
      })

      expect(result.success).toBe(true)

      // 验证没有设置 FULL_INVENTORY_TIME
      expect(configRepo.hasFullInventory()).toBe(false)
    })

    it('定点扫描应扫描 workspace 中的所有文件（自动收集所有后缀）', async () => {
      // 只传递 .doc 后缀，但定点扫描应该自动收集 workspace 中的所有后缀
      // workspace 目录中有 ws1.doc 和 ws2.xlsx，应该都被扫描
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'], // 只传递 .doc
        workspace: workspaceDir,
        scan_mode: ScanMode.TARGETED_SCAN
      })

      expect(result.success).toBe(true)
      // 应该扫描 workspace 中的所有文件（ws1.doc 和 ws2.xlsx）
      // 因为定点扫描会收集 workspace 中所有文件后缀并合并
      expect(result.totalFiles).toBe(2)
      expect(result.scannedFiles).toBe(2)

      // 验证 usedExtensions 包含了 workspace 中的所有后缀
      expect(result.usedExtensions).toBeDefined()
      expect(result.usedExtensions).toContain('.doc')
      expect(result.usedExtensions).toContain('.xlsx')
    })

    it('定点扫描应该通过 scan_found_count=0 标记删除文件', async () => {
      // 先执行一次定点扫描
      // 注意：定点扫描会自动收集 workspace 中所有后缀，所以会扫描 ws1.doc 和 ws2.xlsx
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir,
        scan_mode: ScanMode.TARGETED_SCAN
      })

      // 验证第一次扫描有数据（workspace 中所有文件）
      const initialCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing WHERE disable = 0'
      ).get() as { count: number }
      expect(initialCount.count).toBe(2) // ws1.doc 和 ws2.xlsx（定点扫描会扫描所有后缀）

      // 等待一小段时间，确保时间差异
      await new Promise(resolve => setTimeout(resolve, 100))

      // 执行第二次定点扫描（扫描空目录）
      const emptyWorkspace = path.join(testDir, 'empty_workspace')
      await fs.mkdir(emptyWorkspace, { recursive: true })

      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: emptyWorkspace,
        scan_mode: ScanMode.TARGETED_SCAN
      })

      expect(result.success).toBe(true)

      // 验证旧记录通过 scan_found_count=0 标记为删除（不是 disable=1）
      const deletedCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing WHERE disable = 0 AND scan_found_count = 0'
      ).get() as { count: number }
      expect(deletedCount.count).toBe(2) // 原来的 2 条被标记为删除（ws1.doc 和 ws2.xlsx）

      // 清理
      await fs.rm(emptyWorkspace, { recursive: true, force: true })
    })

    it('定点扫描正常文件的 scan_found_count 应该增加', async () => {
      // 先执行一次定点扫描
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.xlsx'],
        workspace: workspaceDir,
        scan_mode: ScanMode.TARGETED_SCAN
      })

      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 100))

      // 再次执行定点扫描，扫描同样的 workspace
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.xlsx'],
        workspace: workspaceDir,
        scan_mode: ScanMode.TARGETED_SCAN
      })

      expect(result.success).toBe(true)

      // 新扫描的记录应该保持活动状态，且 scan_found_count 增加到 2
      const activeCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing WHERE disable = 0 AND scan_found_count = 2'
      ).get() as { count: number }
      expect(activeCount.count).toBe(2) // 2 条记录的 scan_found_count 都是 2
    })

    it('定点扫描应该减少删除文件的 data_resources source_count', async () => {
      // 先执行一次定点扫描
      // 注意：定点扫描会自动收集 workspace 中所有后缀，所以会扫描 ws1.doc 和 ws2.xlsx
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir,
        scan_mode: ScanMode.TARGETED_SCAN
      })

      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 100))

      // 执行第二次定点扫描（扫描空目录）
      const emptyWorkspace = path.join(testDir, 'empty_ws_resources')
      await fs.mkdir(emptyWorkspace, { recursive: true })

      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: emptyWorkspace,
        scan_mode: ScanMode.TARGETED_SCAN
      })

      // 删除文件的 data_resources 的 source_count 应该减为 0（不是 disable=1）
      const zeroSourceCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_resources WHERE disable = 0 AND source_count = 0'
      ).get() as { count: number }
      expect(zeroSourceCount.count).toBe(2) // ws1.doc 和 ws2.xlsx 两个唯一 MD5

      // 清理
      await fs.rm(emptyWorkspace, { recursive: true, force: true })
    })
  })

  describe('无扫描模式 - 普通扫描', () => {
    it('不指定 scan_mode 时应该正常扫描', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      expect(result.success).toBe(true)
      expect(result.totalFiles).toBe(3)
    })

    it('普通扫描不应设置 FULL_INVENTORY_TIME', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      expect(configRepo.hasFullInventory()).toBe(false)
    })

    it('普通扫描不应逻辑删除旧记录', async () => {
      // 先执行一次普通扫描
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 100))

      // 再执行一次普通扫描
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      // 两次扫描的记录都应该存在
      const totalCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing WHERE disable = 0'
      ).get() as { count: number }
      expect(totalCount.count).toBe(6) // 3 + 3

      const disabledCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing WHERE disable = 1'
      ).get() as { count: number }
      expect(disabledCount.count).toBe(0)
    })
  })

  describe('扫描模式与 data_resources 表', () => {
    it('首次普查后 data_resources 表应该有正确的记录', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      const resourceCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_resources WHERE disable = 0'
      ).get() as { count: number }

      // 3 个文件，每个文件内容不同，应该有 3 个唯一 MD5
      expect(resourceCount.count).toBe(3)
    })

    it('重新首次普查应该清空 data_resources 表', async () => {
      // 先执行首次普查
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      const saveCode = 'test_code'
      configRepo.setValue('save_code', saveCode)

      // 重新首次普查
      await scanService.scan({
        directory: scanDir,
        extensions: ['.pdf'],
        scan_mode: ScanMode.FULL_INVENTORY,
        save_code: saveCode
      })

      const resourceCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_resources'
      ).get() as { count: number }

      // 只有 1 个 pdf 文件的记录
      expect(resourceCount.count).toBe(1)
    })

    it('日常盘点应该减少删除文件的 source_count', async () => {
      // 先执行首次普查
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      // 验证首次普查有 data_resources 记录
      const initialCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_resources WHERE disable = 0 AND source_count > 0'
      ).get() as { count: number }
      expect(initialCount.count).toBe(3)

      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 100))

      // 执行日常盘点（扫描空目录）
      const emptyDir = path.join(testDir, 'empty_resources')
      await fs.mkdir(emptyDir, { recursive: true })

      await scanService.scan({
        directory: emptyDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.DAILY_CHECK
      })

      // 所有 data_resources 记录的 source_count 应该减为 0（不是 disable=1）
      const zeroSourceCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_resources WHERE disable = 0 AND source_count = 0'
      ).get() as { count: number }
      expect(zeroSourceCount.count).toBe(3)

      // 清理
      await fs.rm(emptyDir, { recursive: true, force: true })
    })
  })

  describe('扫描参数验证', () => {
    it('scan_args 应该包含 scan_mode', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        scan_mode: ScanMode.FULL_INVENTORY
      })

      const task = dbService.getDb().prepare(
        'SELECT scan_args FROM scan_task WHERE id = ?'
      ).get(result.taskId) as { scan_args: string }

      const scanArgs = JSON.parse(task.scan_args)
      expect(scanArgs.scan_mode).toBe(ScanMode.FULL_INVENTORY)
    })

    it('定点扫描时 file_scan_range 应该是 workspace 目录', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir,
        scan_mode: ScanMode.TARGETED_SCAN
      })

      const task = dbService.getDb().prepare(
        'SELECT file_scan_range FROM scan_task WHERE id = ?'
      ).get(result.taskId) as { file_scan_range: string }

      expect(task.file_scan_range).toBe(workspaceDir)
    })

    it('定点扫描时 workspace_path 应该正确保存', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir,
        scan_mode: ScanMode.TARGETED_SCAN
      })

      expect(result.success).toBe(true)

      const task = dbService.getDb().prepare(
        'SELECT workspace_path FROM scan_task WHERE id = ?'
      ).get(result.taskId) as { workspace_path: string }

      // 验证 workspace_path 不为空，应该等于传入的 workspace
      expect(task.workspace_path).toBe(workspaceDir)
    })
  })
})
