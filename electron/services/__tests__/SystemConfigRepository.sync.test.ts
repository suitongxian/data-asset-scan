import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SystemConfigRepository } from '../SystemConfigRepository'
import { DatabaseService } from '../DatabaseService'

describe('SystemConfigRepository - LastSyncTime', () => {
  let dbDir: string
  let dbPath: string
  let sqlPath: string
  let dbService: DatabaseService
  let configRepo: SystemConfigRepository

  beforeAll(async () => {
    // 创建临时目录
    dbDir = path.join(os.tmpdir(), `config-sync-test-${Date.now()}`)
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
    it('should have LAST_SYNC_TIME key defined', () => {
      expect(SystemConfigRepository.KEYS.LAST_SYNC_TIME).toBe('last_sync_time')
    })
  })

  describe('getLastSyncTime', () => {
    it('should return null when not set', () => {
      const result = configRepo.getLastSyncTime()
      expect(result).toBeNull()
    })

    it('should return configured sync time', () => {
      const syncTime = '2024-01-15T10:30:00.000Z'
      configRepo.setLastSyncTime(syncTime)
      const result = configRepo.getLastSyncTime()
      expect(result).toBe(syncTime)
    })
  })

  describe('setLastSyncTime', () => {
    it('should set last sync time', () => {
      const syncTime = '2024-01-15T10:30:00.000Z'
      configRepo.setLastSyncTime(syncTime)

      const result = configRepo.getLastSyncTime()
      expect(result).toBe(syncTime)
    })

    it('should update existing sync time', () => {
      const firstTime = '2024-01-15T10:30:00.000Z'
      const secondTime = '2024-01-16T11:45:00.000Z'

      configRepo.setLastSyncTime(firstTime)
      configRepo.setLastSyncTime(secondTime)

      const result = configRepo.getLastSyncTime()
      expect(result).toBe(secondTime)
    })

    it('should create config record with description', () => {
      const syncTime = '2024-01-15T10:30:00.000Z'
      configRepo.setLastSyncTime(syncTime)

      const config = configRepo.getByKey(SystemConfigRepository.KEYS.LAST_SYNC_TIME)
      expect(config).not.toBeNull()
      expect(config!.describe).toBe('最后同步时间')
    })

    it('should store ISO format timestamps', () => {
      const syncTime = new Date().toISOString()
      configRepo.setLastSyncTime(syncTime)

      const result = configRepo.getLastSyncTime()
      expect(result).toBe(syncTime)
      // 验证格式是否为有效的 ISO 字符串
      const parsedDate = new Date(result!)
      expect(parsedDate.toISOString()).toBe(result)
    })
  })
})
