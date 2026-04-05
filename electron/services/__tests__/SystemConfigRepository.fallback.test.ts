import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SystemConfigRepository } from '../SystemConfigRepository'
import { ConfigService } from '../ConfigService'
import { DatabaseService } from '../DatabaseService'

describe('SystemConfigRepository - ConfigService Fallback', () => {
  let testDir: string
  let configPath: string
  let dbPath: string
  let sqlPath: string
  let dbService: DatabaseService
  let configRepo: SystemConfigRepository
  let configService: ConfigService

  beforeAll(async () => {
    // 创建临时目录
    testDir = path.join(os.tmpdir(), `config-fallback-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    // 创建 database.sql
    sqlPath = path.join(testDir, 'database.sql')
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
    await fs.rm(testDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    dbPath = path.join(testDir, `test-${Date.now()}.db`)
    dbService = new DatabaseService({ dbPath, sqlPath })
    dbService.init()

    // 创建 config.yaml
    configPath = path.join(testDir, `config-${Date.now()}.yaml`)
    const configContent = `
control_type: .doc,.ppt,.docx
save_code: yaml_code_123
daily_scan_interval: 30
scan_area_path: /Users/test
scan_exclude_dir: node_modules,.git
workspace: /Users/test/workspace
`
    await fs.writeFile(configPath, configContent)
    configService = new ConfigService(configPath)
  })

  afterEach(async () => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('ConfigService 回退取值', () => {
    it('数据库没有值时应该从 ConfigService 回退取值', () => {
      configRepo = new SystemConfigRepository(dbService.getDb(), configService)

      expect(configRepo.getControlType()).toBe('.doc,.ppt,.docx')
      expect(configRepo.getSaveCode()).toBe('yaml_code_123')
      expect(configRepo.getDailyScanInterval()).toBe(30)
      expect(configRepo.getScanAreaPath()).toBe('/Users/test')
      expect(configRepo.getScanExcludeDir()).toBe('node_modules,.git')
      expect(configRepo.getWorkspace()).toBe('/Users/test/workspace')
    })

    it('数据库有值时应该使用数据库值而不是 ConfigService', () => {
      configRepo = new SystemConfigRepository(dbService.getDb(), configService)

      // 在数据库中设置不同的值
      configRepo.setControlType('.xls,.xlsx')
      configRepo.setSaveCode('db_code_456')
      configRepo.setDailyScanInterval(60)
      configRepo.setScanAreaPath('/Users/db')
      configRepo.setScanExcludeDir('db_dir')
      configRepo.setWorkspace('/Users/db/workspace')

      // 应该返回数据库中的值
      expect(configRepo.getControlType()).toBe('.xls,.xlsx')
      expect(configRepo.getSaveCode()).toBe('db_code_456')
      expect(configRepo.getDailyScanInterval()).toBe(60)
      expect(configRepo.getScanAreaPath()).toBe('/Users/db')
      expect(configRepo.getScanExcludeDir()).toBe('db_dir')
      expect(configRepo.getWorkspace()).toBe('/Users/db/workspace')
    })

    it('部分字段使用数据库值，其他字段从 ConfigService 回退', () => {
      configRepo = new SystemConfigRepository(dbService.getDb(), configService)

      // 只在数据库中设置部分值
      configRepo.setControlType('.pdf,.docx')
      configRepo.setSaveCode('db_code')

      // control_type 和 save_code 应该来自数据库
      expect(configRepo.getControlType()).toBe('.pdf,.docx')
      expect(configRepo.getSaveCode()).toBe('db_code')

      // 其他字段应该从 ConfigService 回退
      expect(configRepo.getDailyScanInterval()).toBe(30)
      expect(configRepo.getScanAreaPath()).toBe('/Users/test')
      expect(configRepo.getScanExcludeDir()).toBe('node_modules,.git')
    })

    it('数据库中的空字符串应该触发回退到 ConfigService', () => {
      configRepo = new SystemConfigRepository(dbService.getDb(), configService)

      // 在数据库中设置空字符串
      configRepo.setValue(SystemConfigRepository.KEYS.CONTROL_TYPE, '')
      configRepo.setValue(SystemConfigRepository.KEYS.SAVE_CODE, '')

      // 空字符串应该触发回退
      expect(configRepo.getControlType()).toBe('.doc,.ppt,.docx')
      expect(configRepo.getSaveCode()).toBe('yaml_code_123')
    })

    it('没有 ConfigService 时应该返回 null 或默认值', () => {
      configRepo = new SystemConfigRepository(dbService.getDb())

      expect(configRepo.getControlType()).toBeNull()
      expect(configRepo.getSaveCode()).toBeNull()
      expect(configRepo.getScanAreaPath()).toBeNull()
      expect(configRepo.getScanExcludeDir()).toBeNull()
      expect(configRepo.getWorkspace()).toBeNull()
      // getDailyScanInterval 有默认值
      expect(configRepo.getDailyScanInterval()).toBe(15)
    })

    it('支持延迟注入 ConfigService', () => {
      configRepo = new SystemConfigRepository(dbService.getDb())

      // 未注入 ConfigService 时应该返回 null
      expect(configRepo.getControlType()).toBeNull()

      // 注入 ConfigService 后应该能够获取值
      configRepo.setConfigService(configService)
      expect(configRepo.getControlType()).toBe('.doc,.ppt,.docx')
    })
  })

  describe('没有 ConfigService 映射的键', () => {
    it('未映射的键即使有 ConfigService 也应该返回 null', () => {
      configRepo = new SystemConfigRepository(dbService.getDb(), configService)

      // FULL_INVENTORY_TIME 没有在 ConfigService 中配置，也没有映射
      expect(configRepo.getFullInventoryTime()).toBeNull()

      // 设置后应该能获取
      configRepo.setFullInventoryTime('2024-01-01T00:00:00.000Z')
      expect(configRepo.getFullInventoryTime()).toBe('2024-01-01T00:00:00.000Z')
    })
  })
})
