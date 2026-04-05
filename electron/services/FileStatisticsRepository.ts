import type { Database as DatabaseType, Statement } from 'better-sqlite3'

export interface FileStatistics {
  id?: number
  scan_task_id: number
  file_total: number
  workspace_file_total: number
  history_file_count: number
  non_history_file_count: number
  create_time: string
  update_time: string
  disable: number
}

export interface CreateFileStatisticsParams {
  scan_task_id: number
  file_total: number
  workspace_file_total: number
  history_file_count: number
  non_history_file_count: number
}

export interface FileStatisticsResult {
  fileTotal: number
  workspaceFileTotal: number
  historyFileCount: number
  nonHistoryFileCount: number
}

export interface StatisticsGrowth {
  lastCount: number
  currentCount: number
  growthCount: number
  growthRate: number  // 增涨率，百分比形式，如 5.5 表示 5.5%
}

export interface FileStatisticsComparison {
  workspaceStatistics: StatisticsGrowth    // 工作空间文件数统计
  nonHistoryStatistics: StatisticsGrowth   // 非历史文件数统计
  historyStatistics: StatisticsGrowth      // 历史文件数统计
  hasComparison: boolean                   // 是否有对比数据（至少需要两条记录）
}

/**
 * 文件数量统计数据访问层
 * 用于在扫描完成后对 data_distributing 表进行统计
 */
export class FileStatisticsRepository {
  private db: DatabaseType
  private insertStmt: Statement

