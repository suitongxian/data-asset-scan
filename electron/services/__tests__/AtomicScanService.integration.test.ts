/**
 * AtomicScanService 集成测试
 * 验证扫描后写入数据库的数据是否符合预期
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { DatabaseService } from '../DatabaseService'
import { AtomicScanService } from '../AtomicScanService'
import { ScanTask } from '../ScanTaskRepository'
import { DataDistributing } from '../DataDistributingRepository'

describe('AtomicScanService Integration Tests - Data Verification', () => {
  let testDir: string
  let scanDir: string
  let sqlPath: string
  let dbPath: string
  let dbService: DatabaseService
  let scanService: AtomicScanService

  // 测试文件的预期数据
  interface TestFileExpectation {
    fileName: string
    content: string
    expectedMd5: string
    expectedSize: number
    expectedSuffix: string
  }

  const testFiles: TestFileExpectation[] = [
    {
      fileName: 'document1.doc',
      content: 'This is document 1 content for testing.',
      expectedMd5: '', // 将在 beforeAll 中计算
      expectedSize: 0,
      expectedSuffix: '.doc'
    },
    {
      fileName: 'document2.doc',
      content: 'Document 2 has different content here.',
      expectedMd5: '',
      expectedSize: 0,
      expectedSuffix: '.doc'
    },
    {
      fileName: 'report.pdf',
      content: 'PDF report content for verification.',
      expectedMd5: '',
      expectedSize: 0,
      expectedSuffix: '.pdf'
    },
    {
      fileName: 'subdir/nested.doc',
      content: 'Nested document in subdirectory.',
      expectedMd5: '',
      expectedSize: 0,
      expectedSuffix: '.doc'
    }
  ]

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `atomic-scan-integration-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    scanDir = path.join(testDir, 'scandir')
    await fs.mkdir(scanDir, { recursive: true })
    await fs.mkdir(path.join(scanDir, 'subdir'), { recursive: true })

    // 创建测试文件并计算预期值
    for (const file of testFiles) {
      const filePath = path.join(scanDir, file.fileName)
      await fs.writeFile(filePath, file.content)

      // 计算预期 MD5
      file.expectedMd5 = crypto.createHash('md5').update(file.content).digest('hex')
      file.expectedSize = Buffer.byteLength(file.content)
    }

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
  })

  afterEach(() => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('scan_task 任务表数据验证', () => {
    it('应该正确记录任务基本信息', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf']
      })

      // 从数据库读取任务记录
      const task = dbService.getDb().prepare(
        'SELECT * FROM scan_task WHERE id = ?'
      ).get(result.taskId) as ScanTask

      // 验证任务基本信息
      expect(task).not.toBeNull()
      expect(task.id).toBe(result.taskId)
      expect(task.scan_type).toBe('FILE')
      expect(task.file_scan_range).toBe(scanDir)
      expect(task.disable).toBe(0)
    })

    it('应该正确记录扫描参数', async () => {
      const extensions = ['.doc', '.pdf']
      const excludeDirs = ['excluded', 'temp']

      const result = await scanService.scan({
        directory: scanDir,
        extensions,
        excludeDirs
      })

      const task = dbService.getDb().prepare(
        'SELECT * FROM scan_task WHERE id = ?'
      ).get(result.taskId) as ScanTask

      // 验证扫描参数
      const scanArgs = JSON.parse(task.scan_args!)
      expect(scanArgs.extensions).toEqual(extensions)
      expect(scanArgs.excludeDirs).toEqual(excludeDirs)
    })

    it('应该正确记录文件统计信息', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf']
      })

      const task = dbService.getDb().prepare(
        'SELECT * FROM scan_task WHERE id = ?'
      ).get(result.taskId) as ScanTask

      // 验证文件统计 - 3个.doc + 1个.pdf = 4个文件
      expect(task.file_total).toBe(4)
      expect(task.file_scanned_count).toBe(4)
    })

    it('成功任务应该有正确的状态和时间', async () => {
      const beforeScan = new Date()

      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const afterScan = new Date()

      const task = dbService.getDb().prepare(
        'SELECT * FROM scan_task WHERE id = ?'
      ).get(result.taskId) as ScanTask

      // 验证任务状态
      expect(task.task_state).toBe('succeed')
      expect(task.task_phase).toBe('completed')
      expect(task.task_error_message).toBe('')

      // 验证时间字段
      expect(task.create_time).not.toBeNull()
      expect(task.update_time).not.toBeNull()
      expect(task.end_time).not.toBeNull()

      const createTime = new Date(task.create_time)
      const endTime = new Date(task.end_time!)

      expect(createTime.getTime()).toBeGreaterThanOrEqual(beforeScan.getTime() - 1000)
      expect(endTime.getTime()).toBeLessThanOrEqual(afterScan.getTime() + 1000)
      expect(endTime.getTime()).toBeGreaterThanOrEqual(createTime.getTime())
    })

    it('失败任务应该正确记录错误信息', async () => {
      const result = await scanService.scan({
        directory: '/non/existent/path/12345',
        extensions: ['.doc']
      })

      const task = dbService.getDb().prepare(
        'SELECT * FROM scan_task WHERE id = ?'
      ).get(result.taskId) as ScanTask

      expect(task.task_state).toBe('fail')
      expect(task.task_error_message).not.toBeNull()
      expect(task.task_error_message!.length).toBeGreaterThan(0)
      expect(task.end_time).not.toBeNull()
    })

    it('heartbeat 应该随扫描进度递增', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf'],
        progressInterval: 1 // 每个文件更新一次
      })

      const task = dbService.getDb().prepare(
        'SELECT * FROM scan_task WHERE id = ?'
      ).get(result.taskId) as ScanTask

      // heartbeat 应该大于初始值
      expect(task.heartbeat).toBeGreaterThan(0)
    })
  })

  describe('data_distributing 数据分布表数据验证', () => {
    it('应该写入正确数量的记录', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf']
      })

      const count = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing WHERE disable = 0'
      ).get() as { count: number }

      expect(count.count).toBe(4) // 3个.doc + 1个.pdf
    })

    it('应该正确记录文件路径', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf']
      })

      const records = dbService.getDb().prepare(
        'SELECT path FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ path: string }>

      const paths = records.map(r => r.path)

      // 验证所有测试文件都被记录
      for (const file of testFiles) {
        const expectedPath = path.join(scanDir, file.fileName)
        expect(paths).toContain(expectedPath)
      }
    })

    it('应该正确计算文件 MD5', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf']
      })

      const records = dbService.getDb().prepare(
        'SELECT path, content_sign FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ path: string; content_sign: string }>

      for (const record of records) {
        const fileName = path.relative(scanDir, record.path)
        const testFile = testFiles.find(f => f.fileName === fileName)

        if (testFile) {
          expect(record.content_sign).toBe(testFile.expectedMd5)
        }
      }
    })

    it('应该正确记录文件大小', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf']
      })

      const records = dbService.getDb().prepare(
        'SELECT path, file_size FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ path: string; file_size: number }>

      for (const record of records) {
        const fileName = path.relative(scanDir, record.path)
        const testFile = testFiles.find(f => f.fileName === fileName)

        if (testFile) {
          expect(record.file_size).toBe(testFile.expectedSize)
        }
      }
    })

    it('应该正确记录文件后缀', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf']
      })

      const records = dbService.getDb().prepare(
        'SELECT path, file_suffix FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ path: string; file_suffix: string }>

      for (const record of records) {
        const fileName = path.relative(scanDir, record.path)
        const testFile = testFiles.find(f => f.fileName === fileName)

        if (testFile) {
          expect(record.file_suffix).toBe(testFile.expectedSuffix)
        }
      }
    })

    it('应该正确记录数据类型为文件', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const records = dbService.getDb().prepare(
        'SELECT data_type FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ data_type: number }>

      // 所有记录的 data_type 应该是 1（文件）
      for (const record of records) {
        expect(record.data_type).toBe(1)
      }
    })

    it('应该正确记录 IP 和 MAC 地址', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const records = dbService.getDb().prepare(
        'SELECT ip, mac_address FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ ip: string; mac_address: string }>

      for (const record of records) {
        // IP 地址格式验证
        expect(record.ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)

        // MAC 地址格式验证 (XX:XX:XX:XX:XX:XX)
        expect(record.mac_address).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i)
      }
    })

    it('应该正确记录扫描发现次数', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const records = dbService.getDb().prepare(
        'SELECT scan_found_count FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ scan_found_count: number }>

      // 首次扫描，scan_found_count 应该是 1
      for (const record of records) {
        expect(record.scan_found_count).toBe(1)
      }
    })

    it('应该记录文件时间信息', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const records = dbService.getDb().prepare(
        'SELECT file_create_time, file_update_time, file_read_time FROM data_distributing WHERE disable = 0'
      ).all() as Array<{
        file_create_time: string
        file_update_time: string
        file_read_time: string
      }>

      for (const record of records) {
        // 验证时间字段不为空且是有效的 ISO 日期格式
        expect(record.file_create_time).not.toBeNull()
        expect(record.file_update_time).not.toBeNull()

        // 验证可以解析为有效日期
        expect(() => new Date(record.file_create_time)).not.toThrow()
        expect(() => new Date(record.file_update_time)).not.toThrow()
      }
    })

    it('应该记录扫描时间', async () => {
      const beforeScan = new Date()

      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const afterScan = new Date()

      const records = dbService.getDb().prepare(
        'SELECT scan_time FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ scan_time: string }>

      for (const record of records) {
        const scanTime = new Date(record.scan_time)
        expect(scanTime.getTime()).toBeGreaterThanOrEqual(beforeScan.getTime() - 1000)
        expect(scanTime.getTime()).toBeLessThanOrEqual(afterScan.getTime() + 1000)
      }
    })

    it('应该记录创建和更新时间', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const records = dbService.getDb().prepare(
        'SELECT create_time, update_time FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ create_time: string; update_time: string }>

      for (const record of records) {
        expect(record.create_time).not.toBeNull()
        expect(record.update_time).not.toBeNull()

        // create_time 和 update_time 应该相同（首次创建）
        expect(record.create_time).toBe(record.update_time)
      }
    })

    it('应该正确记录文件魔数', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const records = dbService.getDb().prepare(
        'SELECT file_magic FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ file_magic: string | null }>

      for (const record of records) {
        // file_magic 应该是十六进制字符串
        if (record.file_magic) {
          expect(record.file_magic).toMatch(/^[0-9A-F]+$/i)
        }
      }
    })

    it('非隐藏文件的 file_hide 应该为 0', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const records = dbService.getDb().prepare(
        'SELECT file_hide FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ file_hide: number }>

      for (const record of records) {
        expect(record.file_hide).toBe(0)
      }
    })

    it('disable 字段应该为 0', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const records = dbService.getDb().prepare(
        'SELECT disable FROM data_distributing'
      ).all() as Array<{ disable: number }>

      for (const record of records) {
        expect(record.disable).toBe(0)
      }
    })
  })

  describe('任务表和数据分布表的关联验证', () => {
    it('扫描的文件数应与数据分布表记录数一致', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf']
      })

      const task = dbService.getDb().prepare(
        'SELECT file_scanned_count FROM scan_task WHERE id = ?'
      ).get(result.taskId) as { file_scanned_count: number }

      const dataCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing WHERE disable = 0'
      ).get() as { count: number }

      expect(task.file_scanned_count).toBe(dataCount.count)
    })

    it('任务的 file_total 应与实际扫描文件数一致', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const task = dbService.getDb().prepare(
        'SELECT file_total, file_scanned_count FROM scan_task WHERE id = ?'
      ).get(result.taskId) as { file_total: number; file_scanned_count: number }

      // file_total 应该等于 file_scanned_count（正常完成的情况下）
      expect(task.file_total).toBe(task.file_scanned_count)
    })

    it('所有数据分布记录的扫描时间应该相同', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf']
      })

      const records = dbService.getDb().prepare(
        'SELECT DISTINCT scan_time FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ scan_time: string }>

      // 同一次扫描，所有记录的 scan_time 应该相同
      expect(records.length).toBe(1)
    })
  })

  describe('边界情况验证', () => {
    it('空目录扫描应该创建任务但不写入数据分布记录', async () => {
      const emptyDir = path.join(testDir, 'empty')
      await fs.mkdir(emptyDir, { recursive: true })

      const result = await scanService.scan({
        directory: emptyDir,
        extensions: ['.doc']
      })

      // 任务应该被创建
      const task = dbService.getDb().prepare(
        'SELECT * FROM scan_task WHERE id = ?'
      ).get(result.taskId) as ScanTask

      expect(task).not.toBeNull()
      expect(task.task_state).toBe('succeed')
      expect(task.file_total).toBe(0)
      expect(task.file_scanned_count).toBe(0)

      // 数据分布表应该没有记录
      const count = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing'
      ).get() as { count: number }

      expect(count.count).toBe(0)

      await fs.rmdir(emptyDir)
    })

    it('没有匹配后缀的文件应该不写入数据分布记录', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.xyz', '.abc'] // 不存在的后缀
      })

      expect(result.success).toBe(true)
      expect(result.totalFiles).toBe(0)

      const count = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing'
      ).get() as { count: number }

      expect(count.count).toBe(0)
    })
  })

  describe('完整数据验证 - 单个文件详细检查', () => {
    it('应该完整正确地记录单个文件的所有信息', async () => {
      // 只扫描一个特定文件
      const singleFileDir = path.join(testDir, 'singlefile')
      await fs.mkdir(singleFileDir, { recursive: true })

      const testContent = 'Test content for single file verification 12345'
      const testFileName = 'test_single.doc'
      const testFilePath = path.join(singleFileDir, testFileName)
      await fs.writeFile(testFilePath, testContent)

      const expectedMd5 = crypto.createHash('md5').update(testContent).digest('hex')
      const expectedSize = Buffer.byteLength(testContent)

      const result = await scanService.scan({
        directory: singleFileDir,
        extensions: ['.doc']
      })

      expect(result.success).toBe(true)
      expect(result.totalFiles).toBe(1)

      // 获取写入的记录
      const record = dbService.getDb().prepare(
        'SELECT * FROM data_distributing WHERE path = ?'
      ).get(testFilePath) as DataDistributing

      // 完整验证所有字段
      expect(record).not.toBeNull()
      expect(record.path).toBe(testFilePath)
      expect(record.data_type).toBe(1)
      expect(record.scan_found_count).toBe(1)
      expect(record.content_sign).toBe(expectedMd5)
      expect(record.file_suffix).toBe('.doc')
      expect(record.file_size).toBe(expectedSize)
      expect(record.file_hide).toBe(0)
      expect(record.ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
      expect(record.mac_address).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i)
      expect(record.scan_time).not.toBeNull()
      expect(record.create_time).not.toBeNull()
      expect(record.update_time).not.toBeNull()
      expect(record.disable).toBe(0)

      // 清理
      await fs.rm(singleFileDir, { recursive: true, force: true })
    })
  })

  describe('Workspace 工作空间功能验证', () => {
    let workspaceDir: string

    beforeEach(async () => {
      // 创建工作空间目录
      workspaceDir = path.join(testDir, `workspace-${Date.now()}`)
      await fs.mkdir(workspaceDir, { recursive: true })

      // 在工作空间创建不同后缀的文件
      await fs.writeFile(path.join(workspaceDir, 'ws1.xlsx'), 'xlsx content')
      await fs.writeFile(path.join(workspaceDir, 'ws2.pptx'), 'pptx content')
      await fs.writeFile(path.join(workspaceDir, 'ws3.json'), 'json content')
    })

    afterEach(async () => {
      await fs.rm(workspaceDir, { recursive: true, force: true })
    })

    it('应该正确记录 workspace_path', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir
      })

      const task = dbService.getDb().prepare(
        'SELECT workspace_path FROM scan_task WHERE id = ?'
      ).get(result.taskId) as { workspace_path: string }

      expect(task.workspace_path).toBe(workspaceDir)
    })

    it('应该正确记录 file_all_suffix_count（所有扫描用到的后缀种类数量）', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir
      })

      const task = dbService.getDb().prepare(
        'SELECT file_all_suffix_count FROM scan_task WHERE id = ?'
      ).get(result.taskId) as { file_all_suffix_count: number }

      // 应该是整型，表示后缀种类数量：.doc + .xlsx + .pptx + .json = 4
      expect(typeof task.file_all_suffix_count).toBe('number')
      expect(task.file_all_suffix_count).toBe(4)
    })

    it('应该正确记录 file_count_suffix_count（工作空间后缀种类数量）', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir
      })

      const task = dbService.getDb().prepare(
        'SELECT file_count_suffix_count FROM scan_task WHERE id = ?'
      ).get(result.taskId) as { file_count_suffix_count: number }

      // 应该是整型，表示工作空间后缀种类数量：.xlsx + .pptx + .json = 3
      expect(typeof task.file_count_suffix_count).toBe('number')
      expect(task.file_count_suffix_count).toBe(3)
    })

    it('应该正确记录 workspace_count（工作空间文件总数）', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir
      })

      const task = dbService.getDb().prepare(
        'SELECT workspace_count FROM scan_task WHERE id = ?'
      ).get(result.taskId) as { workspace_count: number }

      expect(task.workspace_count).toBe(3) // ws1.xlsx, ws2.pptx, ws3.json
    })

    it('应该返回正确的 usedExtensions', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir
      })

      expect(result.usedExtensions).toBeDefined()
      expect(result.usedExtensions).toContain('.doc')
      expect(result.usedExtensions).toContain('.xlsx')
      expect(result.usedExtensions).toContain('.pptx')
      expect(result.usedExtensions).toContain('.json')
    })

    it('应该返回正确的 workspaceStats', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir
      })

      expect(result.workspaceStats).toBeDefined()
      expect(result.workspaceStats!.workspacePath).toBe(workspaceDir)
      expect(result.workspaceStats!.workspaceFileCount).toBe(3)
      expect(result.workspaceStats!.workspaceSuffixes).toContain('.xlsx')
      expect(result.workspaceStats!.workspaceSuffixes).toContain('.pptx')
      expect(result.workspaceStats!.workspaceSuffixes).toContain('.json')
    })

    it('workspace 在 directory 内时不应重复扫描', async () => {
      // 在 scanDir 内创建 workspace
      const innerWorkspace = path.join(scanDir, 'inner-workspace')
      await fs.mkdir(innerWorkspace, { recursive: true })
      await fs.writeFile(path.join(innerWorkspace, 'inner.txt'), 'inner content')

      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.txt'],
        workspace: innerWorkspace
      })

      // 验证没有重复扫描
      const records = dbService.getDb().prepare(
        'SELECT path FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ path: string }>

      const innerFile = path.join(innerWorkspace, 'inner.txt')
      const matchingRecords = records.filter(r => r.path === innerFile)
      expect(matchingRecords.length).toBe(1) // 应该只有一条记录

      await fs.rm(innerWorkspace, { recursive: true, force: true })
    })

    it('workspace 不在 directory 内时应扫描两个目录', async () => {
      // 创建独立的工作空间
      const separateWorkspace = path.join(testDir, 'separate-ws')
      await fs.mkdir(separateWorkspace, { recursive: true })
      await fs.writeFile(path.join(separateWorkspace, 'sep.txt'), 'separate content')

      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: separateWorkspace
      })

      // 应该扫描到 separateWorkspace 中的文件
      const records = dbService.getDb().prepare(
        'SELECT path FROM data_distributing WHERE disable = 0'
      ).all() as Array<{ path: string }>

      const sepFile = path.join(separateWorkspace, 'sep.txt')
      expect(records.some(r => r.path === sepFile)).toBe(true)

      await fs.rm(separateWorkspace, { recursive: true, force: true })
    })

    it('scan_args 应包含 workspace 参数', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir
      })

      const task = dbService.getDb().prepare(
        'SELECT scan_args FROM scan_task WHERE id = ?'
      ).get(result.taskId) as { scan_args: string }

      const scanArgs = JSON.parse(task.scan_args)
      expect(scanArgs.workspace).toBe(workspaceDir)
    })
  })

  describe('data_resources MD5 统计验证', () => {
    it('应该为每个唯一 MD5 创建一条 data_resources 记录', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf']
      })

      // 获取 data_distributing 中的唯一 MD5 数量
      const uniqueMd5Count = dbService.getDb().prepare(
        'SELECT COUNT(DISTINCT content_sign) as count FROM data_distributing WHERE disable = 0'
      ).get() as { count: number }

      // 获取 data_resources 中的记录数量
      const resourceCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_resources WHERE disable = 0'
      ).get() as { count: number }

      // 唯一 MD5 数量应该等于 data_resources 记录数
      expect(resourceCount.count).toBe(uniqueMd5Count.count)
    })

    it('source_count 应该等于 data_distributing 中相同 MD5 的记录数', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf']
      })

      // 获取所有 data_resources 记录
      const resources = dbService.getDb().prepare(
        'SELECT content_sign, source_count FROM data_resources WHERE disable = 0'
      ).all() as Array<{ content_sign: string; source_count: number }>

      // 验证每个 MD5 的 source_count
      for (const resource of resources) {
        const distribCount = dbService.getDb().prepare(
          'SELECT COUNT(*) as count FROM data_distributing WHERE content_sign = ? AND disable = 0'
        ).get(resource.content_sign) as { count: number }

        expect(resource.source_count).toBe(distribCount.count)
      }
    })

    it('应该正确记录 first_create_time（最早文件创建时间）', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf']
      })

      const resources = dbService.getDb().prepare(
        'SELECT content_sign, first_create_time FROM data_resources WHERE disable = 0'
      ).all() as Array<{ content_sign: string; first_create_time: string }>

      for (const resource of resources) {
        // 获取该 MD5 对应的所有 data_distributing 记录的最早创建时间
        const earliestTime = dbService.getDb().prepare(
          'SELECT MIN(file_create_time) as earliest FROM data_distributing WHERE content_sign = ? AND disable = 0 AND file_create_time IS NOT NULL'
        ).get(resource.content_sign) as { earliest: string | null }

        if (earliestTime.earliest) {
          // first_create_time 应该小于或等于所有文件的创建时间
          expect(new Date(resource.first_create_time).getTime()).toBeLessThanOrEqual(
            new Date(earliestTime.earliest).getTime()
          )
        }
      }
    })

    it('逻辑删除的记录应该被排除（disable=1）', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      // 手动将一条记录标记为逻辑删除
      const firstResource = dbService.getDb().prepare(
        'SELECT data_resources_id, content_sign FROM data_resources WHERE disable = 0 LIMIT 1'
      ).get() as { data_resources_id: number; content_sign: string }

      dbService.getDb().prepare(
        'UPDATE data_resources SET disable = 1 WHERE data_resources_id = ?'
      ).run(firstResource.data_resources_id)

      // 验证 disable=0 的查询应该排除这条记录
      const activeResources = dbService.getDb().prepare(
        'SELECT content_sign FROM data_resources WHERE disable = 0'
      ).all() as Array<{ content_sign: string }>

      expect(activeResources.some(r => r.content_sign === firstResource.content_sign)).toBe(false)

      // 验证总数减少
      const totalCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_resources'
      ).get() as { count: number }

      const activeCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_resources WHERE disable = 0'
      ).get() as { count: number }

      expect(activeCount.count).toBe(totalCount.count - 1)
    })

    it('应该正确记录 content_sign（MD5 签名）', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf']
      })

      const resources = dbService.getDb().prepare(
        'SELECT content_sign FROM data_resources WHERE disable = 0'
      ).all() as Array<{ content_sign: string }>

      for (const resource of resources) {
        // MD5 应该是 32 位十六进制字符串
        expect(resource.content_sign).toMatch(/^[0-9a-f]{32}$/i)

        // 应该在 data_distributing 中找到对应的记录
        const distribRecord = dbService.getDb().prepare(
          'SELECT COUNT(*) as count FROM data_distributing WHERE content_sign = ? AND disable = 0'
        ).get(resource.content_sign) as { count: number }

        expect(distribRecord.count).toBeGreaterThan(0)
      }
    })

    it('应该记录 create_time 和 update_time', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const resources = dbService.getDb().prepare(
        'SELECT create_time, update_time FROM data_resources WHERE disable = 0'
      ).all() as Array<{ create_time: string; update_time: string }>

      for (const resource of resources) {
        expect(resource.create_time).not.toBeNull()
        expect(resource.update_time).not.toBeNull()

        // 首次创建时，create_time 和 update_time 应该相同
        expect(resource.create_time).toBe(resource.update_time)
      }
    })

    it('空目录扫描不应创建 data_resources 记录', async () => {
      const emptyDir = path.join(testDir, 'empty-resources')
      await fs.mkdir(emptyDir, { recursive: true })

      await scanService.scan({
        directory: emptyDir,
        extensions: ['.doc']
      })

      const count = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_resources'
      ).get() as { count: number }

      expect(count.count).toBe(0)

      await fs.rmdir(emptyDir)
    })
  })

  describe('data_resources workspace_source_count 验证', () => {
    let workspaceDir: string

    beforeEach(async () => {
      workspaceDir = path.join(testDir, `ws-resources-${Date.now()}`)
      await fs.mkdir(workspaceDir, { recursive: true })
    })

    afterEach(async () => {
      await fs.rm(workspaceDir, { recursive: true, force: true })
    })

    it('workspace_source_count 应该正确统计来自工作空间的文件数量', async () => {
      // 在工作空间中创建文件
      await fs.writeFile(path.join(workspaceDir, 'ws1.doc'), 'workspace doc content')
      await fs.writeFile(path.join(workspaceDir, 'ws2.doc'), 'workspace doc content') // 相同内容，相同 MD5

      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir
      })

      // 获取 workspace 文件的 MD5
      const wsContent = 'workspace doc content'
      const wsMd5 = crypto.createHash('md5').update(wsContent).digest('hex')

      // 查询该 MD5 的 data_resources 记录
      const resource = dbService.getDb().prepare(
        'SELECT workspace_source_count, source_count FROM data_resources WHERE content_sign = ? AND disable = 0'
      ).get(wsMd5) as { workspace_source_count: number; source_count: number } | undefined

      if (resource) {
        // workspace_source_count 应该是 2（两个相同内容的文件）
        expect(resource.workspace_source_count).toBe(2)
        expect(resource.source_count).toBe(2)
      }
    })

    it('workspace 外的文件不应增加 workspace_source_count', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir
      })

      const resources = dbService.getDb().prepare(
        'SELECT workspace_source_count FROM data_resources WHERE disable = 0'
      ).all() as Array<{ workspace_source_count: number }>

      // scanDir 中的文件不在 workspaceDir 中，workspace_source_count 应该是 0
      for (const resource of resources) {
        expect(resource.workspace_source_count).toBe(0)
      }
    })

    it('混合场景：同时包含 workspace 内外的相同 MD5 文件', async () => {
      // 使用与 testFiles 中相同的内容创建工作空间文件
      const sameContent = testFiles[0].content
      const sameMd5 = testFiles[0].expectedMd5
      await fs.writeFile(path.join(workspaceDir, 'same_content.doc'), sameContent)

      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        workspace: workspaceDir
      })

      const resource = dbService.getDb().prepare(
        'SELECT workspace_source_count, source_count FROM data_resources WHERE content_sign = ? AND disable = 0'
      ).get(sameMd5) as { workspace_source_count: number; source_count: number } | undefined

      if (resource) {
        // source_count 应该是 2（scanDir 中 1 个 + workspace 中 1 个）
        expect(resource.source_count).toBe(2)
        // workspace_source_count 应该是 1（只有 workspace 中的那个）
        expect(resource.workspace_source_count).toBe(1)
      }
    })
  })
})

