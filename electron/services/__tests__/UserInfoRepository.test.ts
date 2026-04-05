import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { UserInfoRepository } from '../UserInfoRepository'
import { DatabaseService } from '../DatabaseService'

describe('UserInfoRepository', () => {
  let dbDir: string
  let dbPath: string
  let sqlPath: string
  let dbService: DatabaseService
  let userInfoRepo: UserInfoRepository

  beforeAll(async () => {
    // 创建临时目录
    dbDir = path.join(os.tmpdir(), `user-info-test-${Date.now()}`)
    await fs.mkdir(dbDir, { recursive: true })

    // 创建 database.sql - 使用完整的表结构
    sqlPath = path.join(dbDir, 'database.sql')
    const sql = `
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
    userInfoRepo = new UserInfoRepository(dbService.getDb())
  })

  afterEach(async () => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('getActiveUser', () => {
    it('should return null when no user exists', () => {
      const result = userInfoRepo.getActiveUser()
      expect(result).toBeNull()
    })

    it('should return the active user when exists', () => {
      userInfoRepo.create({
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部'
      })

      const result = userInfoRepo.getActiveUser()
      expect(result).not.toBeNull()
      expect(result!.company_name).toBe('测试公司')
      expect(result!.user_name).toBe('张三')
      expect(result!.department).toBe('技术部')
    })
  })

  describe('create', () => {
    it('should create a new user', () => {
      const user = userInfoRepo.create({
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部',
        phone: '13800138000'
      })

      expect(user.id).toBeDefined()
      expect(user.company_name).toBe('测试公司')
      expect(user.user_name).toBe('张三')
      expect(user.department).toBe('技术部')
      expect(user.phone).toBe('13800138000')
      expect(user.disable).toBe(0)
    })

    it('should create user without phone', () => {
      const user = userInfoRepo.create({
        company_name: '测试公司',
        user_name: '李四',
        department: '研发部'
      })

      expect(user.phone).toBeNull()
    })

    it('should automatically set ip and mac_address', () => {
      const user = userInfoRepo.create({
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部'
      })

      // ip 和 mac_address 应该被自动设置
      expect(user.ip).toBeDefined()
      expect(user.ip).not.toBe('')
      expect(user.mac_address).toBeDefined()
      expect(user.mac_address).not.toBe('')
    })

    it('should support work_address field', () => {
      const user = userInfoRepo.create({
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部',
        work_address: '北京市朝阳区'
      })

      expect(user.work_address).toBe('北京市朝阳区')
    })
  })

  describe('update', () => {
    it('should update existing user', () => {
      const created = userInfoRepo.create({
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部'
      })

      const updated = userInfoRepo.update(created.id, {
        company_name: '新公司',
        user_name: '张三改',
        department: '产品部',
        phone: '13900139000'
      })

      expect(updated).not.toBeNull()
      expect(updated!.company_name).toBe('新公司')
      expect(updated!.user_name).toBe('张三改')
      expect(updated!.department).toBe('产品部')
      expect(updated!.phone).toBe('13900139000')
    })

    it('should return null when updating non-existent user', () => {
      const result = userInfoRepo.update(999, {
        company_name: '新公司'
      })
      expect(result).toBeNull()
    })

    it('should only update provided fields', () => {
      const created = userInfoRepo.create({
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部',
        phone: '13800138000'
      })

      const updated = userInfoRepo.update(created.id, {
        company_name: '新公司'
      })

      expect(updated!.company_name).toBe('新公司')
      expect(updated!.user_name).toBe('张三')
      expect(updated!.department).toBe('技术部')
      expect(updated!.phone).toBe('13800138000')
    })
  })

  describe('save', () => {
    it('should create new user when none exists', () => {
      const user = userInfoRepo.save({
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部'
      })

      expect(user.id).toBeDefined()
      expect(user.company_name).toBe('测试公司')
    })

    it('should update existing user when one exists', () => {
      userInfoRepo.create({
        company_name: '旧公司',
        user_name: '张三',
        department: '技术部'
      })

      const user = userInfoRepo.save({
        company_name: '新公司',
        user_name: '李四',
        department: '产品部'
      })

      expect(user.company_name).toBe('新公司')
      expect(user.user_name).toBe('李四')
      expect(user.department).toBe('产品部')

      // 确保只有一个用户
      expect(userInfoRepo.hasActiveUser()).toBe(true)
    })
  })

  describe('hasActiveUser', () => {
    it('should return false when no user exists', () => {
      expect(userInfoRepo.hasActiveUser()).toBe(false)
    })

    it('should return true when user exists', () => {
      userInfoRepo.create({
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部'
      })

      expect(userInfoRepo.hasActiveUser()).toBe(true)
    })
  })

  describe('getById', () => {
    it('should return user by id', () => {
      const created = userInfoRepo.create({
        company_name: '测试公司',
        user_name: '张三',
        department: '技术部'
      })

      const found = userInfoRepo.getById(created.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
    })

    it('should return null for non-existent id', () => {
      const result = userInfoRepo.getById(999)
      expect(result).toBeNull()
    })
  })
})
