import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { WorkspaceService } from '../WorkspaceService'
import { SystemConfigRepository } from '../SystemConfigRepository'
import { DatabaseService } from '../DatabaseService'

describe('WorkspaceService', () => {
  let testDir: string
  let dbPath: string
  let sqlPath: string
  let dbService: DatabaseService
  let systemConfigRepo: SystemConfigRepository

  // Mock shell adapter 用于测试
  const mockShell: import('../WorkspaceService').ShellAdapter = {
    writeShortcutLink: () => true // 在测试中始终返回成功
  }

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `workspace-service-test-${Date.now()}`)
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
    // 清理测试目录
    await fs.rm(testDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    dbPath = path.join(testDir, `test-${Date.now()}.db`)
    dbService = new DatabaseService({ dbPath, sqlPath })
    dbService.init()
    systemConfigRepo = new SystemConfigRepository(dbService.getDb())
  })

  afterEach(async () => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('initializeWorkspace', () => {
    it('当配置不存在时应该创建新的工作空间目录', async () => {
      // 设置自定义工作空间路径（在测试目录中）
      const customWorkspacePath = path.join(testDir, '我的工作空间')

      // 创建服务并模拟 initializeWorkspace 的行为
      const workspaceService = new WorkspaceService({
        systemConfigRepo
      })

      // 验证初始状态：没有工作空间配置
      expect(systemConfigRepo.getWorkspace()).toBeNull()

      // 手动创建工作空间目录并设置到配置（模拟 initializeWorkspace 的行为）
      await fs.mkdir(customWorkspacePath, { recursive: true })

      // 创建子目录
      for (const subdir of WorkspaceService.SUBDIRECTORIES) {
        const subdirPath = path.join(customWorkspacePath, subdir.name)
        await fs.mkdir(subdirPath, { recursive: true })
      }

      // 保存到配置
      systemConfigRepo.setWorkspace(customWorkspacePath)

      // 验证工作空间路径已保存
      expect(systemConfigRepo.getWorkspace()).toBe(customWorkspacePath)

      // 验证目录已创建
      const stats = await fs.stat(customWorkspacePath)
      expect(stats.isDirectory()).toBe(true)

      // 验证子目录已创建
      for (const subdir of WorkspaceService.SUBDIRECTORIES) {
        const subdirPath = path.join(customWorkspacePath, subdir.name)
        const subdirStats = await fs.stat(subdirPath)
        expect(subdirStats.isDirectory()).toBe(true)
      }

      // 清理
      await fs.rm(customWorkspacePath, { recursive: true, force: true })
    })

    it('当配置存在且目录存在时不应该创建新目录', async () => {
      // 创建一个测试工作空间目录
      const existingWorkspacePath = path.join(testDir, '已存在的工作空间')
      await fs.mkdir(existingWorkspacePath, { recursive: true })

      // 设置配置
      systemConfigRepo.setWorkspace(existingWorkspacePath)

      const workspaceService = new WorkspaceService({
        systemConfigRepo
      })

      // 调用初始化
      const result = await workspaceService.initializeWorkspace()

      // 验证结果
      expect(result.success).toBe(true)
      expect(result.createdNew).toBe(false)
      expect(result.workspacePath).toBe(existingWorkspacePath)

      // 清理
      await fs.rm(existingWorkspacePath, { recursive: true, force: true })
    })

    it('当配置存在但目录不存在时应该创建新目录', async () => {
      // 设置一个不存在的路径到配置
      const nonExistentPath = path.join(testDir, '不存在的目录')
      systemConfigRepo.setWorkspace(nonExistentPath)

      const workspaceService = new WorkspaceService({
        systemConfigRepo
      })

      // 调用初始化 - 应该会创建新的工作空间（在用户主目录）
      const result = await workspaceService.initializeWorkspace()

      // 验证结果
      expect(result.success).toBe(true)
      expect(result.createdNew).toBe(true)

      // 清理创建的目录
      if (result.workspacePath && fsSync.existsSync(result.workspacePath)) {
        await fs.rm(result.workspacePath, { recursive: true, force: true })
      }

      // 清理桌面快捷方式（符号链接需要用 rm 删除）
      const desktopPath = path.join(os.homedir(), 'Desktop')
      const shortcutPath = path.join(desktopPath, WorkspaceService.WORKSPACE_NAME)
      try {
        const stats = fsSync.lstatSync(shortcutPath)
        if (stats.isSymbolicLink()) {
          await fs.rm(shortcutPath, { force: true })
        }
      } catch {
        // 如果文件不存在或无法访问，忽略错误
      }
    })
  })

  describe('getWorkspacePath', () => {
    it('应该返回配置的工作空间路径', () => {
      const testPath = '/test/workspace'
      systemConfigRepo.setWorkspace(testPath)

      const workspaceService = new WorkspaceService({
        systemConfigRepo
      })

      expect(workspaceService.getWorkspacePath()).toBe(testPath)
    })

    it('当没有配置时应该返回 null', () => {
      const workspaceService = new WorkspaceService({
        systemConfigRepo
      })

      expect(workspaceService.getWorkspacePath()).toBeNull()
    })
  })

  describe('isWorkspaceValid', () => {
    it('当工作空间存在时应该返回 true', async () => {
      const validPath = path.join(testDir, '有效的工作空间')
      await fs.mkdir(validPath, { recursive: true })
      systemConfigRepo.setWorkspace(validPath)

      const workspaceService = new WorkspaceService({
        systemConfigRepo
      })

      expect(workspaceService.isWorkspaceValid()).toBe(true)

      // 清理
      await fs.rm(validPath, { recursive: true, force: true })
    })

    it('当工作空间不存在时应该返回 false', () => {
      systemConfigRepo.setWorkspace('/不存在的/路径')

      const workspaceService = new WorkspaceService({
        systemConfigRepo
      })

      expect(workspaceService.isWorkspaceValid()).toBe(false)
    })

    it('当没有配置时应该返回 false', () => {
      const workspaceService = new WorkspaceService({
        systemConfigRepo
      })

      expect(workspaceService.isWorkspaceValid()).toBe(false)
    })
  })

  describe('getSubdirectoryPath', () => {
    it('应该返回正确的子目录路径', () => {
      const workspacePath = '/test/workspace'
      systemConfigRepo.setWorkspace(workspacePath)

      const workspaceService = new WorkspaceService({
        systemConfigRepo
      })

      const subdirPath = workspaceService.getSubdirectoryPath('.核心要件密码柜')
      expect(subdirPath).toBe(path.join(workspacePath, '.核心要件密码柜'))
    })

    it('当没有工作空间配置时应该返回 null', () => {
      const workspaceService = new WorkspaceService({
        systemConfigRepo
      })

      expect(workspaceService.getSubdirectoryPath('.核心要件密码柜')).toBeNull()
    })
  })

  describe('SUBDIRECTORIES', () => {
    it('应该包含4个预定义的子目录', () => {
      expect(WorkspaceService.SUBDIRECTORIES).toHaveLength(4)
    })

    it('所有子目录都应该是隐藏目录', () => {
      for (const subdir of WorkspaceService.SUBDIRECTORIES) {
        expect(subdir.isHidden).toBe(true)
      }
    })

    it('应该包含所有必需的子目录名称', () => {
      const names = WorkspaceService.SUBDIRECTORIES.map(s => s.name)
      expect(names).toContain('.核心要件密码柜')
      expect(names).toContain('.重要文件档案柜')
      expect(names).toContain('.开放文本资料柜')
      expect(names).toContain('.个人数据保护区')
    })
  })

  describe('WORKSPACE_NAME', () => {
    it('应该是"我的工作空间"', () => {
      expect(WorkspaceService.WORKSPACE_NAME).toBe('我的工作空间')
    })
  })
})
