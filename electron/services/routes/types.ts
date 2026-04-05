import {AtomicScanService} from "../AtomicScanService";
import {SystemConfigRepository} from "../SystemConfigRepository";
import {DataResourcesRepository} from "../DataResourcesRepository";

/**
 * 扫描服务上下文接口
 * 用于从 HttpScanService 传递必要的依赖和状态
 */
export interface ScanContext {
  atomicScanner: AtomicScanService | null
  configRepo: SystemConfigRepository | null
  dataResourcesRepo: DataResourcesRepository | null
  isScanning: boolean
  currentTaskId: number | null
  setScanning: (isScanning: boolean) => void
  setCurrentTaskId: (taskId: number | null) => void
  performSync: () => Promise<{
    success: boolean
    syncedCount: number
    failedCount: number
    totalCount: number
    message?: string
  }>
}
