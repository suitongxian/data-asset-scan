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

// HTTP POST 请求工具函数
function httpPost(url: string, body: object): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const postData = JSON.stringify(body)

    const req = http.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let responseBody = ''
      res.on('data', chunk => responseBody += chunk)
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: responseBody }))
      res.on('error', reject)
    })

    req.on('error', reject)
    req.write(postData)
    req.end()
  })
}

// HTTP GET 请求工具函数
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

describe('HttpScanService - Upload and Config', () => {
  let testDir: string
  let dbDir: string
  let sqlPath: string
  let configPath: string
  let dbPath: string
  let dbService: DatabaseService
  let httpService: HttpScanService
  let configService: ConfigService
  let configRepo: SystemConfigRepository

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `http-upload-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
    await fs.writeFile(path.join(testDir, 'test.txt'), 'Hello World')

    // 创建数据库目录
    dbDir = path.join(os.tmpdir(), `http-upload-db-${Date.now()}`)
    await fs.mkdir(dbDir, { recursive: true })

    // 创建 config.yaml
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
    await fs.rm(dbDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    dbPath = path.join(dbDir, `test-${Date.now()}.db`)
    dbService = new DatabaseService({ dbPath, sqlPath })
    dbService.init()

    configRepo = new SystemConfigRepository(dbService.getDb())
    configRepo.setWorkspace(testDir)

    configService = new ConfigService({ configPath })

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

  describe('GET /config - upload_server_url', () => {
    it('should return null when upload_server_url not configured', async () => {
      const { statusCode, body } = await httpGet(`${httpService.address}/config`)
      const data = JSON.parse(body)

      expect(statusCode).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.upload_server_url).toBeNull()
    })

    it('should return configured upload_server_url', async () => {
      configRepo.setUploadServerUrl('http://upload.example.com')

      const { statusCode, body } = await httpGet(`${httpService.address}/config`)
      const data = JSON.parse(body)

      expect(statusCode).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.upload_server_url).toBe('http://upload.example.com')
    })
  })

  describe('POST /config - upload_server_url', () => {
    it('should save upload_server_url', async () => {
      const { statusCode, body } = await httpPost(`${httpService.address}/config`, {
        upload_server_url: 'http://new-upload.example.com'
      })
      const data = JSON.parse(body)

      expect(statusCode).toBe(200)
      expect(data.success).toBe(true)

      // 验证已保存
      const savedUrl = configRepo.getUploadServerUrl()
      expect(savedUrl).toBe('http://new-upload.example.com')
    })

    it('should update existing upload_server_url', async () => {
      configRepo.setUploadServerUrl('http://old.example.com')

      const { statusCode } = await httpPost(`${httpService.address}/config`, {
        upload_server_url: 'http://updated.example.com'
      })

      expect(statusCode).toBe(200)

      const savedUrl = configRepo.getUploadServerUrl()
      expect(savedUrl).toBe('http://updated.example.com')
    })
  })

  describe('POST /upload', () => {
    it('should return error for missing parameters', async () => {
      const { statusCode, body } = await httpPost(`${httpService.address}/upload`, {})
      const data = JSON.parse(body)

      expect(statusCode).toBe(400)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Missing required parameters')
    })

    it('should return error for missing filePath', async () => {
      const { statusCode, body } = await httpPost(`${httpService.address}/upload`, {
        serverUrl: 'http://example.com'
      })
      const data = JSON.parse(body)

      expect(statusCode).toBe(400)
      expect(data.success).toBe(false)
    })

    it('should return error for missing serverUrl', async () => {
      const { statusCode, body } = await httpPost(`${httpService.address}/upload`, {
        filePath: '/some/path/file.txt'
      })
      const data = JSON.parse(body)

      expect(statusCode).toBe(400)
      expect(data.success).toBe(false)
    })

    it('should return error for non-existent file', async () => {
      const { statusCode, body } = await httpPost(`${httpService.address}/upload`, {
        filePath: '/non/existent/file.txt',
        serverUrl: 'http://example.com/api/file/upload'
      })
      const data = JSON.parse(body)

      expect(statusCode).toBe(200)
      expect(data.success).toBe(false)
      expect(data.message).toBeDefined()
    })

    it('should return error when target server is unavailable', async () => {
      const testFile = path.join(testDir, 'test.txt')

      const { statusCode, body } = await httpPost(`${httpService.address}/upload`, {
        filePath: testFile,
        serverUrl: 'http://localhost:59999/api/file/upload'
      })
      const data = JSON.parse(body)

      expect(statusCode).toBe(200)
      expect(data.success).toBe(false)
      expect(data.message).toContain('上传错误')
    })
  })
})
