import type { Database as DatabaseType, Statement } from 'better-sqlite3'
import { getLocalIP, getLocalMAC } from './util/NetworkUtil'

export interface DataResources {
  data_resources_id?: number
  content_sign: string
  source_count: number
  workspace_source_count: number
  first_create_time: string
  resources_name?: string
  resources_desc?: string
  content_subject?: string
  content_type?: string
  file_magic?: string
  is_claimed: number
  claim_status: number  // 0=未分类 1=个人隐私 2=个人工作 3=非责任类
  importance_level: number  // 0=未分类 1=核心 2=重要 3=开放 4=隐私
  claim_time?: string
  claimant_name?: string
  claimant_unit?: string
  data_level?: string
  data_share?: string
  create_time: string
  update_time: string
  disable: number
}

export interface DataResourcesQueryParams {
  page?: number
  pageSize?: number
  claimStatusFilter?: number  // 0=未分类 1=个人隐私 2=个人工作 3=非责任类
  claimStatusIn?: number[]  // 多个认领状态过滤，如 [1, 2] 表示只查询个人隐私或个人工作
  importanceLevelFilter?: number  // 0=未分类 1=核心 2=重要 3=开放 4=隐私
  search?: string
  businessTypeFilter?: 'workspace' | 'new_access' | 'history_inventory' | null  // 工作空间管控 | 新准入数据 | 历史封帐数据
  fullInventoryTime?: string  // 历史封帐时间
}

export interface DataResourcesPageResult {
  resources: DataResources[]
  total: number
  page: number
  pageSize: number
}

export interface BatchClaimParams {
  ids: number[]
  is_claimed: number
  claim_status: number
  claimant_name: string
  claimant_unit: string
}

export interface BatchClassifyParams {
  ids: number[]
  importance_level: number  // 0=未分类 1=核心 2=重要 3=开放 4=隐私
}

/**
 * 信息资源统计结果
 */
export interface ResourcesStatistics {
  totalFileCount: number            // 总文件数：所有记录的 sum(source_count)
  workspaceTotalCount: number       // 工作空间总文件数：所有记录的 sum(workspace_source_count)
  historyFileCount: number          // 历史文件总数：first_create_time < 历史封帐时间
  nonHistoryFileCount: number       // 非历史文件总数：first_create_time > 历史封帐时间
  workspaceClaimedCount: number     // 工作空间文件认领数：claim_status > 0
  historyClaimedCount: number       // 历史文件认领数
  nonHistoryClaimedCount: number    // 非历史文件认领数
  workspacePendingClassifyCount: number      // 工作空间待归类保护数：claim_status==2 && importance_level==0 && workspace_source_count > 0
  historyPendingClassifyCount: number       // 历史文件待归类保护数：claim_status==2 && importance_level==0 && first_create_time < 历史封帐时间
  nonHistoryPendingClassifyCount: number     // 非历史文件待归类保护数：claim_status==2 && importance_level==0 && first_create_time > 历史封帐时间
  // 按重要程度分类统计
  unclassifiedCount: number         // 未分类文件数：importance_level = 0
  coreCount: number                 // 核心文件数：importance_level = 1
  importantCount: number            // 重要文件数：importance_level = 2
  openCount: number                 // 开放文件数：importance_level = 3
  privacyCount: number              // 隐私文件数：importance_level = 4

}

export interface CreateDataResourcesParams {
  content_sign: string
  source_count: number
  workspace_source_count: number
  first_create_time: string
  resources_name?: string
  resources_desc?: string
  content_subject?: string
  content_type?: string
  file_magic?: string
}

/**
 * MD5 统计信息（内存中收集）
 */
export interface Md5Statistics {
  contentSign: string            // MD5 签名
  sourceCount: number            // 数据分布总数量
  workspaceSourceCount: number   // 工作空间来源数量
  firstCreateTime: string        // 数据最早创建时间
  fileMagic?: string             // 文件魔数（取第一个）
  firstFileName?: string         // 最早创建时间对应的文件名
  shortFileName?: string         // 最短文件名
}

/**
 * 信息资源数据访问层
 * 支持批量写入以提高性能
 */
export class DataResourcesRepository {
  private db: DatabaseType
  private insertStmt: Statement
  private batchSize: number

