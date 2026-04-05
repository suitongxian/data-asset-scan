import type { Database as DatabaseType } from 'better-sqlite3'

export type ScanType = 'FILE' | 'DATABASE'
export type TaskState = 'run' | 'succeed' | 'fail'

export interface ScanTask {
  id?: number
  scan_type: ScanType
  file_scan_range?: string
  heartbeat: number
  workspace_path?: string
  task_state: TaskState
  task_phase?: string
  task_error_message?: string
  scan_args?: string
  file_total?: number
  file_scanned_count?: number
  file_all_suffix_text?: string      // 本次扫描用的所有文件后缀
  file_all_suffix_count?: number     // 本次扫描的所有后缀数量
  file_count_suffix_count?: number   // 工作空间中文件后缀种类数量
  workspace_count?: number
  end_time?: string
  scan_log?: string
  create_time: string
  update_time: string
  disable: number
}

// 参数变更信息
export interface ParamsChanged {
  workspacePathChanged: boolean      // 工作空间变更
  scanAreaPathChanged: boolean       // 扫描范围变更
  controlTypeChanged: boolean        // 管控类型变更
}

// 带参数变更标签的扫描任务
export interface ScanTaskWithParamsChanged extends ScanTask {
  paramsChanged: ParamsChanged
}

// 查询参数
export interface ScanTaskQueryParams {
  page?: number
  pageSize?: number
}

// 分页结果
export interface ScanTaskPageResult {
  tasks: ScanTaskWithParamsChanged[]
  total: number
  page: number
  pageSize: number
}

export interface CreateScanTaskParams {
  scan_type: ScanType
  file_scan_range?: string
  workspace_path?: string
  scan_args?: string
  file_total?: number
}

export interface UpdateProgressParams {
  heartbeat: number
  file_scanned_count: number
  task_phase?: string
}

export interface UpdateWorkspaceParams {
  workspace_path?: string
  file_all_suffix_count?: number      // 本次扫描用到的所有后缀种类数量
  file_count_suffix_count?: number    // 工作空间中文件后缀种类数量
  workspace_count?: number            // 工作空间文件数量
}

/**
 * 扫描任务数据访问层
 */
export class ScanTaskRepository {
  private db: DatabaseType
  private insertStmt: ReturnType<DatabaseType['prepare']>
  private updateProgressStmt: ReturnType<DatabaseType['prepare']>
  private updateStateStmt: ReturnType<DatabaseType['prepare']>
  private getByIdStmt: ReturnType<DatabaseType['prepare']>

