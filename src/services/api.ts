/**
 * 前端 API 服务层
 * 封装与后端 HTTP API 的通信
 */

const API_BASE = 'http://127.0.0.1:3001'

export interface FileItem {
  data_distribution_id: number
  path: string
  data_type: number
  scan_found_count: number
  content_sign: string
  file_suffix: string | null
  file_magic: string | null
  file_create_time: string | null
  file_update_time: string | null
  file_read_time: string | null
  file_size: number
  file_hide: number
  upload_state: number  // 0.未上传 1.已上传 2.副本上传 3.上传失败 4.无需归档
  ip: string
  mac_address: string
  scan_time: string
  create_time: string
  update_time: string
  copy_count: number
}

/**
 * 归档管理文件项（包含重要级别）
 */
export interface ArchiveManagementFileItem extends FileItem {
  importance_level?: number  // 0=未分类 1=核心 2=重要 3=开放 4=隐私
}

export interface SystemConfig {
  workspace: string | null
  full_inventory_time: string | null
  daily_scan_interval: number
  last_scan_time: string | null
  control_type: string | null
  scan_area_path: string | null
  scan_exclude_dir: string | null
  upload_server_url: string | null
  last_sync_time: string | null
  home_dir: string
}

export interface ScanStatus {
  isScanning: boolean
  currentTaskId: number | null
  lastScanTime: string | null
}

// 归档申请表
export interface ArchiveApplication {
  applicant_unit: string          // 申请人单位
  applicant_department: string    // 申请人部门
  applicant_name: string          // 申请人姓名
  applicant_contact: string       // 联系方式
  archive_file_name: string       // 归档文件名称
  archive_file_category: string   // 归档文件类别
  archive_file_hash: string       // 文件特征值
  application_time: string        // 申请时间
  content_title: string           // 内容标题
  content_summary: string         // 内容摘要
  data_classification: '核心' | '重要' | '一般' | '公开'  // 数据定级
  protection_method: 1 | 2        // 保护方式
  share_range: string             // 共享范围
}

export interface ArchiveResult {
  success: boolean
  message?: string
  data?: {
    id: number
    filePath: string
    fileExists: boolean
  }
}

export interface FileQueryParams {
  search?: string
  workspaceFilter?: 'inside' | 'outside' | 'all'
  survivalFilter?: 'new' | 'deleted' | 'normal' | 'all'
  page?: number
  pageSize?: number
  noPagination?: boolean
}

/**
 * 归档管理查询参数
 */
export interface ArchiveManagementQueryParams {
  search?: string
  archiveType?: 'pending' | 'core' | 'important' | 'open'  // 归档类型
  importanceLevelFilter?: number  // 重要程度过滤: 1=核心 2=重要 3=开放 (仅对 pending 类型有效)
  page?: number
  pageSize?: number
}

