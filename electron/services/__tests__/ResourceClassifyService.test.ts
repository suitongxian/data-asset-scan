import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseService } from '../DatabaseService'
import { ResourceClassifyService } from '../ResourceClassifyService'
import { DataResourcesRepository } from '../DataResourcesRepository'
import { SystemConfigRepository } from '../SystemConfigRepository'

describe('ResourceClassifyService', () => {
  let testDir: string
  let sqlPath: string
  let dbPath: string
  let dbService: DatabaseService
  let dataResourcesRepo: DataResourcesRepository
  let configRepo: SystemConfigRepository
  let classifyService: ResourceClassifyService
  let workspacePath: string

  beforeAll(async () => {
    testDir = path.join(os.tmpdir(), `resource-classify-service-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    sqlPath = path.join(testDir, 'database.sql')
    const sql = `
-- 信息资源表 data_resources
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
    is_claimed INTEGER DEFAULT 0,
    claim_status INTEGER DEFAULT 0,
    importance_level INTEGER DEFAULT 0,
    claim_time DATETIME,
    claimant_name TEXT,
    claimant_unit TEXT,
    data_level TEXT,
    data_share TEXT,
    file_magic TEXT,
    create_time DATETIME NOT NULL,
    update_time DATETIME NOT NULL,
    disable INTEGER NOT NULL DEFAULT 0
);

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

-- 数据分布表 data_distributing
CREATE TABLE data_distributing (
    data_distribution_id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_task_id INTEGER,
    path TEXT NOT NULL,
    data_type INTEGER NOT NULL,
    scan_found_count INTEGER DEFAULT 1,
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

    dataResourcesRepo = new DataResourcesRepository(dbService.getDb(), 10)
    configRepo = new SystemConfigRepository(dbService.getDb())
    classifyService = new ResourceClassifyService(dbService.getDb(), configRepo)

    // 设置工作空间路径
    workspacePath = path.join(testDir, 'workspace')
    await fs.mkdir(workspacePath, { recursive: true })
    configRepo.setWorkspace(workspacePath)

    // 创建三个归档目录
    await fs.mkdir(path.join(workspacePath, '.核心要件密码柜'), { recursive: true })
    await fs.mkdir(path.join(workspacePath, '.重要文件档案柜'), { recursive: true })
    await fs.mkdir(path.join(workspacePath, '.开放文本资料柜'), { recursive: true })
  })

  afterEach(() => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('classifyResource with importance_level=5 (不予归档)', () => {
    it('should successfully classify a resource as no-archive', async () => {
      // 插入测试资源记录 (claim_status = 2 表示个人工作数据)
      const result = dbService.getDb().prepare(`
        INSERT INTO data_resources (
          content_sign, source_count, workspace_source_count, first_create_time,
          claim_status, create_time, update_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'test-sign-123',
        1,
        1,
        '2024-01-01T00:00:00.000Z',
        2, // claim_status = 2 (个人工作数据)
        new Date().toISOString(),
        new Date().toISOString()
      )

      const dataResourcesId = result.lastInsertRowid as number

      // 执行归类保护
      const classifyResult = await classifyService.classifyResource({
        data_resources_id: dataResourcesId,
        importance_level: 5, // 不予归档
        resources_name: '测试资源',
        resources_desc: '测试描述',
        content_subject: ''
      })

      // 验证结果
      expect(classifyResult.success).toBe(true)
      expect(classifyResult.message).toBe('归类保护成功')

      // 验证数据库中的更新
      const updatedResource = dataResourcesRepo.getById(dataResourcesId)
      expect(updatedResource).not.toBeNull()
      expect(updatedResource!.importance_level).toBe(5)
      expect(updatedResource!.resources_name).toBe('测试资源')
      expect(updatedResource!.resources_desc).toBe('测试描述')
    })

    it('should fail to classify non-work-data (claim_status != 2)', async () => {
      // 插入测试资源记录 (claim_status = 0 表示未分类)
      const result = dbService.getDb().prepare(`
        INSERT INTO data_resources (
          content_sign, source_count, workspace_source_count, first_create_time,
          claim_status, create_time, update_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'test-sign-456',
        1,
        1,
        '2024-01-01T00:00:00.000Z',
        0, // claim_status = 0 (未分类)
        new Date().toISOString(),
        new Date().toISOString()
      )

      const dataResourcesId = result.lastInsertRowid as number

      // 执行归类保护
      const classifyResult = await classifyService.classifyResource({
        data_resources_id: dataResourcesId,
        importance_level: 5,
      })

      // 验证结果
      expect(classifyResult.success).toBe(false)
      expect(classifyResult.message).toBe('只能对个人工作数据进行归类保护')
    })
  })

  describe('classifyResource with importance_level=1,2,3 (归档拷贝)', () => {
    it('should copy file to archive directory for importance_level=1', async () => {
      // 创建源文件
      const sourceFile = path.join(testDir, 'source1.txt')
      const content = 'test content for level 1'
      await fs.writeFile(sourceFile, content)

      // 插入测试资源记录和分布记录
      const resourceResult = dbService.getDb().prepare(`
        INSERT INTO data_resources (
          content_sign, source_count, workspace_source_count, first_create_time,
          claim_status, create_time, update_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'md5-level1',
        1,
        1,
        '2024-01-01T00:00:00.000Z',
        2, // claim_status = 2 (个人工作数据)
        new Date().toISOString(),
        new Date().toISOString()
      )

      const dataResourcesId = resourceResult.lastInsertRowid as number

      dbService.getDb().prepare(`
        INSERT INTO data_distributing (
          path, data_type, scan_found_count, content_sign,
          file_size, ip, mac_address, scan_time, create_time, update_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sourceFile,
        1,
        1,
        'md5-level1',
        content.length,
        '192.168.1.1',
        '00:11:22:33:44:55',
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString()
      )

      // 执行归类保护 (importance_level = 1 -> .核心要件密码柜)
      const classifyResult = await classifyService.classifyResource({
        data_resources_id: dataResourcesId,
        importance_level: 1,
        resources_name: '核心文件',
      })

      // 验证结果
      expect(classifyResult.success).toBe(true)
      expect(classifyResult.data?.filePath).not.toBeUndefined()

      // 验证文件已被拷贝
      const targetPath = classifyResult.data?.filePath as string
      expect(fsSync.existsSync(targetPath)).toBe(true)
      expect(targetPath).toContain('.核心要件密码柜')

      // 验证拷贝的文件内容
      const copiedContent = await fs.readFile(targetPath, 'utf-8')
      expect(copiedContent).toBe(content)
    })

    it('should copy file to archive directory for importance_level=2', async () => {
      // 创建源文件
      const sourceFile = path.join(testDir, 'source2.txt')
      const content = 'test content for level 2'
      await fs.writeFile(sourceFile, content)

      // 插入测试资源记录和分布记录
      const resourceResult = dbService.getDb().prepare(`
        INSERT INTO data_resources (
          content_sign, source_count, workspace_source_count, first_create_time,
          claim_status, create_time, update_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'md5-level2',
        1,
        1,
        '2024-01-01T00:00:00.000Z',
        2, // claim_status = 2
        new Date().toISOString(),
        new Date().toISOString()
      )

      const dataResourcesId = resourceResult.lastInsertRowid as number

      dbService.getDb().prepare(`
        INSERT INTO data_distributing (
          path, data_type, scan_found_count, content_sign,
          file_size, ip, mac_address, scan_time, create_time, update_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sourceFile,
        1,
        1,
        'md5-level2',
        content.length,
        '192.168.1.1',
        '00:11:22:33:44:55',
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString()
      )

      // 执行归类保护 (importance_level = 2 -> .重要文件档案柜)
      const classifyResult = await classifyService.classifyResource({
        data_resources_id: dataResourcesId,
        importance_level: 2,
      })

      // 验证结果
      expect(classifyResult.success).toBe(true)
      const targetPath = classifyResult.data?.filePath as string
      expect(targetPath).toContain('.重要文件档案柜')
      expect(fsSync.existsSync(targetPath)).toBe(true)
    })

    it('should copy file to archive directory for importance_level=3', async () => {
      // 创建源文件
      const sourceFile = path.join(testDir, 'source3.txt')
      const content = 'test content for level 3'
      await fs.writeFile(sourceFile, content)

      // 插入测试资源记录和分布记录
      const resourceResult = dbService.getDb().prepare(`
        INSERT INTO data_resources (
          content_sign, source_count, workspace_source_count, first_create_time,
          claim_status, create_time, update_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'md5-level3',
        1,
        1,
        '2024-01-01T00:00:00.000Z',
        2, // claim_status = 2
        new Date().toISOString(),
        new Date().toISOString()
      )

      const dataResourcesId = resourceResult.lastInsertRowid as number

      dbService.getDb().prepare(`
        INSERT INTO data_distributing (
          path, data_type, scan_found_count, content_sign,
          file_size, ip, mac_address, scan_time, create_time, update_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sourceFile,
        1,
        1,
        'md5-level3',
        content.length,
        '192.168.1.1',
        '00:11:22:33:44:55',
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString()
      )

      // 执行归类保护 (importance_level = 3 -> .开放文本资料柜)
      const classifyResult = await classifyService.classifyResource({
        data_resources_id: dataResourcesId,
        importance_level: 3,
      })

      // 验证结果
      expect(classifyResult.success).toBe(true)
      const targetPath = classifyResult.data?.filePath as string
      expect(targetPath).toContain('.开放文本资料柜')
      expect(fsSync.existsSync(targetPath)).toBe(true)
    })

    it('should handle duplicate filenames by appending counter', async () => {
      // 创建源文件
      const sourceFile = path.join(testDir, 'duplicate.txt')
      const content = 'test content'
      await fs.writeFile(sourceFile, content)

      // 在归档目录中预先创建一个同名文件
      const archiveDir = path.join(workspacePath, '.核心要件密码柜')
      const existingFile = path.join(archiveDir, 'duplicate.txt')
      await fs.writeFile(existingFile, 'existing content')

      // 插入测试资源记录和分布记录
      const resourceResult = dbService.getDb().prepare(`
        INSERT INTO data_resources (
          content_sign, source_count, workspace_source_count, first_create_time,
          claim_status, create_time, update_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'md5-duplicate',
        1,
        1,
        '2024-01-01T00:00:00.000Z',
        2,
        new Date().toISOString(),
        new Date().toISOString()
      )

      const dataResourcesId = resourceResult.lastInsertRowid as number

      dbService.getDb().prepare(`
        INSERT INTO data_distributing (
          path, data_type, scan_found_count, content_sign,
          file_size, ip, mac_address, scan_time, create_time, update_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sourceFile,
        1,
        1,
        'md5-duplicate',
        content.length,
        '192.168.1.1',
        '00:11:22:33:44:55',
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString()
      )

      // 执行归类保护
      const classifyResult = await classifyService.classifyResource({
        data_resources_id: dataResourcesId,
        importance_level: 1,
      })

      // 验证结果
      expect(classifyResult.success).toBe(true)
      const targetPath = classifyResult.data?.filePath as string

      // 验证文件名被修改（添加了 _1）
      expect(targetPath).toContain('.核心要件密码柜')
      expect(path.basename(targetPath)).toBe('duplicate_1.txt')
      expect(fsSync.existsSync(targetPath)).toBe(true)

      // 验证原始文件未被覆盖
      expect(await fs.readFile(existingFile, 'utf-8')).toBe('existing content')
      expect(await fs.readFile(targetPath, 'utf-8')).toBe(content)
    })
  })

  describe('validation', () => {
    it('should reject invalid importance_level values', async () => {
      const result = dbService.getDb().prepare(`
        INSERT INTO data_resources (
          content_sign, source_count, workspace_source_count, first_create_time,
          claim_status, create_time, update_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'test-sign-invalid',
        1,
        1,
        '2024-01-01T00:00:00.000Z',
        2,
        new Date().toISOString(),
        new Date().toISOString()
      )

      const dataResourcesId = result.lastInsertRowid as number

      // 测试无效值 0
      const result0 = await classifyService.classifyResource({
        data_resources_id: dataResourcesId,
        importance_level: 0,
      })
      expect(result0.success).toBe(false)

      // 测试无效值 4
      const result4 = await classifyService.classifyResource({
        data_resources_id: dataResourcesId,
        importance_level: 4,
      })
      expect(result4.success).toBe(false)

      // 测试无效值 6
      const result6 = await classifyService.classifyResource({
        data_resources_id: dataResourcesId,
        importance_level: 6,
      })
      expect(result6.success).toBe(false)
    })

    it('should accept valid importance_level values (1, 2, 3, 5)', async () => {
      const validValues = [1, 2, 3, 5]

      for (const value of validValues) {
        const result = dbService.getDb().prepare(`
          INSERT INTO data_resources (
            content_sign, source_count, workspace_source_count, first_create_time,
            claim_status, create_time, update_time
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          `test-sign-valid-${value}`,
          1,
          1,
          '2024-01-01T00:00:00.000Z',
          2,
          new Date().toISOString(),
          new Date().toISOString()
        )

        const dataResourcesId = result.lastInsertRowid as number

        const classifyResult = await classifyService.classifyResource({
          data_resources_id: dataResourcesId,
          importance_level: value,
        })

        expect(classifyResult.success).toBe(true)
      }
    })
  })
})