  constructor(db: DatabaseType) {
    this.db = db
    this.prepareStatements()
  }

  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT INTO scan_task (
        scan_type, file_scan_range, heartbeat, workspace_path, task_state,
        task_phase, task_error_message, scan_args, file_total, file_scanned_count,
        create_time, update_time, disable
      ) VALUES (
        @scan_type, @file_scan_range, @heartbeat, @workspace_path, @task_state,
        @task_phase, @task_error_message, @scan_args, @file_total, @file_scanned_count,
        @create_time, @update_time, @disable
      )
    `)

    this.updateProgressStmt = this.db.prepare(`
      UPDATE scan_task
      SET heartbeat = @heartbeat,
          file_scanned_count = @file_scanned_count,
          task_phase = @task_phase,
          update_time = @update_time
      WHERE id = @id
    `)

    this.updateStateStmt = this.db.prepare(`
      UPDATE scan_task
      SET task_state = @task_state,
          task_error_message = @task_error_message,
          end_time = @end_time,
          update_time = @update_time
      WHERE id = @id
    `)

    this.getByIdStmt = this.db.prepare(`
      SELECT * FROM scan_task WHERE id = ? AND disable = 0
    `)
  }

  /**
   * 创建扫描任务
   */
  create(params: CreateScanTaskParams): number {
    const now = new Date().toISOString()
    const result = this.insertStmt.run({
      scan_type: params.scan_type,
      file_scan_range: params.file_scan_range || null,
      heartbeat: 0,
      workspace_path: params.workspace_path || null,
      task_state: 'run',
      task_phase: 'initializing',
      task_error_message: '',
      scan_args: params.scan_args || null,
      file_total: params.file_total || null,
      file_scanned_count: 0,
      create_time: now,
      update_time: now,
      disable: 0
    })
    return result.lastInsertRowid as number
  }

  /**
   * 更新扫描进度
   */
  updateProgress(taskId: number, params: UpdateProgressParams): void {
    const now = new Date().toISOString()
    this.updateProgressStmt.run({
      id: taskId,
      heartbeat: params.heartbeat,
      file_scanned_count: params.file_scanned_count,
      task_phase: params.task_phase || null,
      update_time: now
    })
  }

  /**
   * 标记任务成功完成
   */
  markSucceeded(taskId: number): void {
    const now = new Date().toISOString()
    this.updateStateStmt.run({
      id: taskId,
      task_state: 'succeed',
      task_error_message: '',
      end_time: now,
      update_time: now
    })
  }

  /**
   * 标记任务失败
   */
  markFailed(taskId: number, errorMessage: string): void {
    const now = new Date().toISOString()
    this.updateStateStmt.run({
      id: taskId,
      task_state: 'fail',
      task_error_message: errorMessage,
      end_time: now,
      update_time: now
    })
  }

  /**
   * 更新文件总数
   */
  updateFileTotal(taskId: number, fileTotal: number): void {
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE scan_task
      SET file_total = ?, update_time = ?
      WHERE id = ?
    `).run(fileTotal, now, taskId)
  }

  /**
   * 根据 ID 获取任务
   */
  getById(taskId: number): ScanTask | null {
    const result = this.getByIdStmt.get(taskId) as ScanTask | undefined
    return result ?? null
  }

  /**
   * 更新工作空间相关信息
   */
  updateWorkspaceInfo(taskId: number, params: UpdateWorkspaceParams): void {
    const now = new Date().toISOString()
    const setClauses: string[] = ['update_time = ?']
    const values: (string | number | null)[] = [now]

    if (params.workspace_path !== undefined) {
      setClauses.push('workspace_path = ?')
      values.push(params.workspace_path)
    }

    if (params.file_all_suffix_count !== undefined) {
      setClauses.push('file_all_suffix_count = ?')
      values.push(params.file_all_suffix_count)
    }

    if (params.file_count_suffix_count !== undefined) {
      setClauses.push('file_count_suffix_count = ?')
      values.push(params.file_count_suffix_count)
    }

    if (params.workspace_count !== undefined) {
      setClauses.push('workspace_count = ?')
      values.push(params.workspace_count)
    }

    values.push(taskId)

    this.db.prepare(`
      UPDATE scan_task
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `).run(...values)
  }

  /**
   * 获取上一次成功的扫描任务
   * 用于参数变更比较
   */
  getLastSuccessfulTask(): ScanTask | null {
    const stmt = this.db.prepare(`
      SELECT * FROM scan_task
      WHERE task_state = 'succeed' AND disable = 0
      ORDER BY create_time DESC
      LIMIT 1
    `)
    const result = stmt.get() as ScanTask | undefined
    return result ?? null
  }

  /**
   * 获取指定任务之前的上一次成功的扫描任务
   * @param taskId 当前任务ID
   */
  getPreviousSuccessfulTask(taskId: number): ScanTask | null {
    const currentTask = this.getById(taskId)
    if (!currentTask) return null

    const stmt = this.db.prepare(`
      SELECT * FROM scan_task
      WHERE task_state = 'succeed'
        AND disable = 0
        AND create_time < ?
      ORDER BY create_time DESC
      LIMIT 1
    `)
    const result = stmt.get(currentTask.create_time) as ScanTask | undefined
    return result ?? null
  }

  /**
   * 计算参数变更
   * @param currentTask 当前任务
   * @param previousTask 上一次成功的任务
   */
  private calculateParamsChanged(currentTask: ScanTask, previousTask: ScanTask | null): ParamsChanged {
    if (!previousTask) {
      // 没有历史任务，所有字段都视为未变更
      return {
        workspacePathChanged: false,
        scanAreaPathChanged: false,
        controlTypeChanged: false
      }
    }

    return {
      // 工作空间变更：比较 workspace_path
      workspacePathChanged: currentTask.workspace_path !== previousTask.workspace_path,
      // 扫描范围变更：比较 file_scan_range
      scanAreaPathChanged: currentTask.file_scan_range !== previousTask.file_scan_range,
      // 管控类型变更：比较 file_all_suffix_text
      controlTypeChanged: currentTask.file_all_suffix_text !== previousTask.file_all_suffix_text
    }
  }

  /**
   * 获取扫描任务列表（分页）
   * 包含参数变更标签
   */
  getTasksWithPagination(params: ScanTaskQueryParams = {}): ScanTaskPageResult {
    const page = params.page || 1
    const pageSize = params.pageSize || 20
    const offset = (page - 1) * pageSize

    // 获取总数
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM scan_task WHERE disable = 0
    `)
    const countResult = countStmt.get() as { count: number }
    const total = countResult.count

    // 获取分页数据（按创建时间倒序）
    const dataStmt = this.db.prepare(`
      SELECT * FROM scan_task
      WHERE disable = 0
      ORDER BY create_time DESC
      LIMIT ? OFFSET ?
    `)
    const tasks = dataStmt.all(pageSize, offset) as ScanTask[]

    // 为每个任务计算参数变更标签
    const tasksWithParamsChanged: ScanTaskWithParamsChanged[] = tasks.map(task => {
      // 获取该任务之前的上一次成功任务
      const previousTask = task.id ? this.getPreviousSuccessfulTask(task.id) : null
      const paramsChanged = this.calculateParamsChanged(task, previousTask)

      return {
        ...task,
        paramsChanged
      }
    })

    return {
      tasks: tasksWithParamsChanged,
      total,
      page,
      pageSize
    }
  }

  /**
   * 获取所有扫描任务（不分页）
   * 包含参数变更标签
   */
  getAllTasks(): ScanTaskWithParamsChanged[] {
    const stmt = this.db.prepare(`
      SELECT * FROM scan_task
      WHERE disable = 0
      ORDER BY create_time DESC
    `)
    const tasks = stmt.all() as ScanTask[]

    // 为每个任务计算参数变更标签
    return tasks.map(task => {
      const previousTask = task.id ? this.getPreviousSuccessfulTask(task.id) : null
      const paramsChanged = this.calculateParamsChanged(task, previousTask)

      return {
        ...task,
        paramsChanged
      }
    })
  }

  /**
   * 获取扫描任务详情（包含参数变更标签）
   */
  getTaskDetailById(taskId: number): ScanTaskWithParamsChanged | null {
    const task = this.getById(taskId)
    if (!task) return null

    const previousTask = this.getPreviousSuccessfulTask(taskId)
    const paramsChanged = this.calculateParamsChanged(task, previousTask)

    return {
      ...task,
      paramsChanged
    }
  }
}