export interface ScanProgressEvent {
  type: 'progress' | 'complete' | 'error'
  taskId?: number
  phase?: string
  scannedCount: number
  totalCount: number
  currentFile?: string
  elapsedMs: number
  success?: boolean
  errorMessage?: string
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

// 用户信息
export interface UserInfo {
  id: number
  company_name: string
  user_name: string
  department: string
  ip: string
  mac_address: string
  work_address: string | null
  phone: string | null
  create_time: string
  update_time: string
}

export interface SaveUserInfoParams {
  company_name: string
  user_name: string
  department: string
  phone?: string | null
  work_address?: string | null
}

// 信息资源
export interface DataResource {
  data_resources_id: number
  content_sign: string
  source_count: number
  workspace_source_count: number
  first_create_time: string
  resources_name: string | null
  resources_desc: string | null
  content_subject: string | null
  content_type: string | null
  file_magic: string | null
  is_claimed: number
  claim_status: number  // 0=未分类 1=个人隐私 2=个人工作 3=非责任类
  importance_level: number  // 0=未分类 1=核心 2=重要 3=开放 4=隐私
  claim_time: string | null
  claimant_name: string | null
  claimant_unit: string | null
  data_level: string | null
  data_share: string | null
  create_time: string
  update_time: string
  disable: number
}

export interface DataResourcesQueryParams {
  page?: number
  pageSize?: number
  claimStatusFilter?: number
  claimStatusIn?: number[]  // 多个认领状态过滤，如 [1, 2] 表示只查询个人隐私或个人工作
  importanceLevelFilter?: number
  search?: string
  businessTypeFilter?: 'workspace' | 'new_access' | 'history_inventory' | null
}

export interface DataResourcesPageResult {
  resources: DataResource[]
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

export interface SingleClassifyParams {
  data_resources_id: number
  importance_level: number  // 1=保密柜(核心要件) 2=档案柜(重要文件) 3=资料柜(一般文件)
  resources_name?: string
  resources_desc?: string
  content_subject?: string
}

// 信息资源统计结果
export interface ResourcesStatistics {
  totalFileCount: number            // 总文件数
  workspaceTotalCount: number       // 工作空间总文件数
  historyFileCount: number          // 历史文件总数
  nonHistoryFileCount: number       // 非历史文件总数
  workspaceClaimedCount: number     // 工作空间文件认领数
  historyClaimedCount: number       // 历史文件认领数
  nonHistoryClaimedCount: number    // 非历史文件认领数
  workspacePendingClassifyCount: number      // 工作空间待归类保护数：claim_status==2 && importance_level==0 && workspace_source_count > 0
  historyPendingClassifyCount: number       // 历史文件待归类保护数：claim_status==2 && importance_level==0 && first_create_time < 历史封帐时间
  nonHistoryPendingClassifyCount: number     // 非历史文件待归类保护数：claim_status==2 && importance_level==0 && first_create_time > 历史封帐时间
  unclassifiedCount: number          // 未分类文件数
  coreCount: number                 // 核心文件数
  importantCount: number            // 重要文件数
  openCount: number                 // 开放文件数
  privacyCount: number              // 隐私文件数
}

// 归档文件
export interface ArchiveFile {
  id: number
  application_name: string
  applicant_unit: string
  applicant_department: string
  applicant_name: string
  applicant_contact: string
  archive_file_name: string
  archive_file_category: string
  archive_file_hash: string
  application_time: string
  content_title: string
  content_summary: string | null
  data_classification: '核心' | '重要' | '一般' | '公开'
  protection_method: number
  create_time: string
  update_time: string
}

export interface ArchiveFileQueryParams {
  page?: number
  pageSize?: number
  applicant_name?: string
}

export interface ArchiveFilePageResult {
  list: ArchiveFile[]
  total: number
  page: number
  pageSize: number
}

// 借阅申请参数
export interface BorrowDownloadParams {
  archive_id: number
  borrower_name: string
  borrower_department: string
  borrow_reason?: string
  borrow_method: 1 | 2  // 1=在线查看 2=下载
}

class ApiService {
  /**
   * 获取文件列表
   */
  async getFiles(params: FileQueryParams = {}): Promise<{ files: FileItem[], total: number }> {
    const searchParams = new URLSearchParams()

    if (params.search) searchParams.set('search', params.search)
    if (params.workspaceFilter) searchParams.set('workspaceFilter', params.workspaceFilter)
    if (params.survivalFilter) searchParams.set('survivalFilter', params.survivalFilter)
    if (params.page) searchParams.set('page', String(params.page))
    if (params.pageSize) searchParams.set('pageSize', String(params.pageSize))
    if (params.noPagination) searchParams.set('noPagination', 'true')

    const response = await fetch(`${API_BASE}/files?${searchParams}`)
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch files')
    }

    return result.data
  }

  /**
   * 获取指定内容签名的所有副本
   */
  async getCopies(contentSign: string): Promise<{ copies: FileItem[], count: number }> {
    const response = await fetch(`${API_BASE}/files/${encodeURIComponent(contentSign)}/copies`)
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch copies')
    }

