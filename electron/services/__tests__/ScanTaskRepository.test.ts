import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseService } from '../DatabaseService'
import { ScanTaskRepository, ScanTask } from '../ScanTaskRepository'

describe('ScanTaskRepository', () => {
  let testDir: string
  let sqlPath: string
  let dbPath: string
  let dbService: DatabaseService
  let repo: ScanTaskRepository

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `scan-task-repo-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    // 创建测试用的 database.sql 文件
    sqlPath = path.join(testDir, 'database.sql')
    const sql = `
-- 扫描任务表 scan_task
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
    file_all_suffix_text TEXT,
    file_all_suffix_count INTEGER,
    file_count_suffix_count INTEGER,
    workspace_count INTEGER,
    end_time DATETIME,
    scan_log TEXT,
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

  beforeEach(() => {
    dbPath = path.join(testDir, `test-${Date.now()}.db`)
    dbService = new DatabaseService({ dbPath, sqlPath })
    dbService.init()
    repo = new ScanTaskRepository(dbService.getDb())
  })

  afterEach(() => {
    dbService.close()
    if (fsSync.existsSync(dbPath)) {
      fsSync.unlinkSync(dbPath)
    }
  })

  describe('create', () => {
    it('should create a scan task with required fields', () => {
      const taskId = repo.create({
        scan_type: 'FILE',
        file_scan_range: '/home/user'
      })

      expect(taskId).toBeGreaterThan(0)

      const task = repo.getById(taskId)
      expect(task).not.toBeNull()
      expect(task!.scan_type).toBe('FILE')
      expect(task!.file_scan_range).toBe('/home/user')
      expect(task!.task_state).toBe('run')
      expect(task!.heartbeat).toBe(0)
      expect(task!.file_scanned_count).toBe(0)
    })

    it('should create task with optional parameters', () => {
      const taskId = repo.create({
        scan_type: 'FILE',
        file_scan_range: '/data',
        workspace_path: '/workspace',
        scan_args: '{"extensions": [".doc", ".pdf"]}',
        file_total: 1000
      })

      const task = repo.getById(taskId)
      expect(task!.workspace_path).toBe('/workspace')
      expect(task!.scan_args).toBe('{"extensions": [".doc", ".pdf"]}')
      expect(task!.file_total).toBe(1000)
    })

    it('should create multiple tasks with incrementing IDs', () => {
      const taskId1 = repo.create({ scan_type: 'FILE' })
      const taskId2 = repo.create({ scan_type: 'DATABASE' })

      expect(taskId2).toBeGreaterThan(taskId1)
    })
  })

  describe('updateProgress', () => {
    it('should update heartbeat and scanned count', () => {
      const taskId = repo.create({ scan_type: 'FILE', file_total: 100 })

      repo.updateProgress(taskId, {
        heartbeat: 5,
        file_scanned_count: 50,
        task_phase: 'scanning'
      })

      const task = repo.getById(taskId)
      expect(task!.heartbeat).toBe(5)
      expect(task!.file_scanned_count).toBe(50)
      expect(task!.task_phase).toBe('scanning')
    })

    it('should update update_time on progress update', async () => {
      const taskId = repo.create({ scan_type: 'FILE' })
      const initialTask = repo.getById(taskId)
      const initialUpdateTime = initialTask!.update_time

      // 等待一小段时间确保时间戳不同
      await new Promise(resolve => setTimeout(resolve, 10))

      repo.updateProgress(taskId, {
        heartbeat: 1,
        file_scanned_count: 10
      })

      const updatedTask = repo.getById(taskId)
      expect(updatedTask!.update_time).not.toBe(initialUpdateTime)
    })
  })

  describe('markSucceeded', () => {
    it('should mark task as succeeded', () => {
      const taskId = repo.create({ scan_type: 'FILE' })

      repo.markSucceeded(taskId)

      const task = repo.getById(taskId)
      expect(task!.task_state).toBe('succeed')
      expect(task!.end_time).not.toBeNull()
      expect(task!.task_error_message).toBe('')
    })
  })

  describe('markFailed', () => {
    it('should mark task as failed with error message', () => {
      const taskId = repo.create({ scan_type: 'FILE' })

      repo.markFailed(taskId, 'Disk full')

      const task = repo.getById(taskId)
      expect(task!.task_state).toBe('fail')
      expect(task!.end_time).not.toBeNull()
      expect(task!.task_error_message).toBe('Disk full')
    })
  })

  describe('updateFileTotal', () => {
    it('should update file total', () => {
      const taskId = repo.create({ scan_type: 'FILE' })

      repo.updateFileTotal(taskId, 5000)

      const task = repo.getById(taskId)
      expect(task!.file_total).toBe(5000)
    })
  })

  describe('updateWorkspaceInfo', () => {
    it('should update workspace info fields', () => {
      const taskId = repo.create({ scan_type: 'FILE' })

      repo.updateWorkspaceInfo(taskId, {
        workspace_path: '/new/workspace',
        file_all_suffix_count: 15,
        file_count_suffix_count: 20,
        workspace_count: 100
      })

      const task = repo.getById(taskId)
      expect(task!.workspace_path).toBe('/new/workspace')
      expect(task!.file_all_suffix_count).toBe(15)
      expect(task!.file_count_suffix_count).toBe(20)
      expect(task!.workspace_count).toBe(100)
    })
  })

  describe('getById', () => {
    it('should return null for non-existent task', () => {
      const task = repo.getById(99999)
      expect(task).toBeNull()
    })

    it('should not return disabled tasks', () => {
      const taskId = repo.create({ scan_type: 'FILE' })

      // 手动禁用任务
      dbService.getDb().prepare('UPDATE scan_task SET disable = 1 WHERE id = ?').run(taskId)

      const task = repo.getById(taskId)
      expect(task).toBeNull()
    })
  })

  describe('getLastSuccessfulTask', () => {
    it('should return null when no tasks exist', () => {
      const task = repo.getLastSuccessfulTask()
      expect(task).toBeNull()
    })

    it('should return the most recent successful task', () => {
      const taskId1 = repo.create({ scan_type: 'FILE' })
      repo.markSucceeded(taskId1)

      const taskId2 = repo.create({ scan_type: 'FILE' })
      repo.markSucceeded(taskId2)

      const taskId3 = repo.create({ scan_type: 'FILE' })
      repo.markFailed(taskId3, 'test error')

      const lastSuccessful = repo.getLastSuccessfulTask()
      expect(lastSuccessful).not.toBeNull()
      expect(lastSuccessful!.id).toBe(taskId2)
    })
  })

  describe('getPreviousSuccessfulTask', () => {
    it('should return null when task does not exist', () => {
      const previous = repo.getPreviousSuccessfulTask(99999)
      expect(previous).toBeNull()
    })

    it('should return null when no previous successful task exists', () => {
      const taskId = repo.create({ scan_type: 'FILE' })

      const previous = repo.getPreviousSuccessfulTask(taskId)
      expect(previous).toBeNull()
    })

    it('should return the previous successful task', async () => {
      const taskId1 = repo.create({ scan_type: 'FILE', file_scan_range: '/old' })
      repo.markSucceeded(taskId1)

      // 等待确保时间戳不同
      await new Promise(resolve => setTimeout(resolve, 10))

      const taskId2 = repo.create({ scan_type: 'FILE', file_scan_range: '/new' })
      repo.markSucceeded(taskId2)

      await new Promise(resolve => setTimeout(resolve, 10))

      const taskId3 = repo.create({ scan_type: 'FILE', file_scan_range: '/newer' })
      repo.markSucceeded(taskId3)

      const previous = repo.getPreviousSuccessfulTask(taskId3)
      expect(previous).not.toBeNull()
      expect(previous!.id).toBe(taskId2)
      expect(previous!.file_scan_range).toBe('/new')
    })

    it('should skip non-successful tasks when finding previous', async () => {
      const taskId1 = repo.create({ scan_type: 'FILE', file_scan_range: '/old' })
      repo.markSucceeded(taskId1)

      await new Promise(resolve => setTimeout(resolve, 10))

      const taskId2 = repo.create({ scan_type: 'FILE', file_scan_range: '/failed' })
      repo.markFailed(taskId2, 'test error')

      await new Promise(resolve => setTimeout(resolve, 10))

      const taskId3 = repo.create({ scan_type: 'FILE', file_scan_range: '/new' })
      repo.markSucceeded(taskId3)

      const previous = repo.getPreviousSuccessfulTask(taskId3)
      expect(previous).not.toBeNull()
      expect(previous!.id).toBe(taskId1) // 应该跳过失败的任务
    })
  })

  describe('getTasksWithPagination', () => {
    it('should return empty result when no tasks exist', () => {
      const result = repo.getTasksWithPagination({ page: 1, pageSize: 10 })

      expect(result.tasks).toEqual([])
      expect(result.total).toBe(0)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(10)
    })

    it('should return paginated tasks', () => {
      // 创建 25 个任务
      const taskIds: number[] = []
      for (let i = 0; i < 25; i++) {
        const taskId = repo.create({ scan_type: 'FILE' })
        taskIds.push(taskId)
        repo.markSucceeded(taskId)
      }

      const page1 = repo.getTasksWithPagination({ page: 1, pageSize: 10 })
      expect(page1.tasks).toHaveLength(10)
      expect(page1.total).toBe(25)
      expect(page1.page).toBe(1)
      expect(page1.pageSize).toBe(10)

      const page2 = repo.getTasksWithPagination({ page: 2, pageSize: 10 })
      expect(page2.tasks).toHaveLength(10)
      expect(page2.total).toBe(25)

      const page3 = repo.getTasksWithPagination({ page: 3, pageSize: 10 })
      expect(page3.tasks).toHaveLength(5)

      // 验证是按创建时间倒序排列
      expect(page1.tasks[0].id).toBe(taskIds[24]) // 最后创建的在前
    })

    it('should include paramsChanged in tasks', async () => {
      const taskId1 = repo.create({
        scan_type: 'FILE',
        workspace_path: '/workspace1',
        file_scan_range: '/scan1',
        file_total: 100
      })
      repo.markSucceeded(taskId1)

      await new Promise(resolve => setTimeout(resolve, 10))

      const taskId2 = repo.create({
        scan_type: 'FILE',
        workspace_path: '/workspace2',  // 工作空间变更
        file_scan_range: '/scan1',
        file_total: 100
      })
      repo.markSucceeded(taskId2)

      await new Promise(resolve => setTimeout(resolve, 10))

      const taskId3 = repo.create({
        scan_type: 'FILE',
        workspace_path: '/workspace2',
        file_scan_range: '/scan2',  // 扫描范围变更
        file_total: 100
      })
      repo.markSucceeded(taskId3)

      const result = repo.getTasksWithPagination({ page: 1, pageSize: 10 })

      // task2 应该有 workspacePathChanged 标记
      const task2 = result.tasks.find(t => t.id === taskId2)
      expect(task2).toBeDefined()
      expect(task2!.paramsChanged.workspacePathChanged).toBe(true)
      expect(task2!.paramsChanged.scanAreaPathChanged).toBe(false)

      // task3 应该有 scanAreaPathChanged 标记
      const task3 = result.tasks.find(t => t.id === taskId3)
      expect(task3).toBeDefined()
      expect(task3!.paramsChanged.workspacePathChanged).toBe(false)
      expect(task3!.paramsChanged.scanAreaPathChanged).toBe(true)
    })
  })

  describe('getAllTasks', () => {
    it('should return all tasks', () => {
      repo.create({ scan_type: 'FILE' })
      repo.create({ scan_type: 'DATABASE' })
      repo.create({ scan_type: 'FILE' })

      const tasks = repo.getAllTasks()

      expect(tasks).toHaveLength(3)
      expect(tasks[0].scan_type).toBe('FILE') // 倒序
      expect(tasks[2].scan_type).toBe('FILE')
      expect(tasks[1].scan_type).toBe('DATABASE')
    })
  })

  describe('getTaskDetailById', () => {
    it('should return null for non-existent task', () => {
      const detail = repo.getTaskDetailById(99999)
      expect(detail).toBeNull()
    })

    it('should return task with paramsChanged', async () => {
      const taskId1 = repo.create({
        scan_type: 'FILE',
        workspace_path: '/workspace1',
        file_scan_range: '/scan1',
        file_total: 100
      })
      repo.markSucceeded(taskId1)

      await new Promise(resolve => setTimeout(resolve, 10))

      const taskId2 = repo.create({
        scan_type: 'FILE',
        workspace_path: '/workspace2',  // 工作空间变更
        file_scan_range: '/scan1',
        file_total: 100
      })
      repo.markSucceeded(taskId2)

      const detail = repo.getTaskDetailById(taskId2)

      expect(detail).not.toBeNull()
      expect(detail!.id).toBe(taskId2)
      expect(detail!.paramsChanged.workspacePathChanged).toBe(true)
      expect(detail!.paramsChanged.scanAreaPathChanged).toBe(false)
      expect(detail!.paramsChanged.controlTypeChanged).toBe(false)
    })
  })

  describe('paramsChanged calculation', () => {
    it('should detect workspace path change', async () => {
      const taskId1 = repo.create({
        scan_type: 'FILE',
        workspace_path: '/old/path',
        file_scan_range: '/scan',
        file_total: 100
      })
      repo.markSucceeded(taskId1)

      await new Promise(resolve => setTimeout(resolve, 10))

      const taskId2 = repo.create({
        scan_type: 'FILE',
        workspace_path: '/new/path',
        file_scan_range: '/scan',
        file_total: 100
      })
      repo.markSucceeded(taskId2)

      const detail = repo.getTaskDetailById(taskId2)
      expect(detail!.paramsChanged.workspacePathChanged).toBe(true)
    })

    it('should detect scan area path change', async () => {
      const taskId1 = repo.create({
        scan_type: 'FILE',
        workspace_path: '/workspace',
        file_scan_range: '/old/scan',
        file_total: 100
      })
      repo.markSucceeded(taskId1)

      await new Promise(resolve => setTimeout(resolve, 10))

      const taskId2 = repo.create({
        scan_type: 'FILE',
        workspace_path: '/workspace',
        file_scan_range: '/new/scan',
        file_total: 100
      })
      repo.markSucceeded(taskId2)

      const detail = repo.getTaskDetailById(taskId2)
      expect(detail!.paramsChanged.scanAreaPathChanged).toBe(true)
    })

    it('should detect control type change', async () => {
      const taskId1 = repo.create({
        scan_type: 'FILE',
        file_scan_range: '/scan',
        file_total: 100
      })
      repo.markSucceeded(taskId1)

      await new Promise(resolve => setTimeout(resolve, 10))

      // 手动设置 file_all_suffix_text
      dbService.getDb().prepare(
        'UPDATE scan_task SET file_all_suffix_text = ? WHERE id = ?'
      ).run('.pdf,.docx', taskId1)

      const taskId2 = repo.create({
        scan_type: 'FILE',
        file_scan_range: '/scan',
        file_total: 100
      })
      repo.markSucceeded(taskId2)

      // 设置不同的 file_all_suffix_text
      dbService.getDb().prepare(
        'UPDATE scan_task SET file_all_suffix_text = ? WHERE id = ?'
      ).run('.pdf,.docx,.xlsx', taskId2)

      const detail = repo.getTaskDetailById(taskId2)
      expect(detail!.paramsChanged.controlTypeChanged).toBe(true)
    })

    it('should return false for all params when no previous successful task', () => {
      const taskId = repo.create({
        scan_type: 'FILE',
        workspace_path: '/workspace',
        file_scan_range: '/scan',
        file_total: 100
      })
      repo.markSucceeded(taskId)

      const detail = repo.getTaskDetailById(taskId)
      expect(detail!.paramsChanged.workspacePathChanged).toBe(false)
      expect(detail!.paramsChanged.scanAreaPathChanged).toBe(false)
      expect(detail!.paramsChanged.controlTypeChanged).toBe(false)
    })
  })
})
