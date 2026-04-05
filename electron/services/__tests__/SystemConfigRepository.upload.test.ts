import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SystemConfigRepository } from '../SystemConfigRepository'
import { DatabaseService } from '../DatabaseService'

describe('SystemConfigRepository - UploadServerUrl', () => {
  let dbDir: string
  let dbPath: string
  let sqlPath: string
  let dbService: DatabaseService
  let configRepo: SystemConfigRepository

  beforeAll(async () => {
    // 创建临时目录
    dbDir = path.join(os.tmpdir(), `config-upload-test-${Date.now()}`)
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
    configRepo = new SystemConfigRepository(dbService.getDb())
  })

  afterEach(async () => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('KEYS', () => {
    it('should have UPLOAD_SERVER_URL key defined', () => {
      expect(SystemConfigRepository.KEYS.UPLOAD_SERVER_URL).toBe('upload_server_url')
    })
  })

  describe('getUploadServerUrl', () => {
    it('should return null when not set', () => {
      const result = configRepo.getUploadServerUrl()
      expect(result).toBeNull()
    })

    it('should return the configured URL', () => {
      configRepo.setUploadServerUrl('http://localhost:3000')
      const result = configRepo.getUploadServerUrl()
      expect(result).toBe('http://localhost:3000')
    })
  })

  describe('setUploadServerUrl', () => {
    it('should set the upload server URL', () => {
      configRepo.setUploadServerUrl('https://upload.example.com')

      const result = configRepo.getUploadServerUrl()
      expect(result).toBe('https://upload.example.com')
    })

    it('should update existing URL', () => {
      configRepo.setUploadServerUrl('http://old.example.com')
      configRepo.setUploadServerUrl('http://new.example.com')

      const result = configRepo.getUploadServerUrl()
      expect(result).toBe('http://new.example.com')
    })

    it('should create config record with description', () => {
      configRepo.setUploadServerUrl('http://test.com')

      const config = configRepo.getByKey(SystemConfigRepository.KEYS.UPLOAD_SERVER_URL)
      expect(config).not.toBeNull()
      expect(config!.describe).toBe('文件上传服务器地址')
    })
  })
})
