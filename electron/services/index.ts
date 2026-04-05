export { FileScannerService } from './FileScannerService'
export type { ScanResult, ScanOptions } from './FileScannerService'
export { HttpScanService } from './HttpScanService'
export type { HttpServiceOptions } from './HttpScanService'

export { FileOpenerService } from './FileOpenerService'
export type { OpenFileResult } from './FileOpenerService'

// 新增的扫描原子服务
export { AtomicScanService, ScanMode } from './AtomicScanService'
export type { AtomicScanOptions, ScanResult as AtomicScanResult, ScanProgressInfo, ScanProgressCallback } from './AtomicScanService'

export { StreamingFileScannerService } from './StreamingFileScannerService'
export type { StreamingScanOptions, ScanProgress, FileCallback, BatchCallback, ProgressCallback } from './StreamingFileScannerService'

export { ScanTaskRepository } from './ScanTaskRepository'
export type { ScanTask, CreateScanTaskParams, UpdateProgressParams, ScanType, TaskState } from './ScanTaskRepository'

export { DataDistributingRepository } from './DataDistributingRepository'
export type { DataDistributing, CreateDataDistributingParams, DataType } from './DataDistributingRepository'

export { DataResourcesRepository } from './DataResourcesRepository'
export type { DataResources, CreateDataResourcesParams, Md5Statistics } from './DataResourcesRepository'

export { SystemConfigRepository } from './SystemConfigRepository'
export type { SystemConfig } from './SystemConfigRepository'

export { UserInfoRepository } from './UserInfoRepository'
export type { UserInfo, CreateUserInfoParams, UpdateUserInfoParams } from './UserInfoRepository'

export { FileStatisticsRepository } from './FileStatisticsRepository'
export type { FileStatistics, FileStatisticsResult, StatisticsGrowth, FileStatisticsComparison } from './FileStatisticsRepository'

export { calculateFileHash, calculateFileHashSync } from './FileHashUtil'
export type { FileHashResult } from './FileHashUtil'

export { LoggerService, createLogger, getLogger, resetLogger } from './LoggerService'
export type { LogLevel, LoggerServiceOptions } from './LoggerService'

export { ConfigService } from './ConfigService'
export type { AppConfig, ConfigServiceOptions } from './ConfigService'

export { WorkspaceService } from './WorkspaceService'
export type { WorkspaceInitResult, WorkspaceServiceOptions, WorkspaceSubdirectory } from './WorkspaceService'

export { ResourceClassifyService } from './ResourceClassifyService'
export type { ClassifyParams, ClassifyResult } from './ResourceClassifyService'