    return result.data
  }

  /**
   * 获取系统配置
   */
  async getConfig(): Promise<SystemConfig> {
    const response = await fetch(`${API_BASE}/config`)
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch config')
    }

    return result.data
  }

  /**
   * 保存系统配置
   */
  async saveConfig(config: Partial<SystemConfig>): Promise<void> {
    const response = await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    })
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to save config')
    }
  }

  /**
   * 获取扫描状态
   */
  async getScanStatus(): Promise<ScanStatus> {
    const response = await fetch(`${API_BASE}/scan/status`)
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch scan status')
    }

    return result.data
  }

  /**
   * 触发原子扫描
   * 返回 EventSource 用于接收实时进度
   * 扫描参数由后端从配置中获取，前端只需传递扫描模式
   */
  triggerScan(options: {
    scanMode: 'FULL_INVENTORY' | 'DAILY_CHECK' | 'TARGETED_SCAN'
  }): EventSource {
    const searchParams = new URLSearchParams()
    searchParams.set('scan_mode', options.scanMode)

    return new EventSource(`${API_BASE}/scan/atomic?${searchParams}`)
  }

  /**
   * 检查是否需要自动日常盘点
   */
  async shouldAutoScan(): Promise<boolean> {
    const config = await this.getConfig()

    // 如果没有进行过首次普查，不自动扫描
    if (!config.full_inventory_time) {
      return false
    }

    // 如果没有最后扫描时间，需要扫描
    if (!config.last_scan_time) {
      return true
    }

    // 检查是否超过扫描间隔
    const lastScanTime = new Date(config.last_scan_time).getTime()
    const intervalMs = (config.daily_scan_interval || 15) * 60 * 1000
    const now = Date.now()

    return (now - lastScanTime) > intervalMs
  }

  /**
   * 获取文件统计对比数据
   */
  async getStatistics(): Promise<FileStatisticsComparison> {
    const response = await fetch(`${API_BASE}/statistics`)
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch statistics')
    }

    return result.data
  }

  /**
   * 获取信息资源统计数据
   */
  async getResourcesStatistics(): Promise<ResourcesStatistics> {
    const response = await fetch(`${API_BASE}/resources/statistics`)
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch resources statistics')
    }

    return result.data
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/health`)
      const result = await response.json()
      return result.success && result.status === 'healthy'
    } catch {
      return false
    }
  }

  /**
   * 分页获取文件列表（用于归类保护页面）
   */
  async getFilesPaginated(params: FileQueryParams = {}): Promise<{ files: FileItem[], total: number, page: number, pageSize: number }> {
    const searchParams = new URLSearchParams()

    if (params.search) searchParams.set('search', params.search)
    if (params.workspaceFilter) searchParams.set('workspaceFilter', params.workspaceFilter)
    if (params.survivalFilter) searchParams.set('survivalFilter', params.survivalFilter)
    searchParams.set('page', String(params.page || 1))
    searchParams.set('pageSize', String(params.pageSize || 50))

    const response = await fetch(`${API_BASE}/files?${searchParams}`)
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch files')
    }

    return result.data
  }

  /**
   * 上传文件到服务器
   * @param filePath 本地文件路径
   * @param serverUrl 服务器上传地址
   * @param targetDir 目标子目录
   */
  async uploadFile(filePath: string, serverUrl: string, targetDir?: string): Promise<{ success: boolean, message?: string }> {
    const url = new URL('/api/file/upload', serverUrl)
    if (targetDir) {
      url.searchParams.set('dir', targetDir)
    }

    // 使用 electron 的 IPC 来读取本地文件并上传
    // 这里通过 preload 暴露的 API 进行文件读取和上传
    const response = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filePath,
        serverUrl: url.toString()
      }),
    })

    const result = await response.json()
    return result
  }

  /**
   * 归档文件上传
   * @param filePath 本地文件路径
   * @param archiveApplication 归档申请表
   */
  async archiveFile(filePath: string, archiveApplication: ArchiveApplication): Promise<ArchiveResult> {
    const response = await fetch(`${API_BASE}/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filePath,
        archiveApplication
      }),
    })

    const result = await response.json()
    return result
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(): Promise<UserInfo | null> {
    const response = await fetch(`${API_BASE}/user-info`)
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch user info')
    }

    return result.data
  }

  /**
   * 保存用户信息
   */
  async saveUserInfo(params: SaveUserInfoParams): Promise<UserInfo> {
    const response = await fetch(`${API_BASE}/user-info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to save user info')
    }

    return result.data
  }

  /**
   * 获取信息资源列表（分页）
   */
  async getResources(params: DataResourcesQueryParams = {}): Promise<DataResourcesPageResult> {
    const searchParams = new URLSearchParams()

    if (params.page) searchParams.set('page', String(params.page))
    if (params.pageSize) searchParams.set('pageSize', String(params.pageSize))
    if (params.claimStatusFilter !== undefined) searchParams.set('claimStatusFilter', String(params.claimStatusFilter))
    if (params.claimStatusIn && params.claimStatusIn.length > 0) {
      searchParams.set('claimStatusIn', params.claimStatusIn.join(','))
    }
    if (params.importanceLevelFilter !== undefined) searchParams.set('importanceLevelFilter', String(params.importanceLevelFilter))
    if (params.businessTypeFilter) searchParams.set('businessTypeFilter', params.businessTypeFilter)
    if (params.search) searchParams.set('search', params.search)

    const response = await fetch(`${API_BASE}/resources?${searchParams}`)
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch resources')
    }

    return result.data
  }

  /**
   * 批量认领资源
   */
  async batchClaim(params: BatchClaimParams): Promise<{ updatedCount: number }> {
    const response = await fetch(`${API_BASE}/resources/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to claim resources')
    }

    return result.data
  }

  /**
   * 批量归类保护（更新重要程度）
   */
  async batchClassify(params: BatchClassifyParams): Promise<{ updatedCount: number }> {
    const response = await fetch(`${API_BASE}/resources/classify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to classify resources')
    }

    return result.data
  }

  /**
   * 单条归类保护
   * @param params 归类保护参数
   */
  async singleClassify(params: SingleClassifyParams): Promise<{ success: boolean; message: string; data?: { id: number } }> {
    const response = await fetch(`${API_BASE}/resources/classify/single`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.message || result.error || 'Failed to classify resource')
    }

    return result
  }

  /**
   * 获取归档文件列表
   * @param params 查询参数
   */
  async getArchiveFiles(params: ArchiveFileQueryParams = {}): Promise<ArchiveFilePageResult> {
    const searchParams = new URLSearchParams()

    if (params.page) searchParams.set('page', String(params.page))
    if (params.pageSize) searchParams.set('pageSize', String(params.pageSize))
    if (params.applicant_name) searchParams.set('applicant_name', params.applicant_name)

    const response = await fetch(`${API_BASE}/archive/list?${searchParams}`)
    const result = await response.json()

    if (result.code !== 0) {
      throw new Error(result.message || 'Failed to fetch archive files')
    }

    return result.data
  }

  /**
   * 借阅下载文件
   * @param params 借阅参数
   */
  async borrowDownload(params: BorrowDownloadParams): Promise<Blob> {
    const response = await fetch(`${API_BASE}/archive/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })

    // 如果响应是二进制文件，直接返回
    if (response.headers.get('content-type')?.includes('application/octet-stream')) {
      return response.blob()
    }

    // 否则解析JSON错误响应
    const errorResult = await response.json().catch(() => ({}))
    if (errorResult.code !== 0) {
      throw new Error(errorResult.message || 'Failed to download file')
    }

    throw new Error('Unexpected response')
  }

  /**
   * 在线预览文件（返回预览URL）
   * @param params 借阅参数
   */
  async getPreviewUrl(params: BorrowDownloadParams): Promise<string> {
    const response = await fetch(`${API_BASE}/archive/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })

    // 如果响应是二进制文件，创建临时URL
    if (response.headers.get('content-type')?.includes('application/octet-stream')) {
      const blob = await response.blob()
      return URL.createObjectURL(blob)
    }

    // 否则解析JSON响应
    const result = await response.json()
    if (result.code !== 0) {
      throw new Error(result.message || 'Failed to get preview URL')
    }

    return result.data.url || result.data.previewUrl
  }

  /**
   * 同步数据资源到服务端
   */
  async syncSource(): Promise<{
    success: boolean
    message: string
    data: {
      syncedCount: number
      failedCount: number
      totalCount: number
      lastSyncTime: string | null
      errors: string[]
    }
  }> {
    const response = await fetch(`${API_BASE}/sync/source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const result = await response.json()
    if (!result.success) {
      throw new Error(result.error || result.message || 'Failed to sync resources')
    }

    return result
  }

  /**
   * 获取扫描任务列表（分页）
   */
  async getScanTasks(page = 1, pageSize = 20): Promise<{
    tasks: ScanTask[]
    total: number
    page: number
    pageSize: number
  }> {
    const searchParams = new URLSearchParams()
    searchParams.set('page', String(page))
    searchParams.set('pageSize', String(pageSize))

    const response = await fetch(`${API_BASE}/scan-tasks?${searchParams}`)
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch scan tasks')
    }

    return result.data
  }

  /**
   * 获取扫描任务详情
   */
  async getScanTaskDetail(taskId: number): Promise<ScanTask> {
    const response = await fetch(`${API_BASE}/scan-tasks/${taskId}`)
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch scan task detail')
    }

    return result.data
  }

  /**
   * 根据 content_sign 打开文件
   * @param contentSign 文件内容签名
   */
  async openFile(contentSign: string): Promise<{ success: boolean; message: string; filePath?: string }> {
    const response = await fetch(`${API_BASE}/files/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contentSign }),
    })
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || result.message || 'Failed to open file')
    }

    return {
      success: result.success,
      message: result.message,
      filePath: result.data?.filePath
    }
  }

  /**
   * 获取归档管理文件列表（本地待归档/已归档文件）
   * @param params 查询参数
   */
  async getArchiveManagementFiles(params: ArchiveManagementQueryParams = {}): Promise<{
    files: ArchiveManagementFileItem[]
    total: number
    page: number
    pageSize: number
  }> {
    const searchParams = new URLSearchParams()

    if (params.search) searchParams.set('search', params.search)
    if (params.archiveType) searchParams.set('archiveType', params.archiveType)
    if (params.importanceLevelFilter !== undefined && params.archiveType === 'pending') {
      searchParams.set('importanceLevelFilter', String(params.importanceLevelFilter))
    }
    searchParams.set('page', String(params.page || 1))
    searchParams.set('pageSize', String(params.pageSize || 50))

    const response = await fetch(`${API_BASE}/archive-management?${searchParams}`)
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch archive files')
    }

    return result.data
  }

  /**
   * 批量设置为无需归档
   * @param ids 文件ID列表
   */
  async batchUpdateToNoArchive(ids: number[]): Promise<{ updatedCount: number }> {
    const response = await fetch(`${API_BASE}/archive-management/no-archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids }),
    })
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.error || result.message || 'Failed to update files')
    }

    return result.data
  }
}

// 扫描任务相关类型定义
export type ScanType = 'FILE' | 'DATABASE'
export type TaskState = 'run' | 'succeed' | 'fail'

export interface ParamsChanged {
  workspacePathChanged: boolean      // 工作空间变更
  scanAreaPathChanged: boolean       // 扫描范围变更
  controlTypeChanged: boolean        // 管控类型变更
}

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
  paramsChanged: ParamsChanged
}

export const api = new ApiService()
