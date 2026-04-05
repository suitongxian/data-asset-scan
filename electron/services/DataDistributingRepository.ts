import type { Database as DatabaseType, Statement } from 'better-sqlite3'

export type DataType = 1 | 2 // 1文件 2数据库

export interface DataDistributing {
  data_distribution_id?: number
  scan_task_id?: number
  path: string
  data_type: DataType
  scan_found_count: number
  content_sign: string
  file_suffix?: string
  file_magic?: string
  file_create_time?: string
  file_update_time?: string
  file_read_time?: string
  file_size: number
  file_hide: number
  upload_state: number  // 0.未上传 1.已上传 2.副本上传 3.上传失败
  ip: string
  mac_address: string
  parent_id?: number
  scan_time: string
  create_time: string
  update_time: string
  disable: number
}

export interface CreateDataDistributingParams {
  scan_task_id?: number
  path: string
  data_type: DataType
  content_sign: string
  file_suffix?: string
  file_magic?: string
  file_create_time?: string
  file_update_time?: string
  file_read_time?: string
  file_size: number
  file_hide?: number
  ip: string
  mac_address: string
  parent_id?: number
  scan_time: string
}

export interface FileQueryOptions {
  page?: number
  pageSize?: number
  search?: string
  workspacePath?: string
  workspaceFilter?: 'inside' | 'outside' | 'all'
  survivalFilter?: 'new' | 'deleted' | 'normal' | 'all'
}

export interface FileQueryResult {
  files: DataDistributing[]
  total: number
}

export interface FileWithCopyCount extends DataDistributing {
  copy_count: number
}

/**
 * 归档文件查询选项
 */
export interface ArchiveQueryOptions {
  page?: number
  pageSize?: number
  search?: string
  // 归档类型: 'pending' | 'core' | 'important' | 'open'
  archiveType?: 'pending' | 'core' | 'important' | 'open'
  // 重要程度过滤: 1=核心 2=重要 3=开放 (仅对 pending 类型有效)
  importanceLevelFilter?: number
}

/**
 * 归档文件查询结果
 */
export interface ArchiveFileResult {
  files: FileWithCopyCount[]
  total: number
}

/**
 * 数据分布数据访问层
 * 支持批量写入以提高性能
 */
export class DataDistributingRepository {
  private db: DatabaseType
  private insertStmt: Statement
  private batchBuffer: CreateDataDistributingParams[] = []
  private batchSize: number

