import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { HttpScanService } from '../HttpScanService'
import { DatabaseService } from '../DatabaseService'
import { ConfigService } from '../ConfigService'
import { SystemConfigRepository } from '../SystemConfigRepository'
import { DataResourcesRepository, CreateDataResourcesParams } from '../DataResourcesRepository'

// HTTP POST 请求工具函数
function httpPost(url: string, body: object): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const data = JSON.stringify(body)

    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }))
      res.on('error', reject)
    })

    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

describe('HttpScanService - Statistics Sync', () => {
  let testDir: string
  let dbDir: string
  let sqlPath: string
  let configPath: string
  let dbPath: string
  let dbService: DatabaseService
  let httpService: HttpScanService
  let configService: ConfigService
  let mockServer: http.Server
  let mockServerPort: number
  let receivedStatisticsData: any = null

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `http-stats-sync-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    // 创建数据库目录
    dbDir = path.join(os.tmpdir(), `http-stats-sync-db-${Date.now()}`)
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
    task_state TEXT NOT NULL,
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
    upload_state INTEGER DEFAULT 0,
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
`
    await fs.writeFile(sqlPath, sql)

    // 启动模拟服务器
    mockServerPort = 38000 + Math.floor(Math.random() * 1000)
    await new Promise<void>((resolve) => {
      mockServer = http.createServer((req, res) => {
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', () => {
          // 处理同步请求
          if (req.url === '/api/sync/source' && req.method === 'POST') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ code: 0, message: '同步成功' }))
          }
          // 处理统计数据同步请求
          else if (req.url === '/api/sync/file-statistics' && req.method === 'POST') {
            try {
              receivedStatisticsData = JSON.parse(body)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({
                code: 0,
                message: '文件统计同步成功',
                data: {
                  id: 1,
                  computer_ip: receivedStatisticsData.computer_ip,
                  computer_mac: receivedStatisticsData.computer_mac,
                  file_total: receivedStatisticsData.file_total,
                  disabled_count: 0
                }
              }))
            } catch (e) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ code: -1, message: '无效的JSON' }))
            }
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ code: -1, message: 'Not Found' }))
          }
        })
      })
      mockServer.listen(mockServerPort, '127.0.0.1', resolve)
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve())
    })
    await fs.rm(testDir, { recursive: true, force: true })
    await fs.rm(dbDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    receivedStatisticsData = null

    // 创建 config.yaml
    configPath = path.join(dbDir, `config-${Date.now()}.yaml`)
    const configYaml = `
control_type: .ts
save_code: test_code
daily_scan_interval: 15
scan_area_path: ${testDir}
scan_exclude_dir: ''
`
    await fs.writeFile(configPath, configYaml)

    dbPath = path.join(dbDir, `test-${Date.now()}.db`)
    dbService = new DatabaseService({ dbPath, sqlPath })
    dbService.init()

    // 创建 ConfigService
    configService = new ConfigService({ configPath })

    // 设置配置
    const configRepo = new SystemConfigRepository(dbService.getDb(), configService)
    configRepo.setWorkspace(testDir)
    configRepo.setUploadServerUrl(`http://127.0.0.1:${mockServerPort}`)

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

  describe('POST /sync/source with statistics sync', () => {
    it('should sync statistics after data sync', async () => {
      // 插入一些资源数据
      const resourceRepo = new DataResourcesRepository(dbService.getDb())
      const records: CreateDataResourcesParams[] = [
        {
          content_sign: 'hash1',
          source_count: 10,
          workspace_source_count: 5,
          first_create_time: '2024-01-01T00:00:00.000Z',
          resources_name: 'file1.ts',
          content_type: 'ts'
        },
        {
          content_sign: 'hash2',
          source_count: 20,
          workspace_source_count: 8,
          first_create_time: '2024-01-02T00:00:00.000Z',
          resources_name: 'file2.ts',
          content_type: 'ts'
        }
      ]
      resourceRepo.insertBatch(records)

      // 触发同步
      const { statusCode, body } = await httpPost(`${httpService.address}/sync/source`, {})
      const data = JSON.parse(body)

      expect(statusCode).toBe(200)
      expect(data.success).toBe(true)

      // 验证统计数据是否被发送到模拟服务器
      expect(receivedStatisticsData).not.toBeNull()
      expect(receivedStatisticsData.file_total).toBe(30) // 10 + 20
      expect(receivedStatisticsData.workspace_file_total).toBe(13) // 5 + 8
      expect(receivedStatisticsData.computer_ip).toBeDefined()
      expect(receivedStatisticsData.computer_mac).toBeDefined()
    })

    it('should send correct statistics fields', async () => {
      // 插入带有不同重要程度的资源
      const resourceRepo = new DataResourcesRepository(dbService.getDb())
      resourceRepo.insertBatch([
        {
          content_sign: 'core1',
          source_count: 5,
          workspace_source_count: 2,
          first_create_time: '2024-01-01T00:00:00.000Z'
        },
        {
          content_sign: 'important1',
          source_count: 8,
          workspace_source_count: 3,
          first_create_time: '2024-01-01T00:00:00.000Z'
        }
      ])

      // 设置不同的重要程度
      dbService.getDb().prepare(`
        UPDATE data_resources SET importance_level = 1 WHERE content_sign = 'core1'
      `).run()
      dbService.getDb().prepare(`
        UPDATE data_resources SET importance_level = 2 WHERE content_sign = 'important1'
      `).run()

      // 触发同步
      await httpPost(`${httpService.address}/sync/source`, {})

      // 验证统计字段
      expect(receivedStatisticsData).not.toBeNull()
      expect(receivedStatisticsData).toHaveProperty('file_total')
      expect(receivedStatisticsData).toHaveProperty('workspace_file_total')
      expect(receivedStatisticsData).toHaveProperty('history_file_count')
      expect(receivedStatisticsData).toHaveProperty('non_history_file_count')
      expect(receivedStatisticsData).toHaveProperty('workspace_file_claimed_count')
      expect(receivedStatisticsData).toHaveProperty('history_file_claimed_count')
      expect(receivedStatisticsData).toHaveProperty('non_history_file_claimed_count')
      expect(receivedStatisticsData).toHaveProperty('unclassified_file_count')
      expect(receivedStatisticsData).toHaveProperty('core_file_count')
      expect(receivedStatisticsData).toHaveProperty('important_file_count')
      expect(receivedStatisticsData).toHaveProperty('open_file_count')
      expect(receivedStatisticsData).toHaveProperty('private_file_count')

      // 验证重要程度分类统计
      expect(receivedStatisticsData.core_file_count).toBe(5)  // importance_level = 1
      expect(receivedStatisticsData.important_file_count).toBe(8)  // importance_level = 2
    })

    it('should still sync statistics when there are no pending records', async () => {
      // 不插入任何数据，直接触发同步
      const { statusCode, body } = await httpPost(`${httpService.address}/sync/source`, {})
      const data = JSON.parse(body)

      expect(statusCode).toBe(200)
      expect(data.message).toContain('没有需要同步的记录')

      // 统计数据仍然应该被发送
      expect(receivedStatisticsData).not.toBeNull()
      expect(receivedStatisticsData.file_total).toBe(0)
      expect(receivedStatisticsData.workspace_file_total).toBe(0)
    })

    it('should handle statistics with history inventory time', async () => {
      // 设置历史封帐时间
      const configRepo = new SystemConfigRepository(dbService.getDb(), configService)
      configRepo.setFullInventoryTime('2024-06-01T00:00:00.000Z')

      // 插入历史数据和新数据
      const resourceRepo = new DataResourcesRepository(dbService.getDb())
      resourceRepo.insertBatch([
        {
          content_sign: 'history1',
          source_count: 10,
          workspace_source_count: 5,
          first_create_time: '2024-01-01T00:00:00.000Z' // 历史数据
        },
        {
          content_sign: 'new1',
          source_count: 20,
          workspace_source_count: 10,
          first_create_time: '2024-07-01T00:00:00.000Z' // 新数据
        }
      ])

      // 触发同步
      await httpPost(`${httpService.address}/sync/source`, {})

      // 验证历史和非历史统计
      expect(receivedStatisticsData).not.toBeNull()
      expect(receivedStatisticsData.history_file_count).toBe(10)
      expect(receivedStatisticsData.non_history_file_count).toBe(20)
    })
  })
})
