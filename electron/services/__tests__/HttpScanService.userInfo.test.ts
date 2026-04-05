import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { HttpScanService } from '../HttpScanService'
import { DatabaseService } from '../DatabaseService'

// HTTP GET 请求工具函数
function httpGet(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const req = http.get({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname
    }, (res) => {
      let responseBody = ''
      res.on('data', chunk => responseBody += chunk)
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: responseBody }))
      res.on('error', reject)
    })
    req.on('error', reject)
  })
}

// HTTP POST 请求工具函数
function httpPost(url: string, body: object | string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const postData = typeof body === 'string' ? body : JSON.stringify(body)

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

// 延迟函数
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('HttpScanService - UserInfo API', () => {
  let dbDir: string
  let dbPath: string
  let sqlPath: string
  let dbService: DatabaseService
  let httpService: HttpScanService
  const testPort = 3099

  beforeAll(async () => {
    // 创建临时目录
    dbDir = path.join(os.tmpdir(), `http-userinfo-test-${Date.now()}`)
    await fs.mkdir(dbDir, { recursive: true })

    // 创建 database.sql (需要包含所有必需的表)
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
    file_count_suffix_count INTEGER,
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
    upload_state INTEGER DEFAULT 0,
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
`
    await fs.writeFile(sqlPath, sql)
  })

  afterAll(async () => {
    await fs.rm(dbDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    dbPath = path.join(dbDir, `test-${Date.now()}.db`)
    dbService = new DatabaseService({ dbPath, sqlPath })
    dbService.init()

    httpService = new HttpScanService({ port: testPort, host: '127.0.0.1' })
    httpService.setDatabase(dbService.getDb())
    await httpService.start()
  })

  afterEach(async () => {
    await httpService.stop()
    await delay(50) // 等待端口释放
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('GET /user-info', () => {
    it('should return null when no user exists', async () => {
      const response = await httpGet(`http://127.0.0.1:${testPort}/user-info`)
      const result = JSON.parse(response.body)

      expect(result.success).toBe(true)
      expect(result.data).toBeNull()
    })

    it('should return user info when exists', async () => {
      // 先创建用户
      await httpPost(`http://127.0.0.1:${testPort}/user-info`, {
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部',
        phone: '13800138000'
      })

      // 获取用户
      const response = await httpGet(`http://127.0.0.1:${testPort}/user-info`)
      const result = JSON.parse(response.body)

      expect(result.success).toBe(true)
      expect(result.data).not.toBeNull()
      expect(result.data.company_name).toBe('测试公司')
      expect(result.data.user_name).toBe('张三')
      expect(result.data.department).toBe('技术部')
      expect(result.data.phone).toBe('13800138000')
    })
  })

  describe('POST /user-info', () => {
    it('should create new user', async () => {
      const response = await httpPost(`http://127.0.0.1:${testPort}/user-info`, {
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部'
      })
      const result = JSON.parse(response.body)

      expect(result.success).toBe(true)
      expect(result.data.company_name).toBe('测试公司')
      expect(result.data.user_name).toBe('张三')
      expect(result.data.department).toBe('技术部')
      expect(result.message).toBe('用户信息已保存')
    })

    it('should update existing user', async () => {
      // 创建用户
      await httpPost(`http://127.0.0.1:${testPort}/user-info`, {
        company_name: '旧公司',
        user_name: '张三',
        department: '技术部'
      })

      // 更新用户
      const response = await httpPost(`http://127.0.0.1:${testPort}/user-info`, {
        company_name: '新公司',
        user_name: '李四',
        department: '产品部',
        phone: '13900139000'
      })
      const result = JSON.parse(response.body)

      expect(result.success).toBe(true)
      expect(result.data.company_name).toBe('新公司')
      expect(result.data.user_name).toBe('李四')
      expect(result.data.department).toBe('产品部')
      expect(result.data.phone).toBe('13900139000')
    })

    it('should return error for missing required fields', async () => {
      const response = await httpPost(`http://127.0.0.1:${testPort}/user-info`, {
        company_name: '测试公司'
        // 缺少 user_name 和 department
      })
      const result = JSON.parse(response.body)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Missing required fields')
    })

    it('should return error for invalid JSON', async () => {
      const response = await httpPost(`http://127.0.0.1:${testPort}/user-info`, 'invalid json')
      const result = JSON.parse(response.body)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid JSON body')
    })
  })
})