  constructor(db: DatabaseType, batchSize: number = 100) {
    this.db = db
    this.batchSize = batchSize
    this.prepareStatements()
  }

  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT INTO data_resources (
        content_sign, source_count, workspace_source_count, first_create_time,
        resources_name, resources_desc, content_subject, content_type, file_magic,
        create_time, update_time, disable
      ) VALUES (
        @content_sign, @source_count, @workspace_source_count, @first_create_time,
        @resources_name, @resources_desc, @content_subject, @content_type, @file_magic,
        @create_time, @update_time, @disable
      )
    `)
  }

  /**
   * 直接批量插入记录
   */
  insertBatch(records: CreateDataResourcesParams[]): number {
    if (records.length === 0) {
      return 0
    }

    const now = new Date().toISOString()

    const insertMany = this.db.transaction((items: CreateDataResourcesParams[]) => {
      for (const record of items) {
        this.insertStmt.run({
          content_sign: record.content_sign,
          source_count: record.source_count,
          workspace_source_count: record.workspace_source_count,
          first_create_time: record.first_create_time,
          resources_name: record.resources_name || null,
          resources_desc: record.resources_desc || null,
          content_subject: record.content_subject || null,
          content_type: record.content_type || null,
          file_magic: record.file_magic || null,
          create_time: now,
          update_time: now,
          disable: 0
        })
      }
    })

    insertMany(records)
    return records.length
  }

  /**
   * 从 MD5 统计信息批量插入
   */
  insertFromStatistics(statsMap: Map<string, Md5Statistics>): number {
    const records: CreateDataResourcesParams[] = []

    for (const stats of statsMap.values()) {
      // 从文件名中提取后缀
      let contentType: string | undefined
      if (stats.firstFileName) {
        const lastDotIndex = stats.firstFileName.lastIndexOf('.')
        if (lastDotIndex > 0 && lastDotIndex < stats.firstFileName.length - 1) {
          contentType = stats.firstFileName.substring(lastDotIndex + 1).toLowerCase()
        }
      }

      records.push({
        content_sign: stats.contentSign,
        source_count: stats.sourceCount,
        workspace_source_count: stats.workspaceSourceCount,
        first_create_time: stats.firstCreateTime,
        file_magic: stats.fileMagic,
        resources_name: stats.shortFileName,
        content_subject: 'file',
        content_type: contentType
      })
    }

    return this.insertBatch(records)
  }

  /**
   * 根据内容签名查询记录
   */
  getByContentSign(contentSign: string): DataResources | null {
    const result = this.db.prepare(`
      SELECT * FROM data_resources
      WHERE content_sign = ? AND disable = 0
    `).get(contentSign) as DataResources | undefined
    return result ?? null
  }

  /**
   * 统计记录总数
   */
  count(): number {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM data_resources WHERE disable = 0
    `).get() as { count: number }
    return result.count
  }

  /**
   * 获取所有记录（排除逻辑删除）
   */
  getAll(): DataResources[] {
    return this.db.prepare(`
      SELECT * FROM data_resources WHERE disable = 0
    `).all() as DataResources[]
  }

  /**
   * 物理删除所有记录（用于首次普查重置）
   * 注意：这是物理删除，不可恢复
   */
  truncate(): number {
    const result = this.db.prepare('DELETE FROM data_resources').run()
    return result.changes
  }

  /**
   * 逻辑删除指定时间之前的记录
   * @param beforeTime 时间阈值，扫描开始时间之前的记录将被逻辑删除
   */
  disableBeforeTime(beforeTime: string): number {
    const result = this.db.prepare(`
      UPDATE data_resources
      SET disable = 1, update_time = @now
      WHERE disable = 0 AND create_time < @beforeTime
    `).run({
      beforeTime,
      now: new Date().toISOString()
    })
    return result.changes
  }

  /**
   * 获取所有记录（包括逻辑删除的）
   */
  getAllIncludeDisabled(): DataResources[] {
    return this.db.prepare(`
      SELECT * FROM data_resources
    `).all() as DataResources[]
  }

  /**
   * 获取所有有效记录并以 content_sign 为 key 构建 Map
   * 用于存续状态比对
   */
  getActiveByContentSignMap(): Map<string, DataResources> {
    const records = this.getAll()
    const map = new Map<string, DataResources>()
    for (const record of records) {
      map.set(record.content_sign, record)
    }
    return map
  }

  /**
   * 增加资源的 source_count
   * @param contentSign 内容签名
   * @param increment 增加的数量，默认为 1
   */
  incrementSourceCount(contentSign: string, increment: number = 1): void {
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE data_resources
      SET source_count = source_count + ?, update_time = ?
      WHERE content_sign = ? AND disable = 0
    `).run(increment, now, contentSign)
  }

  /**
   * 减少资源的 source_count
   * @param contentSign 内容签名
   * @param decrement 减少的数量，默认为 1
   */
  decrementSourceCount(contentSign: string, decrement: number = 1): void {
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE data_resources
      SET source_count = MAX(0, source_count - ?), update_time = ?
      WHERE content_sign = ? AND disable = 0
    `).run(decrement, now, contentSign)
  }

  /**
   * 减少资源的 workspace_source_count
   * @param contentSign 内容签名
   * @param decrement 减少的数量，默认为 1
   */
  decrementWorkspaceSourceCount(contentSign: string, decrement: number = 1): void {
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE data_resources
      SET workspace_source_count = MAX(0, workspace_source_count - ?), update_time = ?
      WHERE content_sign = ? AND disable = 0
    `).run(decrement, now, contentSign)
  }

  /**
   * 批量减少 source_count（用于处理删除文件）
   * @param contentSigns 需要减少的 content_sign 列表
   */
  batchDecrementSourceCount(contentSigns: string[]): number {
    if (contentSigns.length === 0) return 0

    const now = new Date().toISOString()
    const updateMany = this.db.transaction((signs: string[]) => {
      const stmt = this.db.prepare(`
        UPDATE data_resources
        SET source_count = MAX(0, source_count - 1), update_time = ?
        WHERE content_sign = ? AND disable = 0
      `)
      for (const sign of signs) {
        stmt.run(now, sign)
      }
    })

    updateMany(contentSigns)
    return contentSigns.length
  }

  /**
   * 批量处理删除文件的资源更新（source_count 和 workspace_source_count）
   * @param updates 需要更新的内容签名和是否来自 workspace 的信息
   */
  batchUpdateForDeletedFiles(updates: Array<{ contentSign: string; isFromWorkspace: boolean }>): void {
    if (updates.length === 0) return

    const now = new Date().toISOString()
    const updateMany = this.db.transaction((items: Array<{ contentSign: string; isFromWorkspace: boolean }>) => {
      const stmtSourceOnly = this.db.prepare(`
        UPDATE data_resources
        SET source_count = MAX(0, source_count - 1), update_time = ?
        WHERE content_sign = ? AND disable = 0
      `)
      const stmtBoth = this.db.prepare(`
        UPDATE data_resources
        SET source_count = MAX(0, source_count - 1),
            workspace_source_count = MAX(0, workspace_source_count - 1),
            update_time = ?
        WHERE content_sign = ? AND disable = 0
      `)

      for (const item of items) {
        if (item.isFromWorkspace) {
          stmtBoth.run(now, item.contentSign)
        } else {
          stmtSourceOnly.run(now, item.contentSign)
        }
      }
    })

    updateMany(updates)
  }

  /**
   * 插入或更新资源记录
   * 如果 content_sign 已存在则更新计数，否则插入新记录
   */
  upsert(params: CreateDataResourcesParams): void {
    const existing = this.getByContentSign(params.content_sign)

    if (existing) {
      const now = new Date().toISOString()
      this.db.prepare(`
        UPDATE data_resources
        SET source_count = source_count + ?,
            workspace_source_count = workspace_source_count + ?,
            update_time = ?
        WHERE content_sign = ? AND disable = 0
      `).run(params.source_count, params.workspace_source_count, now, params.content_sign)
    } else {
      this.insertBatch([params])
    }
  }

  /**
   * 分页查询信息资源
   * @param params 查询参数
   */
  getResourcesWithPagination(params: DataResourcesQueryParams = {}): DataResourcesPageResult {
    const page = params.page || 1
    const pageSize = params.pageSize || 50
    const offset = (page - 1) * pageSize

    let whereClause = 'WHERE disable = 0'
    const queryParams: Record<string, unknown> = {}

    // 按业务类型过滤
    if (params.businessTypeFilter && params.fullInventoryTime) {
      switch (params.businessTypeFilter) {
        case 'workspace':
          // 工作空间管控: workspace_source_count > 0
          whereClause += ' AND workspace_source_count > 0'
          break
        case 'new_access':
          // 新准入数据: first_create_time > 历史封帐时间
          whereClause += ' AND first_create_time > @fullInventoryTime'
          queryParams.fullInventoryTime = params.fullInventoryTime
          break
        case 'history_inventory':
          // 历史封帐数据: first_create_time < 历史封帐时间
          whereClause += ' AND first_create_time < @fullInventoryTime'
          queryParams.fullInventoryTime = params.fullInventoryTime
          break
      }
    }

    // 按认领状态过滤（单个值）
    if (params.claimStatusFilter !== undefined && params.claimStatusFilter !== -1) {
      whereClause += ' AND claim_status = @claimStatusFilter'
      queryParams.claimStatusFilter = params.claimStatusFilter
    }

    // 按认领状态过滤（多个值）
    if (params.claimStatusIn && params.claimStatusIn.length > 0) {
      const placeholders = params.claimStatusIn.map((_, i) => `@claimStatus${i}`).join(', ')
      whereClause += ` AND claim_status IN (${placeholders})`
      params.claimStatusIn.forEach((status, i) => {
        queryParams[`claimStatus${i}`] = status
      })
    }

    // 按重要程度过滤
    if (params.importanceLevelFilter !== undefined && params.importanceLevelFilter !== -1) {
      whereClause += ' AND importance_level = @importanceLevelFilter'
      queryParams.importanceLevelFilter = params.importanceLevelFilter
    }

    // 按资源名称搜索
    if (params.search) {
      whereClause += ' AND resources_name LIKE @search'
      queryParams.search = `%${params.search}%`
    }

    // 查询总数
    const countResult = this.db.prepare(`
      SELECT COUNT(*) as count FROM data_resources ${whereClause}
    `).get(queryParams) as { count: number }

    // 分页查询数据
    const resources = this.db.prepare(`
      SELECT * FROM data_resources
      ${whereClause}
      ORDER BY first_create_time DESC
      LIMIT @limit OFFSET @offset
    `).all({
      ...queryParams,
      limit: pageSize,
      offset
    }) as DataResources[]

    return {
      resources,
      total: countResult.count,
      page,
      pageSize
    }
  }

  /**
   * 批量认领资源
   * @param params 批量认领参数
   * 注意：当 claim_status=1（个人隐私数据）时，自动设置 importance_level=4（隐私）
   */
  batchClaim(params: BatchClaimParams): number {
    if (params.ids.length === 0) return 0

    const now = new Date().toISOString()
    const claimTime = now
    // 当认领为"个人隐私数据"(claim_status=1)时，自动设置重要程度为"隐私"(importance_level=4)
    const autoImportanceLevel = params.claim_status === 1 ? 4 : null

    const updateMany = this.db.transaction((ids: number[]) => {
      // 根据是否需要自动设置 importance_level 使用不同的 SQL
      const stmt = autoImportanceLevel !== null
        ? this.db.prepare(`
            UPDATE data_resources
            SET is_claimed = @is_claimed,
                claim_status = @claim_status,
                claim_time = @claim_time,
                claimant_name = @claimant_name,
                claimant_unit = @claimant_unit,
                importance_level = @importance_level,
                update_time = @update_time
            WHERE data_resources_id = @id AND disable = 0
          `)
        : this.db.prepare(`
            UPDATE data_resources
            SET is_claimed = @is_claimed,
                claim_status = @claim_status,
                claim_time = @claim_time,
                claimant_name = @claimant_name,
                claimant_unit = @claimant_unit,
                update_time = @update_time
            WHERE data_resources_id = @id AND disable = 0
          `)

      let updated = 0
      for (const id of ids) {
        const runParams: Record<string, unknown> = {
          is_claimed: params.is_claimed,
          claim_status: params.claim_status,
          claim_time: claimTime,
          claimant_name: params.claimant_name,
          claimant_unit: params.claimant_unit,
          update_time: now,
          id
        }
        if (autoImportanceLevel !== null) {
          runParams.importance_level = autoImportanceLevel
        }
        const result = stmt.run(runParams)
        updated += result.changes
      }
      return updated
    })

    return updateMany(params.ids)
  }

  /**
   * 批量归类保护（更新重要程度）
   * @param params 批量归类参数
   * @returns 成功更新的记录数
   */
  batchClassify(params: BatchClassifyParams): number {
    if (params.ids.length === 0) return 0

    const now = new Date().toISOString()

    const updateMany = this.db.transaction((ids: number[]) => {
      const stmt = this.db.prepare(`
        UPDATE data_resources
        SET importance_level = @importance_level,
            update_time = @update_time
        WHERE data_resources_id = @id AND disable = 0
      `)

      let updated = 0
      for (const id of ids) {
        const result = stmt.run({
          importance_level: params.importance_level,
          update_time: now,
          id
        })
        updated += result.changes
      }
      return updated
    })

    return updateMany(params.ids)
  }

  /**
   * 根据 ID 获取资源记录
   */
  getById(id: number): DataResources | null {
    const result = this.db.prepare(`
      SELECT * FROM data_resources
      WHERE data_resources_id = ? AND disable = 0
    `).get(id) as DataResources | undefined
    return result ?? null
  }

  /**
   * 获取待同步的资源记录（包含关联的 IP 和 MAC 地址）
   * @param sinceTime 起始时间，只返回 update_time 大于该时间的记录；如果为空则返回所有记录
   * @param limit 返回记录数量限制
   * @param offset 偏移量，用于分批同步
   */
  getPendingSyncRecords(sinceTime: string | null = null, limit: number = 100, offset: number = 0): Array<{
    data_resources_id: number
    content_sign: string
    source_count: number
    source_ip: string
    source_mac: string
    update_time: string
    first_create_time: string
    content_subject: string | null
    content_type: string | null
    file_magic: string | null
    claim_status: number
    claim_time: string | null
    importance_level: number
    data_share: string | null
  }> {
    let whereClause = 'WHERE dr.disable = 0'
    const params: unknown[] = []

    if (sinceTime) {
      whereClause += ' AND dr.update_time > ?'
      params.push(sinceTime)
    }

    whereClause += ' ORDER BY dr.update_time ASC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    // 获取本机 IP 和 MAC 地址
    const localIp = getLocalIP()
    const localMac = getLocalMAC()

    const sql = `
      SELECT
        dr.data_resources_id,
        dr.content_sign,
        dr.source_count,
        dr.update_time,
        dr.first_create_time,
        dr.content_subject,
        dr.content_type,
        dr.file_magic,
        dr.claim_status,
        dr.claim_time,
        dr.importance_level,
        dr.data_share
      FROM data_resources dr
      ${whereClause}
    `

    const records = this.db.prepare(sql).all(...params) as Array<{
      data_resources_id: number
      content_sign: string
      source_count: number
      update_time: string
      first_create_time: string
      content_subject: string | null
      content_type: string | null
      file_magic: string | null
      claim_status: number
      claim_time: string | null
      importance_level: number
      data_share: string | null
    }>

    // 为每条记录添加本机 IP 和 MAC
    return records.map(record => ({
      ...record,
      source_ip: localIp,
      source_mac: localMac
    }))
  }

  /**
   * 统计待同步的记录数量
   * @param sinceTime 起始时间，只统计 update_time 大于该时间的记录；如果为空则统计所有记录
   */
  countPendingSyncRecords(sinceTime: string | null = null): number {
    let whereClause = 'WHERE dr.disable = 0'
    const params: unknown[] = []

    if (sinceTime) {
      whereClause += ' AND dr.update_time > ?'
      params.push(sinceTime)
    }

    const sql = `
      SELECT COUNT(*) as count
      FROM data_resources dr
      ${whereClause}
    `

    const result = this.db.prepare(sql).get(...params) as { count: number }
    return result.count
  }

  /**
   * 获取信息资源统计数据
   * @param fullInventoryTime 历史封帐时间，如果为空则与历史相关的字段返回 -1
   */
  getResourcesStatistics(fullInventoryTime: string | null = null): ResourcesStatistics {
    // 基础统计：总文件数、工作空间总文件数、认领数和重要程度分类
    const baseStats = this.db.prepare(`
      SELECT
        COALESCE(SUM(source_count), 0) as totalFileCount,
        COALESCE(SUM(workspace_source_count), 0) as workspaceTotalCount,
        COALESCE(SUM(CASE WHEN claim_status > 0 THEN workspace_source_count ELSE 0 END), 0) as workspaceClaimedCount,
        COALESCE(SUM(CASE WHEN importance_level = 0 THEN source_count ELSE 0 END), 0) as unclassifiedCount,
        COALESCE(SUM(CASE WHEN importance_level = 1 THEN source_count ELSE 0 END), 0) as coreCount,
        COALESCE(SUM(CASE WHEN importance_level = 2 THEN source_count ELSE 0 END), 0) as importantCount,
        COALESCE(SUM(CASE WHEN importance_level = 3 THEN source_count ELSE 0 END), 0) as openCount,
        COALESCE(SUM(CASE WHEN importance_level = 4 THEN source_count ELSE 0 END), 0) as privacyCount
      FROM data_resources
      WHERE disable = 0
    `).get() as {
      totalFileCount: number
      workspaceTotalCount: number
      workspaceClaimedCount: number
      unclassifiedCount: number
      coreCount: number
      importantCount: number
      openCount: number
      privacyCount: number
    }

    // 工作空间待归类保护数：claim_status==2 && importance_level==0 && workspace_source_count > 0
    const workspacePendingStats = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM data_resources
      WHERE disable = 0 AND claim_status = 2 AND importance_level = 0 AND workspace_source_count > 0
    `).get() as { count: number }

    // 如果没有历史封帐时间，与历史相关的统计返回 -1
    if (!fullInventoryTime) {
      return {
        totalFileCount: baseStats.totalFileCount,
        workspaceTotalCount: baseStats.workspaceTotalCount,
        historyFileCount: -1,
        nonHistoryFileCount: -1,
        workspaceClaimedCount: baseStats.workspaceClaimedCount,
        historyClaimedCount: -1,
        nonHistoryClaimedCount: -1,
        workspacePendingClassifyCount: workspacePendingStats.count,
        historyPendingClassifyCount: -1,
        nonHistoryPendingClassifyCount: -1,
        unclassifiedCount: baseStats.unclassifiedCount,
        coreCount: baseStats.coreCount,
        importantCount: baseStats.importantCount,
        openCount: baseStats.openCount,
        privacyCount: baseStats.privacyCount
      }
    }

    // 带历史封帐时间的完整统计
    const historyStats = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN first_create_time < @fullInventoryTime THEN source_count ELSE 0 END), 0) as historyFileCount,
        COALESCE(SUM(CASE WHEN first_create_time > @fullInventoryTime THEN source_count ELSE 0 END), 0) as nonHistoryFileCount,
        COALESCE(SUM(CASE WHEN first_create_time < @fullInventoryTime AND claim_status > 0 THEN source_count ELSE 0 END), 0) as historyClaimedCount,
        COALESCE(SUM(CASE WHEN first_create_time > @fullInventoryTime AND claim_status > 0 THEN source_count ELSE 0 END), 0) as nonHistoryClaimedCount,
        COALESCE(COUNT(CASE WHEN first_create_time < @fullInventoryTime AND claim_status = 2 AND importance_level = 0 THEN 1 END), 0) as historyPendingClassifyCount,
        COALESCE(COUNT(CASE WHEN first_create_time > @fullInventoryTime AND claim_status = 2 AND importance_level = 0 THEN 1 END), 0) as nonHistoryPendingClassifyCount
      FROM data_resources
      WHERE disable = 0
    `).get({ fullInventoryTime }) as {
      historyFileCount: number
      nonHistoryFileCount: number
      historyClaimedCount: number
      nonHistoryClaimedCount: number
      historyPendingClassifyCount: number
      nonHistoryPendingClassifyCount: number
    }

    return {
      totalFileCount: baseStats.totalFileCount,
      workspaceTotalCount: baseStats.workspaceTotalCount,
      historyFileCount: historyStats.historyFileCount,
      nonHistoryFileCount: historyStats.nonHistoryFileCount,
      workspaceClaimedCount: baseStats.workspaceClaimedCount,
      historyClaimedCount: historyStats.historyClaimedCount,
      nonHistoryClaimedCount: historyStats.nonHistoryClaimedCount,
      workspacePendingClassifyCount: workspacePendingStats.count,
      historyPendingClassifyCount: historyStats.historyPendingClassifyCount,
      nonHistoryPendingClassifyCount: historyStats.nonHistoryPendingClassifyCount,
      unclassifiedCount: baseStats.unclassifiedCount,
      coreCount: baseStats.coreCount,
      importantCount: baseStats.importantCount,
      openCount: baseStats.openCount,
      privacyCount: baseStats.privacyCount
    }
  }

  /**
   * 批量处理修改文件的资源更新
   * 对于修改过的文件，需要：
   * 1. 减少旧 content_sign 的计数
   * 2. 增加新 content_sign 的计数（如果存在）或创建新记录（如果不存在）
   * @param updates 需要更新的信息列表
   * @param existingResources 当前存在的资源记录 Map（用于判断新 content_sign 是否已存在）
   */
  batchUpdateForModifiedFiles(
    updates: Array<{
      oldContentSign: string
      newContentSign: string
      isFromWorkspace: boolean
      fileCreateTime: string
      fileMagic: string | null
      fileName: string
    }>,
    existingResources: Map<string, DataResources>
  ): void {
    if (updates.length === 0) return

    const now = new Date().toISOString()

    // 收集需要创建的新资源记录
    const newResourcesMap = new Map<string, {
      contentSign: string
      sourceCount: number
      workspaceSourceCount: number
      firstCreateTime: string
      fileMagic: string | null
      fileName: string
      shortFileName: string
    }>()

    const updateTransaction = this.db.transaction(() => {
      const stmtDecrementSourceOnly = this.db.prepare(`
        UPDATE data_resources
        SET source_count = MAX(0, source_count - 1), update_time = ?
        WHERE content_sign = ? AND disable = 0
      `)
      const stmtDecrementBoth = this.db.prepare(`
        UPDATE data_resources
        SET source_count = MAX(0, source_count - 1),
            workspace_source_count = MAX(0, workspace_source_count - 1),
            update_time = ?
        WHERE content_sign = ? AND disable = 0
      `)
      const stmtIncrementSourceOnly = this.db.prepare(`
        UPDATE data_resources
        SET source_count = source_count + 1, update_time = ?
        WHERE content_sign = ? AND disable = 0
      `)
      const stmtIncrementBoth = this.db.prepare(`
        UPDATE data_resources
        SET source_count = source_count + 1,
            workspace_source_count = workspace_source_count + 1,
            update_time = ?
        WHERE content_sign = ? AND disable = 0
      `)

      for (const update of updates) {
        // 1. 减少旧 content_sign 的计数
        if (update.isFromWorkspace) {
          stmtDecrementBoth.run(now, update.oldContentSign)
        } else {
          stmtDecrementSourceOnly.run(now, update.oldContentSign)
        }

        // 2. 处理新 content_sign
        const existingResource = existingResources.get(update.newContentSign)
        if (existingResource) {
          // 已存在，增加计数
          if (update.isFromWorkspace) {
            stmtIncrementBoth.run(now, update.newContentSign)
          } else {
            stmtIncrementSourceOnly.run(now, update.newContentSign)
          }
        } else {
          // 不存在，需要收集后批量创建
          const existing = newResourcesMap.get(update.newContentSign)
          if (existing) {
            existing.sourceCount++
            if (update.isFromWorkspace) {
              existing.workspaceSourceCount++
            }
            // 更新最早创建时间
            if (update.fileCreateTime < existing.firstCreateTime) {
              existing.firstCreateTime = update.fileCreateTime
              existing.fileName = update.fileName
            }
            // 更新最短文件名
            if (update.fileName.length < existing.shortFileName.length) {
              existing.shortFileName = update.fileName
            }
          } else {
            newResourcesMap.set(update.newContentSign, {
              contentSign: update.newContentSign,
              sourceCount: 1,
              workspaceSourceCount: update.isFromWorkspace ? 1 : 0,
              firstCreateTime: update.fileCreateTime,
              fileMagic: update.fileMagic,
              fileName: update.fileName,
              shortFileName: update.fileName
            })
          }
        }
      }
    })

    updateTransaction()

    // 批量插入新资源记录
    if (newResourcesMap.size > 0) {
      const newRecords: CreateDataResourcesParams[] = []
      for (const stats of newResourcesMap.values()) {
        let contentType: string | undefined
        if (stats.shortFileName) {
          const lastDotIndex = stats.shortFileName.lastIndexOf('.')
          if (lastDotIndex > 0 && lastDotIndex < stats.shortFileName.length - 1) {
            contentType = stats.shortFileName.substring(lastDotIndex + 1).toLowerCase()
          }
        }
        newRecords.push({
          content_sign: stats.contentSign,
          source_count: stats.sourceCount,
          workspace_source_count: stats.workspaceSourceCount,
          first_create_time: stats.firstCreateTime,
          file_magic: stats.fileMagic || undefined,
          resources_name: stats.shortFileName,
          content_subject: 'file',
          content_type: contentType
        })
      }
      this.insertBatch(newRecords)
    }
  }
}