  constructor(db: DatabaseType) {
    this.db = db
    this.prepareStatements()
  }

  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT INTO file_statistics (
        scan_task_id, file_total, workspace_file_total,
        history_file_count, non_history_file_count,
        create_time, update_time, disable
      ) VALUES (
        @scan_task_id, @file_total, @workspace_file_total,
        @history_file_count, @non_history_file_count,
        @create_time, @update_time, 0
      )
    `)
  }

  /**
   * 创建统计记录
   */
  create(params: CreateFileStatisticsParams): number {
    const now = new Date().toISOString()
    const result = this.insertStmt.run({
      scan_task_id: params.scan_task_id,
      file_total: params.file_total,
      workspace_file_total: params.workspace_file_total,
      history_file_count: params.history_file_count,
      non_history_file_count: params.non_history_file_count,
      create_time: now,
      update_time: now
    })
    return result.lastInsertRowid as number
  }

  /**
   * 从 data_distributing 表统计文件数量
   * @param workspacePath 工作空间路径
   * @param fullInventoryTime 首次普查时间（历史封账时间）
   */
  calculateStatistics(workspacePath: string | null, fullInventoryTime: string | null): FileStatisticsResult {
    // 统计文件总数
    const totalResult = this.db.prepare(`
      SELECT COUNT(*) as count FROM data_distributing WHERE disable = 0
    `).get() as { count: number }
    const fileTotal = totalResult.count

    // 统计工作空间文件总数
    let workspaceFileTotal = 0
    if (workspacePath) {
      const normalizedPath = workspacePath.endsWith('/') ? workspacePath : workspacePath + '/'
      const workspaceResult = this.db.prepare(`
        SELECT COUNT(*) as count FROM data_distributing
        WHERE disable = 0 AND (path LIKE ? OR path = ?)
      `).get(normalizedPath + '%', workspacePath.replace(/\/$/, '')) as { count: number }
      workspaceFileTotal = workspaceResult.count
    }

    // 统计历史文件数（文件创建时间在首次普查时间之前）
    let historyFileCount = 0
    if (fullInventoryTime) {
      const historyResult = this.db.prepare(`
        SELECT COUNT(*) as count FROM data_distributing
        WHERE disable = 0 AND file_create_time IS NOT NULL AND file_create_time < ?
      `).get(fullInventoryTime) as { count: number }
      historyFileCount = historyResult.count
    }

    // 非历史文件数 = 文件总数 - 历史文件数
    const nonHistoryFileCount = fileTotal - historyFileCount

    return {
      fileTotal,
      workspaceFileTotal,
      historyFileCount,
      nonHistoryFileCount
    }
  }

  /**
   * 执行统计并保存结果
   * @param scanTaskId 扫描任务ID
   * @param workspacePath 工作空间路径
   * @param fullInventoryTime 首次普查时间
   */
  executeAndSave(scanTaskId: number, workspacePath: string | null, fullInventoryTime: string | null): FileStatistics {
    const stats = this.calculateStatistics(workspacePath, fullInventoryTime)

    const id = this.create({
      scan_task_id: scanTaskId,
      file_total: stats.fileTotal,
      workspace_file_total: stats.workspaceFileTotal,
      history_file_count: stats.historyFileCount,
      non_history_file_count: stats.nonHistoryFileCount
    })

    const now = new Date().toISOString()
    return {
      id,
      scan_task_id: scanTaskId,
      file_total: stats.fileTotal,
      workspace_file_total: stats.workspaceFileTotal,
      history_file_count: stats.historyFileCount,
      non_history_file_count: stats.nonHistoryFileCount,
      create_time: now,
      update_time: now,
      disable: 0
    }
  }

  /**
   * 根据扫描任务ID获取统计记录
   */
  getByScanTaskId(scanTaskId: number): FileStatistics | null {
    const result = this.db.prepare(`
      SELECT * FROM file_statistics WHERE scan_task_id = ? AND disable = 0
    `).get(scanTaskId) as FileStatistics | undefined
    return result ?? null
  }

  /**
   * 获取最新的统计记录
   */
  getLatest(): FileStatistics | null {
    const result = this.db.prepare(`
      SELECT * FROM file_statistics WHERE disable = 0 ORDER BY create_time DESC LIMIT 1
    `).get() as FileStatistics | undefined
    return result ?? null
  }

  /**
   * 获取所有统计记录
   */
  getAll(): FileStatistics[] {
    return this.db.prepare(`
      SELECT * FROM file_statistics WHERE disable = 0 ORDER BY create_time DESC
    `).all() as FileStatistics[]
  }

  /**
   * 获取最近的两条统计记录
   * 返回按创建时间降序排列的记录，第一条为最新记录
   */
  getLatestTwo(): FileStatistics[] {
    return this.db.prepare(`
      SELECT * FROM file_statistics WHERE disable = 0 ORDER BY create_time DESC LIMIT 2
    `).all() as FileStatistics[]
  }

  /**
   * 计算增涨率
   * @param lastCount 上次数量
   * @param currentCount 本次数量
   * @returns 增涨率百分比，保留两位小数
   */
  private calculateGrowthRate(lastCount: number, currentCount: number): number {
    if (lastCount === 0) {
      return currentCount > 0 ? 100 : 0
    }
    return Number((((currentCount - lastCount) / lastCount) * 100).toFixed(2))
  }

  /**
   * 获取文件统计对比数据
   * 比较最近两次扫描的统计数据，计算增涨情况
   */
  getStatisticsComparison(): FileStatisticsComparison {
    const records = this.getLatestTwo()

    // 默认值，用于没有数据或只有一条数据的情况
    const emptyGrowth: StatisticsGrowth = {
      lastCount: 0,
      currentCount: 0,
      growthCount: 0,
      growthRate: 0
    }

    if (records.length === 0) {
      return {
        workspaceStatistics: { ...emptyGrowth },
        nonHistoryStatistics: { ...emptyGrowth },
        historyStatistics: { ...emptyGrowth },
        hasComparison: false
      }
    }

    const current = records[0]
    const last = records.length > 1 ? records[1] : null

    // 计算工作空间文件数统计
    const workspaceStatistics: StatisticsGrowth = {
      lastCount: last?.workspace_file_total ?? 0,
      currentCount: current.workspace_file_total,
      growthCount: current.workspace_file_total - (last?.workspace_file_total ?? 0),
      growthRate: this.calculateGrowthRate(last?.workspace_file_total ?? 0, current.workspace_file_total)
    }

    // 计算非历史文件数统计
    const nonHistoryStatistics: StatisticsGrowth = {
      lastCount: last?.non_history_file_count ?? 0,
      currentCount: current.non_history_file_count,
      growthCount: current.non_history_file_count - (last?.non_history_file_count ?? 0),
      growthRate: this.calculateGrowthRate(last?.non_history_file_count ?? 0, current.non_history_file_count)
    }

    // 计算历史文件数统计
    const historyStatistics: StatisticsGrowth = {
      lastCount: last?.history_file_count ?? 0,
      currentCount: current.history_file_count,
      growthCount: current.history_file_count - (last?.history_file_count ?? 0),
      growthRate: this.calculateGrowthRate(last?.history_file_count ?? 0, current.history_file_count)
    }

    return {
      workspaceStatistics,
      nonHistoryStatistics,
      historyStatistics,
      hasComparison: records.length > 1
    }
  }
}