  constructor(db: DatabaseType, batchSize: number = 100) {
    this.db = db
    this.batchSize = batchSize
    this.prepareStatements()
  }

  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT INTO data_distributing (
        scan_task_id, path, data_type, scan_found_count, content_sign, file_suffix,
        file_magic, file_create_time, file_update_time, file_read_time,
        file_size, file_hide, ip, mac_address, parent_id, scan_time,
        create_time, update_time, disable
      ) VALUES (
        @scan_task_id, @path, @data_type, @scan_found_count, @content_sign, @file_suffix,
        @file_magic, @file_create_time, @file_update_time, @file_read_time,
        @file_size, @file_hide, @ip, @mac_address, @parent_id, @scan_time,
        @create_time, @update_time, @disable
      )
    `)
  }

  /**
   * 添加单条记录到缓冲区
   * 当缓冲区满时自动批量写入
   * @returns 如果触发了批量写入，返回写入的数量
   */
  add(params: CreateDataDistributingParams): number {
    this.batchBuffer.push(params)

    if (this.batchBuffer.length >= this.batchSize) {
      return this.flush()
    }
    return 0
  }

  /**
   * 批量写入缓冲区中的所有记录
   * @returns 写入的记录数量
   */
  flush(): number {
    if (this.batchBuffer.length === 0) {
      return 0
    }

    const count = this.batchBuffer.length
    const now = new Date().toISOString()

    // 使用事务批量写入
    const insertMany = this.db.transaction((first, ...rest: CreateDataDistributingParams[]) => {
      const records = rest.length === 0 && Array.isArray(first) ? first : [first, ...rest]
      for (const record of records) {
        this.insertStmt.run({
          scan_task_id: record.scan_task_id || null,
          path: record.path,
          data_type: record.data_type,
          scan_found_count: 1,
          content_sign: record.content_sign,
          file_suffix: record.file_suffix || null,
          file_magic: record.file_magic || null,
          file_create_time: record.file_create_time || null,
          file_update_time: record.file_update_time || null,
          file_read_time: record.file_read_time || null,
          file_size: record.file_size,
          file_hide: record.file_hide || 0,
          ip: record.ip,
          mac_address: record.mac_address,
          parent_id: record.parent_id || null,
          scan_time: record.scan_time,
          create_time: now,
          update_time: now,
          disable: 0
        })
      }
    })

    insertMany(this.batchBuffer)
    this.batchBuffer = []
    return count
  }

  /**
   * 获取当前缓冲区中的记录数量
   */
  getBufferSize(): number {
    return this.batchBuffer.length
  }

  /**
   * 直接批量插入记录（不使用缓冲区）
   */
  insertBatch(records: CreateDataDistributingParams[]): number {
    if (records.length === 0) {
      return 0
    }

    const now = new Date().toISOString()

    const insertMany = this.db.transaction((first, ...rest: CreateDataDistributingParams[]) => {
      const records = rest.length === 0 && Array.isArray(first) ? first : [first, ...rest]
      for (const record of records) {
        this.insertStmt.run({
          scan_task_id: record.scan_task_id || null,
          path: record.path,
          data_type: record.data_type,
          scan_found_count: 1,
          content_sign: record.content_sign,
          file_suffix: record.file_suffix || null,
          file_magic: record.file_magic || null,
          file_create_time: record.file_create_time || null,
          file_update_time: record.file_update_time || null,
          file_read_time: record.file_read_time || null,
          file_size: record.file_size,
          file_hide: record.file_hide || 0,
          ip: record.ip,
          mac_address: record.mac_address,
          parent_id: record.parent_id || null,
          scan_time: record.scan_time,
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
   * 根据内容签名查询记录
   */
  getByContentSign(contentSign: string): DataDistributing[] {
    return this.db.prepare(`
      SELECT * FROM data_distributing
      WHERE content_sign = ? AND disable = 0
    `).all(contentSign) as DataDistributing[]
  }

  /**
   * 统计记录总数
   */
  count(): number {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM data_distributing WHERE disable = 0
    `).get() as { count: number }
    return result.count
  }

  /**
   * 物理删除所有记录（用于首次普查重置）
   * 注意：这是物理删除，不可恢复
   */
  truncate(): number {
    const result = this.db.prepare('DELETE FROM data_distributing').run()
    return result.changes
  }

  /**
   * 逻辑删除指定时间之前的记录
   * @param beforeTime 时间阈值，扫描开始时间之前的记录将被逻辑删除
   */
  disableBeforeTime(beforeTime: string): number {
    const result = this.db.prepare(`
      UPDATE data_distributing
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
  getAll(): DataDistributing[] {
    return this.db.prepare(`
      SELECT * FROM data_distributing
    `).all() as DataDistributing[]
  }

  /**
   * 获取活动记录（排除逻辑删除）
   */
  getActive(): DataDistributing[] {
    return this.db.prepare(`
      SELECT * FROM data_distributing WHERE disable = 0
    `).all() as DataDistributing[]
  }

  /**
   * 获取所有有效记录并以路径为key构建Map
   * 用于存续状态比对
   */
  getActiveByPathMap(): Map<string, DataDistributing> {
    const records = this.getActive()
    const map = new Map<string, DataDistributing>()
    for (const record of records) {
      map.set(record.path, record)
    }
    return map
  }

  /**
   * 获取指定路径前缀下的有效记录并以路径为key构建Map
   * 用于定点扫描的存续状态比对
   * @param pathPrefix 路径前缀，通常是 workspace 目录
   */
  getActiveByPathMapWithPrefix(pathPrefix: string): Map<string, DataDistributing> {
    // 根据路径中已有的分隔符来判断使用哪种分隔符（支持 Windows 和 Unix）
    const separator = pathPrefix.includes('\\') ? '\\' : '/'
    const normalizedPrefix = pathPrefix.endsWith(separator) ? pathPrefix : pathPrefix + separator
    const records = this.db.prepare(`
      SELECT * FROM data_distributing
      WHERE disable = 0 AND (path LIKE ? OR path = ?)
    `).all(normalizedPrefix + '%', pathPrefix.replace(/[/\\]$/, '')) as DataDistributing[]

    const map = new Map<string, DataDistributing>()
    for (const record of records) {
      map.set(record.path, record)
    }
    return map
  }

  /**
   * 更新指定记录的 scan_found_count
   */
  updateScanFoundCount(dataDistributionId: number, scanFoundCount: number): void {
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE data_distributing
      SET scan_found_count = ?, update_time = ?
      WHERE data_distribution_id = ?
    `).run(scanFoundCount, now, dataDistributionId)
  }

  /**
   * 批量将正常文件（存续文件）的 scan_found_count 加1
   * @param ids 需要更新的记录ID列表
   */
  batchIncrementScanFoundCount(ids: number[]): number {
    if (ids.length === 0) return 0

    const now = new Date().toISOString()
    const updateMany = this.db.transaction((idList: number[]) => {
      const stmt = this.db.prepare(`
        UPDATE data_distributing
        SET scan_found_count = scan_found_count + 1, update_time = ?
        WHERE data_distribution_id = ?
      `)
      for (const id of idList) {
        stmt.run(now, id)
      }
    })

    updateMany(ids)
    return ids.length
  }

  /**
   * 批量标记删除文件（scan_found_count 设为 0）
   * @param ids 需要标记为删除的记录ID列表
   */
  batchMarkAsDeleted(ids: number[]): number {
    if (ids.length === 0) return 0

    const now = new Date().toISOString()
    const updateMany = this.db.transaction((idList: number[]) => {
      const stmt = this.db.prepare(`
        UPDATE data_distributing
        SET scan_found_count = 0, update_time = ?
        WHERE data_distribution_id = ?
      `)
      for (const id of idList) {
        stmt.run(now, id)
      }
    })

    updateMany(ids)
    return ids.length
  }

  /**
   * 根据 content_sign 获取所有相关记录
   * 用于删除文件时获取其 content_sign 以更新 data_resources
   */
  getByIds(ids: number[]): DataDistributing[] {
    if (ids.length === 0) return []

    const placeholders = ids.map(() => '?').join(',')
    return this.db.prepare(`
      SELECT * FROM data_distributing
      WHERE data_distribution_id IN (${placeholders})
    `).all(...ids) as DataDistributing[]
  }

  /**
   * 根据路径获取记录
   */
  getByPath(path: string): DataDistributing | null {
    const result = this.db.prepare(`
      SELECT * FROM data_distributing
      WHERE path = ? AND disable = 0
    `).get(path) as DataDistributing | undefined
    return result ?? null
  }

  /**
   * 分页查询文件列表（带副本数）
   */
  getFilesWithPagination(options: FileQueryOptions = {}): FileQueryResult {
    const {
      page = 1,
      pageSize = 50,
      search,
      workspacePath,
      workspaceFilter = 'all',
      survivalFilter = 'all'
    } = options

    const offset = (page - 1) * pageSize
    const conditions: string[] = ['d.disable = 0']
    const params: (string | number)[] = []

    // 搜索条件
    if (search) {
      conditions.push('d.path LIKE ?')
      params.push(`%${search}%`)
    }

    // 存续状态过滤
    if (survivalFilter !== 'all') {
      if (survivalFilter === 'new') {
        conditions.push('d.scan_found_count = 1')
      } else if (survivalFilter === 'deleted') {
        conditions.push('d.scan_found_count = 0')
      } else if (survivalFilter === 'normal') {
        conditions.push('d.scan_found_count > 1')
      }
    }

    // 工作空间过滤
    if (workspacePath && workspaceFilter !== 'all') {
      // 根据路径中已有的分隔符来判断使用哪种分隔符（支持 Windows 和 Unix）
      const separator = workspacePath.includes('\\') ? '\\' : '/'
      const normalizedPath = workspacePath.endsWith(separator) ? workspacePath : workspacePath + separator
      if (workspaceFilter === 'inside') {
        conditions.push('(d.path LIKE ? OR d.path = ?)')
        params.push(normalizedPath + '%', workspacePath.replace(/[/\\]$/, ''))
      } else if (workspaceFilter === 'outside') {
        conditions.push('NOT (d.path LIKE ? OR d.path = ?)')
        params.push(normalizedPath + '%', workspacePath.replace(/[/\\]$/, ''))
      }
    }

    const whereClause = conditions.join(' AND ')

    // 查询总数
    const countSql = `SELECT COUNT(*) as count FROM data_distributing d WHERE ${whereClause}`
    const countResult = this.db.prepare(countSql).get(...params) as { count: number }
    const total = countResult.count

    // 查询数据（带副本数）
    const dataSql = `
      SELECT d.*, r.source_count as copy_count
      FROM data_distributing d
      LEFT JOIN data_resources r ON d.content_sign = r.content_sign
      WHERE ${whereClause}
      ORDER BY d.update_time DESC
      LIMIT ? OFFSET ?
    `
    const files = this.db.prepare(dataSql).all(...params, pageSize, offset) as FileWithCopyCount[]

    return { files, total }
  }

  /**
   * 获取指定内容签名的副本数量
   */
  getCopyCount(contentSign: string): number {
    const result = this.db.prepare(`
      SELECT r.source_count as count
      FROM data_resources r
      WHERE r.content_sign = ? AND r.disable = 0
    `).get(contentSign) as { count: number } | undefined
    return result?.count ?? 0
  }

  /**
   * 获取指定内容签名的所有副本
   */
  getCopiesByContentSign(contentSign: string): DataDistributing[] {
    return this.db.prepare(`
      SELECT * FROM data_distributing
      WHERE content_sign = ? AND disable = 0
      ORDER BY update_time DESC
    `).all(contentSign) as DataDistributing[]
  }

  /**
   * 获取所有文件（带副本数），不分页
   * 用于虚拟表格一次性加载
   */
  getAllFilesWithCopyCount(options: Omit<FileQueryOptions, 'page' | 'pageSize'> = {}): FileWithCopyCount[] {
    const {
      search,
      workspacePath,
      workspaceFilter = 'all',
      survivalFilter = 'all'
    } = options

    const conditions: string[] = ['d.disable = 0']
    const params: (string | number)[] = []

    // 搜索条件
    if (search) {
      conditions.push('d.path LIKE ?')
      params.push(`%${search}%`)
    }

    // 存续状态过滤
    if (survivalFilter !== 'all') {
      if (survivalFilter === 'new') {
        conditions.push('d.scan_found_count = 1')
      } else if (survivalFilter === 'deleted') {
        conditions.push('d.scan_found_count = 0')
      } else if (survivalFilter === 'normal') {
        conditions.push('d.scan_found_count > 1')
      }
    }

    // 工作空间过滤
    if (workspacePath && workspaceFilter !== 'all') {
      // 根据路径中已有的分隔符来判断使用哪种分隔符（支持 Windows 和 Unix）
      const separator = workspacePath.includes('\\') ? '\\' : '/'
      const normalizedPath = workspacePath.endsWith(separator) ? workspacePath : workspacePath + separator
      if (workspaceFilter === 'inside') {
        conditions.push('(d.path LIKE ? OR d.path = ?)')
        params.push(normalizedPath + '%', workspacePath.replace(/[/\\]$/, ''))
      } else if (workspaceFilter === 'outside') {
        conditions.push('NOT (d.path LIKE ? OR d.path = ?)')
        params.push(normalizedPath + '%', workspacePath.replace(/[/\\]$/, ''))
      }
    }

    const whereClause = conditions.join(' AND ')

    const sql = `
      SELECT d.*, r.source_count as copy_count
      FROM data_distributing d
      LEFT JOIN data_resources r ON d.content_sign = r.content_sign
      WHERE ${whereClause}
      ORDER BY d.update_time DESC
    `
    return this.db.prepare(sql).all(...params) as FileWithCopyCount[]
  }

  /**
   * 更新指定记录的上传状态
   * @param dataDistributionId 记录ID
   * @param uploadState 上传状态 0.未上传 1.已上传 2.副本上传 3.上传失败
   */
  updateUploadState(dataDistributionId: number, uploadState: number): void {
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE data_distributing
      SET upload_state = ?, update_time = ?
      WHERE data_distribution_id = ?
    `).run(uploadState, now, dataDistributionId)
  }

  /**
   * 根据内容签名更新所有相同文件的上传状态为副本状态
   * @param contentSign 内容签名
   * @param excludeId 排除的记录ID（已上传的那个）
   */
  updateCopiesUploadState(contentSign: string, excludeId: number): number {
    const now = new Date().toISOString()
    const result = this.db.prepare(`
      UPDATE data_distributing
      SET upload_state = 2, update_time = ?
      WHERE content_sign = ? AND data_distribution_id != ? AND disable = 0 AND upload_state = 0
    `).run(now, contentSign, excludeId)
    return result.changes
  }

  /**
   * 根据路径获取记录（包含upload_state）
   */
  getByPathWithUploadState(path: string): DataDistributing | null {
    const result = this.db.prepare(`
      SELECT * FROM data_distributing
      WHERE path = ? AND disable = 0
    `).get(path) as DataDistributing | undefined
    return result ?? null
  }

  /**
   * 批量更新已修改文件的信息
   * 当文件内容发生变化时，更新 content_sign、file_update_time、file_size 等字段
   * 同时将 scan_found_count 设为 1（重新开始计数）
   * @param updates 需要更新的文件信息列表
   */
  batchUpdateModifiedFiles(updates: Array<{
    dataDistributionId: number
    contentSign: string
    fileUpdateTime: string | null
    fileReadTime: string | null
    fileSize: number
    fileMagic: string | null
  }>): number {
    if (updates.length === 0) return 0

    const now = new Date().toISOString()
    const updateMany = this.db.transaction((items: typeof updates) => {
      const stmt = this.db.prepare(`
        UPDATE data_distributing
        SET content_sign = ?,
            file_update_time = ?,
            file_read_time = ?,
            file_size = ?,
            file_magic = ?,
            scan_found_count = 1,
            update_time = ?
        WHERE data_distribution_id = ?
      `)
      for (const item of items) {
        stmt.run(
          item.contentSign,
          item.fileUpdateTime,
          item.fileReadTime,
          item.fileSize,
          item.fileMagic,
          now,
          item.dataDistributionId
        )
      }
    })

    updateMany(updates)
    return updates.length
  }

  /**
   * 查询归档管理文件
   * 通过 data_distributing left join data_resources on content_sign 来查询
   * 根据不同的归档类型返回不同的数据集：
   * - pending: 电子文件归档申请 (upload_state=0 && importance_level IN (1,2,3))
   * - core: 核心级要件保密柜归档 (upload_state IN (1,2) && importance_level=1)
   * - important: 重要级文件档案柜归档 (upload_state IN (1,2) && importance_level=2)
   * - open: 开放级文本资料柜归档 (upload_state IN (1,2) && importance_level=3)
   */
  getArchiveFiles(options: ArchiveQueryOptions = {}): ArchiveFileResult {
    const {
      page = 1,
      pageSize = 50,
      search,
      archiveType = 'pending',
      importanceLevelFilter
    } = options

    const offset = (page - 1) * pageSize
    const conditions: string[] = ['d.disable = 0']
    const params: (string | number)[] = []

    // 搜索条件
    if (search) {
      conditions.push('d.path LIKE ?')
      params.push(`%${search}%`)
    }

    // 根据归档类型添加过滤条件
    switch (archiveType) {
      case 'pending':
        // 电子文件归档申请: upload_state=0 && importance_level IN (1,2,3)
        conditions.push('d.upload_state = 0')
        if (importanceLevelFilter !== undefined && importanceLevelFilter !== null) {
          // 如果指定了重要程度过滤，只查询该级别的文件
          conditions.push('r.importance_level = ?')
          params.push(importanceLevelFilter)
        } else {
          // 否则查询所有待归档的文件（核心、重要、开放）
          conditions.push('r.importance_level IN (1, 2, 3)')
        }
        break
      case 'core':
        // 核心级要件保密柜归档: upload_state IN (1,2) && importance_level=1
        conditions.push('d.upload_state IN (1, 2)')
        conditions.push('r.importance_level = 1')
        break
      case 'important':
        // 重要级文件档案柜归档: upload_state IN (1,2) && importance_level=2
        conditions.push('d.upload_state IN (1, 2)')
        conditions.push('r.importance_level = 2')
        break
      case 'open':
        // 开放级文本资料柜归档: upload_state IN (1,2) && importance_level=3
        conditions.push('d.upload_state IN (1, 2)')
        conditions.push('r.importance_level = 3')
        break
    }

    const whereClause = conditions.join(' AND ')

    // 查询总数
    const countSql = `SELECT COUNT(*) as count FROM data_distributing d LEFT JOIN data_resources r ON d.content_sign = r.content_sign WHERE ${whereClause}`
    const countResult = this.db.prepare(countSql).get(...params) as { count: number }
    const total = countResult.count

    // 查询数据（带副本数和 importance_level）
    const dataSql = `
      SELECT d.*, r.source_count as copy_count, r.importance_level
      FROM data_distributing d
      LEFT JOIN data_resources r ON d.content_sign = r.content_sign
      WHERE ${whereClause}
      ORDER BY d.update_time DESC
      LIMIT ? OFFSET ?
    `
    const files = this.db.prepare(dataSql).all(...params, pageSize, offset) as (FileWithCopyCount & { importance_level?: number })[]

    return { files: files as FileWithCopyCount[], total }
  }

  /**
   * 批量更新文件的上传状态为4（无需归档）
   * @param ids 需要更新的记录ID列表
   */
  batchUpdateToNoArchive(ids: number[]): number {
    if (ids.length === 0) return 0

    const now = new Date().toISOString()
    const updateMany = this.db.transaction((idList: number[]) => {
      const stmt = this.db.prepare(`
        UPDATE data_distributing
        SET upload_state = 4, update_time = ?
        WHERE data_distribution_id = ?
      `)
      for (const id of idList) {
        stmt.run(now, id)
      }
    })

    updateMany(ids)
    return ids.length
  }
}
