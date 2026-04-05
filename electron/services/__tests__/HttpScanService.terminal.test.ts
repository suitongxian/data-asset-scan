import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { HttpScanService } from '../HttpScanService'
import { DatabaseService } from '../DatabaseService'
import { SystemConfigRepository } from '../SystemConfigRepository'

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

describe('HttpScanService - Terminal Registration', () => {
  let dbDir: string
  let dbPath: string
  let sqlPath: string
  let dbService: DatabaseService
  let httpService: HttpScanService
  const testPort = 3098

  // 模拟远程服务器
  let mockServer: http.Server | null = null
  let mockServerPort = 0
  let mockServerUrl = ''

  // 模拟远程服务器接收到的注册请求
  let receivedRegisterRequests: any[] = []
  let receivedTerminalListRequests = 0

  beforeAll(async () => {
    // 创建临时目录
    dbDir = path.join(os.tmpdir(), `http-terminal-test-${Date.now()}`)
    await fs.mkdir(dbDir, { recursive: true })

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
    source_ip TEXT,
    source_mac TEXT,
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
    receivedRegisterRequests = []
    receivedTerminalListRequests = 0

    // 启动模拟远程服务器
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${mockServerPort}`)

      if (url.pathname === '/api/terminal/register' && req.method === 'POST') {
        // 处理终端注册请求
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', () => {
          receivedRegisterRequests.push(JSON.parse(body))
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, message: '注册成功' }))
        })
        return
      }

      if (url.pathname === '/api/terminal/list' && req.method === 'GET') {
        // 处理获取终端列表请求
        receivedTerminalListRequests++
        const mockTerminalList = [
          {
            id: 1,
            user_name: '张三',
            user_department: '技术部',
            user_unit: '测试公司',
            terminal_app_version: 'V1.0.0',
            computer_ip: '192.168.1.100',
            computer_mac: 'AA:BB:CC:DD:EE:FF',
            register_time: new Date().toISOString()
          },
          {
            id: 2,
            user_name: '李四',
            user_department: '产品部',
            user_unit: '测试公司',
            terminal_app_version: 'V1.0.0',
            computer_ip: '192.168.1.101',
            computer_mac: '11:22:33:44:55:66',
            register_time: new Date().toISOString()
          }
        ]
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ code: 0, data: mockTerminalList }))
        return
      }

      res.writeHead(404)
      res.end('Not Found')
    })

    await new Promise<void>((resolve) => {
      mockServer!.listen(0, '127.0.0.1', () => {
        const address = mockServer!.address()
        if (address && typeof address === 'object') {
          mockServerPort = address.port
          mockServerUrl = `http://127.0.0.1:${mockServerPort}`
        }
        resolve()
      })
    })

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
    if (mockServer) {
      await new Promise<void>((resolve) => {
        mockServer!.close(() => resolve())
      })
      mockServer = null
    }
  })

  describe('Terminal Registration', () => {
    it('should skip terminal registration when upload_server_url is not configured', async () => {
      // 不配置 upload_server_url
      const response = await httpPost(`http://127.0.0.1:${testPort}/user-info`, {
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部'
      })
      const result = JSON.parse(response.body)

      expect(result.success).toBe(true)
      expect(receivedRegisterRequests.length).toBe(0) // 不应该发送注册请求
    })

    it('should register terminal when upload_server_url is configured', async () => {
      // 配置 upload_server_url
      const configRepo = new SystemConfigRepository(dbService.getDb())
      configRepo.setUploadServerUrl(mockServerUrl)

      const response = await httpPost(`http://127.0.0.1:${testPort}/user-info`, {
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部'
      })
      const result = JSON.parse(response.body)

      expect(result.success).toBe(true)

      // 等待异步注册完成
      await delay(100)

      // 验证发送了注册请求
      expect(receivedRegisterRequests.length).toBe(1)
      expect(receivedRegisterRequests[0]).toMatchObject({
        user_name: '张三',
        user_department: '技术部',
        user_unit: '测试公司',
        terminal_app_version: 'V1.0.0'
      })
      // 验证包含 IP 和 MAC 地址（格式可能因环境而异）
      expect(receivedRegisterRequests[0].computer_ip).toBeDefined()
      expect(receivedRegisterRequests[0].computer_mac).toBeDefined()
    })

    it('should fetch and save terminal users list after registration', async () => {
      const configRepo = new SystemConfigRepository(dbService.getDb())
      configRepo.setUploadServerUrl(mockServerUrl)

      // 保存用户信息
      await httpPost(`http://127.0.0.1:${testPort}/user-info`, {
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部'
      })

      // 等待异步操作完成
      await delay(100)

      // 验证发送了获取终端列表的请求
      expect(receivedTerminalListRequests).toBeGreaterThan(0)

      // 验证终端用户信息已保存到系统配置
      const allTerminalUsers = configRepo.getAllTerminalUsers()
      expect(allTerminalUsers).not.toBeNull()

      const terminalUsers = JSON.parse(allTerminalUsers!)
      expect(terminalUsers.code).toBe(0)
      expect(terminalUsers.data).toBeInstanceOf(Array)
      expect(terminalUsers.data.length).toBe(2)
      expect(terminalUsers.data[0].user_name).toBe('张三')
      expect(terminalUsers.data[1].user_name).toBe('李四')
    })

    it('should save user info even if terminal registration fails', async () => {
      // 先配置一个无效的服务器地址
      const configRepo = new SystemConfigRepository(dbService.getDb())
      configRepo.setUploadServerUrl('http://invalid-server-that-does-not-exist:9999')

      const response = await httpPost(`http://127.0.0.1:${testPort}/user-info`, {
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部'
      })
      const result = JSON.parse(response.body)

      // 用户信息应该保存成功
      expect(result.success).toBe(true)
      expect(result.data.company_name).toBe('测试公司')
      expect(result.data.user_name).toBe('张三')
      expect(result.data.department).toBe('技术部')

      // 等待异步操作完成
      await delay(100)
    })

    it('should use correct terminal version', async () => {
      const configRepo = new SystemConfigRepository(dbService.getDb())
      configRepo.setUploadServerUrl(mockServerUrl)

      await httpPost(`http://127.0.0.1:${testPort}/user-info`, {
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部'
      })

      await delay(100)

      expect(receivedRegisterRequests.length).toBe(1)
      expect(receivedRegisterRequests[0].terminal_app_version).toBe('V1.0.0')
    })
  })
})
