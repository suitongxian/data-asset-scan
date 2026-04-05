import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseService } from '../DatabaseService'

describe('DatabaseService', () => {
  let testDir: string
  let sqlPath: string

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `database-service-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    // 创建测试用的 database.sql 文件
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
    create_time DATETIME NOT NULL,
    update_time DATETIME NOT NULL,
    disable INTEGER NOT NULL DEFAULT 0
);
`
    await fs.writeFile(sqlPath, sql)
  })

  afterAll(async () => {
    // 清理测试目录
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('init', () => {
    let dbPath: string
    let service: DatabaseService

    beforeEach(() => {
      dbPath = path.join(testDir, `test-${Date.now()}.db`)
    })

    afterEach(() => {
      if (service) {
        service.close()
      }
      // 清理测试数据库文件
      if (fsSync.existsSync(dbPath)) {
        fsSync.unlinkSync(dbPath)
      }
    })

    it('should create database file if not exists', () => {
      service = new DatabaseService({ dbPath, sqlPath })
      expect(fsSync.existsSync(dbPath)).toBe(false)

      service.init()

      expect(fsSync.existsSync(dbPath)).toBe(true)
    })

    it('should create tables on first init', () => {
      service = new DatabaseService({ dbPath, sqlPath })
      service.init()

      const db = service.getDb()
      const tables = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `).all() as { name: string }[]

      const tableNames = tables.map(t => t.name)
      expect(tableNames).toContain('system_config')
      expect(tableNames).toContain('scan_task')
    })

    it('should not recreate tables if database already exists', async () => {
      // 第一次初始化
      service = new DatabaseService({ dbPath, sqlPath })
      service.init()

      // 插入一条数据
      const db = service.getDb()
      db.prepare(`
        INSERT INTO system_config (key, type, value, describe, create_time, update_time)
        VALUES ('test_key', 'string', 'test_value', 'test', datetime('now'), datetime('now'))
      `).run()

      service.close()

      // 第二次初始化（应该不重新创建表）
      service = new DatabaseService({ dbPath, sqlPath })
      service.init()

      // 验证数据仍然存在
      const result = service.getDb()
        .prepare('SELECT * FROM system_config WHERE key = ?')
        .get('test_key') as { value: string }

      expect(result).toBeDefined()
      expect(result.value).toBe('test_value')
    })

    it('should throw error when sql file does not exist', () => {
      const nonExistentSqlPath = path.join(testDir, 'non-existent.sql')
      service = new DatabaseService({ dbPath, sqlPath: nonExistentSqlPath })

      expect(() => service.init()).toThrow('建表脚本不存在')
    })
  })

  describe('getDb', () => {
    let dbPath: string
    let service: DatabaseService

    beforeEach(() => {
      dbPath = path.join(testDir, `test-${Date.now()}.db`)
    })

    afterEach(() => {
      if (service) {
        service.close()
      }
      if (fsSync.existsSync(dbPath)) {
        fsSync.unlinkSync(dbPath)
      }
    })

    it('should return database instance after init', () => {
      service = new DatabaseService({ dbPath, sqlPath })
      service.init()

      const db = service.getDb()
      expect(db).toBeDefined()
    })

    it('should throw error if database not initialized', () => {
      service = new DatabaseService({ dbPath, sqlPath })

      expect(() => service.getDb()).toThrow('数据库未初始化')
    })
  })

  describe('close', () => {
    let dbPath: string
    let service: DatabaseService

    beforeEach(() => {
      dbPath = path.join(testDir, `test-${Date.now()}.db`)
      service = new DatabaseService({ dbPath, sqlPath })
      service.init()
    })

    afterEach(() => {
      if (fsSync.existsSync(dbPath)) {
        fsSync.unlinkSync(dbPath)
      }
    })

    it('should close database connection', () => {
      service.close()

      expect(() => service.getDb()).toThrow('数据库未初始化')
    })

    it('should handle multiple close calls gracefully', () => {
      service.close()
      service.close() // 第二次调用应该不报错

      expect(() => service.getDb()).toThrow('数据库未初始化')
    })
  })
})
