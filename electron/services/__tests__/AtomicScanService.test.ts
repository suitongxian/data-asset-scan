import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseService } from '../DatabaseService'
import { AtomicScanService, ScanProgressInfo } from '../AtomicScanService'

describe('AtomicScanService', () => {
  let testDir: string
  let scanDir: string
  let sqlPath: string
  let dbPath: string
  let dbService: DatabaseService
  let scanService: AtomicScanService

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `atomic-scan-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    // 创建扫描目录
    scanDir = path.join(testDir, 'scandir')
    await fs.mkdir(scanDir, { recursive: true })

    // 创建测试文件
    await fs.writeFile(path.join(scanDir, 'doc1.doc'), 'Document content 1')
    await fs.writeFile(path.join(scanDir, 'doc2.doc'), 'Document content 2')
    await fs.writeFile(path.join(scanDir, 'file.pdf'), 'PDF content')
    await fs.writeFile(path.join(scanDir, 'text.txt'), 'Text content')

    await fs.mkdir(path.join(scanDir, 'subdir'))
    await fs.writeFile(path.join(scanDir, 'subdir', 'doc3.doc'), 'Document 3')
    await fs.writeFile(path.join(scanDir, 'subdir', 'file2.pdf'), 'PDF 2')

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

-- 文件数量统计表 file_statistics
CREATE TABLE file_statistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_task_id INTEGER NOT NULL,
    file_total INTEGER NOT NULL DEFAULT 0,
    workspace_file_total INTEGER NOT NULL DEFAULT 0,
    history_file_count INTEGER NOT NULL DEFAULT 0,
    non_history_file_count INTEGER NOT NULL DEFAULT 0,
    workspace_file_claimed_count INTEGER NOT NULL DEFAULT 0,
    history_file_claimed_count INTEGER NOT NULL DEFAULT 0,
    non_history_file_claimed_count INTEGER NOT NULL DEFAULT 0,
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

  describe('scan', () => {
    it('should scan files and create task', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      expect(result.success).toBe(true)
      expect(result.taskId).toBeGreaterThan(0)
      expect(result.totalFiles).toBe(3)
      expect(result.scannedFiles).toBe(3)
    })

    it('should store file information in database', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      expect(result.success).toBe(true)

      // 验证数据已写入
      const count = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing WHERE disable = 0'
      ).get() as { count: number }

      expect(count.count).toBe(3)
    })

    it('should support multiple extensions', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf']
      })

      expect(result.success).toBe(true)
      expect(result.totalFiles).toBe(5) // 3 doc + 2 pdf
    })

    it('should update task status on completion', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const task = scanService.getTaskStatus(result.taskId)

      expect(task).not.toBeNull()
      expect(task!.task_state).toBe('succeed')
      expect(task!.end_time).not.toBeNull()
      expect(task!.file_total).toBe(3)
    })

    it('should call progress callback', async () => {
      const progressCalls: ScanProgressInfo[] = []

      await scanService.scan(
        {
          directory: scanDir,
          extensions: ['.doc', '.pdf'],
          progressInterval: 1
        },
        (progress) => progressCalls.push({ ...progress })
      )

      // 应该有多次进度回调
      expect(progressCalls.length).toBeGreaterThan(0)

      // 检查阶段变化
      const phases = progressCalls.map(p => p.phase)
      expect(phases).toContain('counting')
      expect(phases).toContain('scanning')
      expect(phases).toContain('completed')
    })

    it('should handle empty directory', async () => {
      const emptyDir = path.join(testDir, 'empty')
      await fs.mkdir(emptyDir, { recursive: true })

      const result = await scanService.scan({
        directory: emptyDir,
        extensions: ['.doc']
      })

      expect(result.success).toBe(true)
      expect(result.totalFiles).toBe(0)
      expect(result.scannedFiles).toBe(0)

      await fs.rmdir(emptyDir)
    })

    it('should handle non-existent directory', async () => {
      const result = await scanService.scan({
        directory: '/non/existent/path',
        extensions: ['.doc']
      })

      expect(result.success).toBe(false)
      expect(result.errorMessage).toBeDefined()

      // 任务应该被标记为失败
      const task = scanService.getTaskStatus(result.taskId)
      expect(task!.task_state).toBe('fail')
    })

    it('should store correct file metadata', async () => {
      await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const records = dbService.getDb().prepare(
        'SELECT * FROM data_distributing WHERE disable = 0'
      ).all() as Array<{
        path: string
        file_suffix: string
        file_size: number
        content_sign: string
        ip: string
        mac_address: string
      }>

      expect(records.length).toBe(3)

      for (const record of records) {
        expect(record.path).toContain('.doc')
        expect(record.file_suffix).toBe('.doc')
        expect(record.file_size).toBeGreaterThan(0)
        expect(record.content_sign).toMatch(/^[a-f0-9]{32}$/)
        expect(record.ip).toBeDefined()
        expect(record.mac_address).toBeDefined()
      }
    })

    it('should respect excludeDirs option', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc'],
        excludeDirs: ['subdir']
      })

      expect(result.success).toBe(true)
      expect(result.totalFiles).toBe(2) // 只有根目录的 2 个 doc 文件
    })

    it('should record scan duration', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      expect(result.duration).toBeGreaterThan(0)
    })

    it('should handle concurrent MD5 calculations', async () => {
      // 使用不同的并发数
      const result1 = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf'],
        md5Concurrency: 1
      })

      // 重新初始化数据库
      dbService.close()
      dbPath = path.join(testDir, `test-concurrent-${Date.now()}.db`)
      dbService = new DatabaseService({ dbPath, sqlPath })
      dbService.init()
      scanService = new AtomicScanService(dbService.getDb(), 10)

      const result2 = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc', '.pdf'],
        md5Concurrency: 4
      })

      // 两者应该得到相同数量的结果
      expect(result1.totalFiles).toBe(result2.totalFiles)
      expect(result1.scannedFiles).toBe(result2.scannedFiles)
    })
  })

  describe('getTaskStatus', () => {
    it('should return task information', async () => {
      const result = await scanService.scan({
        directory: scanDir,
        extensions: ['.doc']
      })

      const task = scanService.getTaskStatus(result.taskId)

      expect(task).not.toBeNull()
      expect(task!.id).toBe(result.taskId)
      expect(task!.scan_type).toBe('FILE')
      expect(task!.file_scan_range).toBe(scanDir)
    })

    it('should return null for non-existent task', () => {
      const task = scanService.getTaskStatus(99999)
      expect(task).toBeNull()
    })
  })

  describe('performance', () => {
    it('should handle many files efficiently', async () => {
      // 创建多个文件
      const manyFilesDir = path.join(testDir, 'manyfiles')
      await fs.mkdir(manyFilesDir, { recursive: true })

      for (let i = 0; i < 50; i++) {
        await fs.writeFile(
          path.join(manyFilesDir, `file${i}.doc`),
          `Content of file ${i}`
        )
      }

      const startTime = Date.now()
      const result = await scanService.scan({
        directory: manyFilesDir,
        extensions: ['.doc'],
        md5Concurrency: 4,
        batchSize: 20
      })
      const duration = Date.now() - startTime

      expect(result.success).toBe(true)
      expect(result.totalFiles).toBe(50)
      expect(result.scannedFiles).toBe(50)

      // 验证数据库记录
      const count = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing WHERE disable = 0'
      ).get() as { count: number }
      expect(count.count).toBe(50)

      // 清理
      await fs.rm(manyFilesDir, { recursive: true, force: true })
    })
  })
})
