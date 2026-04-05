import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { HttpScanService } from '../HttpScanService'
import { DatabaseService } from '../DatabaseService'
import { ConfigService } from '../ConfigService'
import { SystemConfigRepository } from '../SystemConfigRepository'

// 简单的 HTTP 请求工具函数
function httpGet(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }))
      res.on('error', reject)
    }).on('error', reject)
  })
}

// SSE 事件收集器
interface SSEEvent {
  type: string
  scannedCount: number
  totalCount: number
  elapsedMs: number
  phase?: string
  taskId?: number
  currentFile?: string
  success?: boolean
  errorMessage?: string
}

function collectSSE(url: string): Promise<SSEEvent[]> {
  return new Promise((resolve, reject) => {
    const events: SSEEvent[] = []
    const req = http.get(url, (res) => {
      let buffer = ''
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        // 处理 SSE 数据行
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              events.push(data)
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      })
      res.on('end', () => resolve(events))
      res.on('error', reject)
    })
    req.on('error', reject)
  })
}

describe('HttpScanService', () => {
  let testDir: string
  let service: HttpScanService

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `http-scan-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
    await fs.writeFile(path.join(testDir, 'test1.ts'), 'export const a = 1')
    await fs.writeFile(path.join(testDir, 'test2.vue'), '<template></template>')
    await fs.writeFile(path.join(testDir, 'test3.js'), 'const b = 2')
  })

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    // 使用随机端口避免冲突
    const port = 30000 + Math.floor(Math.random() * 10000)
    service = new HttpScanService({ port, host: '127.0.0.1' })
    await service.start()
  })

  afterEach(async () => {
    await service.stop()
  })

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const { statusCode, body } = await httpGet(`${service.address}/health`)
      const data = JSON.parse(body)

      expect(statusCode).toBe(200)
      expect(data.success).toBe(true)
      expect(data.status).toBe('healthy')
      expect(data.timestamp).toBeDefined()
    })

    it('should indicate atomic scan not available without database', async () => {
      const { body } = await httpGet(`${service.address}/health`)
      const data = JSON.parse(body)

      expect(data.atomicScanAvailable).toBe(false)
    })
  })

  describe('GET /scan', () => {
    it('should scan directory and return files', async () => {
      const url = `${service.address}/scan?dir=${encodeURIComponent(testDir)}&extensions=.ts,.vue`
      const { statusCode, body } = await httpGet(url)
      const data = JSON.parse(body)

      expect(statusCode).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.total).toBe(2)
      expect(data.data.files).toHaveLength(2)
    })

    it('should return error when dir is missing', async () => {
      const url = `${service.address}/scan?extensions=.ts`
      const { statusCode, body } = await httpGet(url)
      const data = JSON.parse(body)

      expect(statusCode).toBe(400)
      expect(data.success).toBe(false)
      expect(data.error).toContain('dir')
    })

    it('should return error when extensions is missing', async () => {
      const url = `${service.address}/scan?dir=${encodeURIComponent(testDir)}`
      const { statusCode, body } = await httpGet(url)
      const data = JSON.parse(body)

      expect(statusCode).toBe(400)
      expect(data.success).toBe(false)
      expect(data.error).toContain('extensions')
    })

    it('should return error for non-existent directory', async () => {
      const url = `${service.address}/scan?dir=/non-existent-12345&extensions=.ts`
      const { statusCode, body } = await httpGet(url)
      const data = JSON.parse(body)

      expect(statusCode).toBe(500)
      expect(data.success).toBe(false)
    })

    it('should handle single extension', async () => {
      const url = `${service.address}/scan?dir=${encodeURIComponent(testDir)}&extensions=.js`
      const { statusCode, body } = await httpGet(url)
      const data = JSON.parse(body)

      expect(statusCode).toBe(200)
      expect(data.data.total).toBe(1)
    })

    it('should handle countOnly mode', async () => {
      const url = `${service.address}/scan?dir=${encodeURIComponent(testDir)}&extensions=.ts,.vue,.js&countOnly=true`
      const { statusCode, body } = await httpGet(url)
      const data = JSON.parse(body)

      expect(statusCode).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.total).toBe(3)
      expect(data.data.files).toHaveLength(0)
    })
  })

  describe('GET /scan/stream (SSE)', () => {
    it('should stream scan progress events', async () => {
      const url = `${service.address}/scan/stream?dir=${encodeURIComponent(testDir)}&extensions=.ts,.vue`
      const events = await collectSSE(url)

      expect(events.length).toBeGreaterThan(0)

      // 检查有 counting 阶段
      const countingEvents = events.filter(e => e.phase === 'counting')
      expect(countingEvents.length).toBeGreaterThan(0)

      // 检查有完成事件
      const completeEvent = events.find(e => e.type === 'complete')
      expect(completeEvent).toBeDefined()
      expect(completeEvent!.success).toBe(true)
      expect(completeEvent!.scannedCount).toBe(2)
      expect(completeEvent!.totalCount).toBe(2)
    })

    it('should include elapsed time in events', async () => {
      const url = `${service.address}/scan/stream?dir=${encodeURIComponent(testDir)}&extensions=.ts`
      const events = await collectSSE(url)

      for (const event of events) {
        expect(event.elapsedMs).toBeDefined()
        expect(typeof event.elapsedMs).toBe('number')
        expect(event.elapsedMs).toBeGreaterThanOrEqual(0)
      }
    })

    it('should support excludeDirs parameter', async () => {
      // 创建子目录
      const subDir = path.join(testDir, 'excluded')
      await fs.mkdir(subDir, { recursive: true })
      await fs.writeFile(path.join(subDir, 'excluded.ts'), 'export const x = 1')

      const url = `${service.address}/scan/stream?dir=${encodeURIComponent(testDir)}&extensions=.ts&excludeDirs=excluded`
      const events = await collectSSE(url)

      const completeEvent = events.find(e => e.type === 'complete')
      expect(completeEvent).toBeDefined()
      // 应该只有 1 个文件（排除了 excluded 目录）
      expect(completeEvent!.scannedCount).toBe(1)

      // 清理
      await fs.rm(subDir, { recursive: true, force: true })
    })

    it('should return error for missing parameters', async () => {
      const url = `${service.address}/scan/stream?extensions=.ts`
      const { statusCode, body } = await httpGet(url)
      const data = JSON.parse(body)

      expect(statusCode).toBe(400)
      expect(data.success).toBe(false)
      expect(data.error).toContain('dir')
    })
  })

  describe('GET /scan/atomic', () => {
    it('should return error when database not configured', async () => {
      const url = `${service.address}/scan/atomic?dir=${encodeURIComponent(testDir)}&extensions=.ts`
      const { statusCode, body } = await httpGet(url)
      const data = JSON.parse(body)

      expect(statusCode).toBe(503)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Database not configured')
    })
  })

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const { statusCode, body } = await httpGet(`${service.address}/unknown`)
      const data = JSON.parse(body)

      expect(statusCode).toBe(404)
      expect(data.success).toBe(false)
      expect(data.error).toBe('Not Found')
    })
  })

  describe('service lifecycle', () => {
    it('should report running status correctly', async () => {
      expect(service.isRunning).toBe(true)
      await service.stop()
      expect(service.isRunning).toBe(false)
    })
  })
})

describe('HttpScanService with Database', () => {
  let testDir: string
  let dbDir: string
  let sqlPath: string
  let configPath: string
  let dbPath: string
  let dbService: DatabaseService
  let httpService: HttpScanService
  let configService: ConfigService

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `http-atomic-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
    await fs.writeFile(path.join(testDir, 'file1.ts'), 'export const a = 1')
    await fs.writeFile(path.join(testDir, 'file2.ts'), 'export const b = 2')

    // 创建数据库目录
    dbDir = path.join(os.tmpdir(), `http-atomic-db-${Date.now()}`)
    await fs.mkdir(dbDir, { recursive: true })

    // 创建 config.yaml（带默认配置）
    configPath = path.join(dbDir, 'config.yaml')
    const configYaml = `
control_type: .ts
save_code: test_code
daily_scan_interval: 15
scan_area_path: ${testDir}
scan_exclude_dir: ''
`
    await fs.writeFile(configPath, configYaml)

    // 创建 database.sql
    sqlPath = path.join(dbDir, 'database.sql')
    const sql = `
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

CREATE TABLE user_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    user_name TEXT NOT NULL,
    department TEXT NOT NULL,
    ip TEXT NOT NULL,
    mac_address TEXT NOT NULL,
    work_address TEXT,
    phone TEXT,
    password_md5 TEXT,
    id_card TEXT UNIQUE,
    create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disable INTEGER NOT NULL DEFAULT 0
);

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
    await fs.rm(dbDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    dbPath = path.join(dbDir, `test-${Date.now()}.db`)
    dbService = new DatabaseService({ dbPath, sqlPath })
    dbService.init()

    // 创建 ConfigService（只从 config.yaml 读取）
    configService = new ConfigService({
      configPath
    })

    // 在数据库中设置 workspace（必须由用户配置）
    // 将 ConfigService 注入到 SystemConfigRepository
    const configRepo = new SystemConfigRepository(dbService.getDb(), configService)
    configRepo.setWorkspace(testDir)

    const port = 30000 + Math.floor(Math.random() * 10000)
    httpService = new HttpScanService({
      port,
      host: '127.0.0.1',
      db: dbService.getDb(),
      configService
    })
    await httpService.start()
  })

  afterEach(async () => {
    await httpService.stop()
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('GET /health with database', () => {
    it('should indicate atomic scan available', async () => {
      const { body } = await httpGet(`${httpService.address}/health`)
      const data = JSON.parse(body)

      expect(data.atomicScanAvailable).toBe(true)
    })
  })

  describe('GET /scan/atomic with database', () => {
    it('should stream atomic scan progress and write to database', async () => {
      const url = `${httpService.address}/scan/atomic?scan_mode=FULL_INVENTORY`
      const events = await collectSSE(url)

      expect(events.length).toBeGreaterThan(0)

      // 检查有完成事件
      const completeEvent = events.find(e => e.type === 'complete')
      expect(completeEvent).toBeDefined()
      expect(completeEvent!.success).toBe(true)
      expect(completeEvent!.scannedCount).toBe(2)
      expect(completeEvent!.taskId).toBeDefined()

      // 验证数据库记录
      const dataCount = dbService.getDb().prepare(
        'SELECT COUNT(*) as count FROM data_distributing WHERE disable = 0'
      ).get() as { count: number }
      expect(dataCount.count).toBe(2)

      // 验证任务记录
      const task = dbService.getDb().prepare(
        'SELECT * FROM scan_task WHERE id = ?'
      ).get(completeEvent!.taskId) as { task_state: string, file_total: number }
      expect(task).toBeDefined()
      expect(task.task_state).toBe('succeed')
      expect(task.file_total).toBe(2)
    })

    it('should include task ID in progress events', async () => {
      const url = `${httpService.address}/scan/atomic?scan_mode=DAILY_CHECK`
      const events = await collectSSE(url)

      // 所有扫描阶段的事件应该有 taskId
      const scanningEvents = events.filter(e => e.phase === 'scanning' || e.phase === 'completed')
      for (const event of scanningEvents) {
        expect(event.taskId).toBeDefined()
        expect(typeof event.taskId).toBe('number')
      }
    })

    it('should track elapsed time accurately', async () => {
      const url = `${httpService.address}/scan/atomic?scan_mode=TARGETED_SCAN`
      const events = await collectSSE(url)

      let lastElapsed = 0
      for (const event of events) {
        expect(event.elapsedMs).toBeGreaterThanOrEqual(lastElapsed)
        lastElapsed = event.elapsedMs
      }

      const completeEvent = events.find(e => e.type === 'complete')
      expect(completeEvent!.elapsedMs).toBeGreaterThan(0)
    })
  })

  describe('setDatabase', () => {
    it('should allow setting database after construction', async () => {
      const port = 30000 + Math.floor(Math.random() * 10000)
      const newService = new HttpScanService({ port, host: '127.0.0.1' })
      await newService.start()

      // 验证原子扫描不可用
      let { body } = await httpGet(`${newService.address}/health`)
      let data = JSON.parse(body)
      expect(data.atomicScanAvailable).toBe(false)

      // 设置数据库
      const db = dbService.getDb()
      newService.setDatabase(db)

      // 验证原子扫描可用
      const response = await httpGet(`${newService.address}/health`)
      data = JSON.parse(response.body)
      expect(data.atomicScanAvailable).toBe(true)

      await newService.stop()
    })
  })
})
