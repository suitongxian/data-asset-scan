import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import PQueue from 'p-queue'
import type { Database as DatabaseType } from 'better-sqlite3'
import { StreamingFileScannerService, WorkspaceStats, ScanResultWithSuffixes } from './StreamingFileScannerService'
import { ScanTaskRepository, UpdateWorkspaceParams } from './ScanTaskRepository'
import { DataDistributingRepository, CreateDataDistributingParams, DataDistributing } from './DataDistributingRepository'
import { DataResourcesRepository, Md5Statistics, CreateDataResourcesParams, DataResources } from './DataResourcesRepository'
import { SystemConfigRepository } from './SystemConfigRepository'
import { FileStatisticsRepository, FileStatistics } from './FileStatisticsRepository'
import { calculateFileHash } from './FileHashUtil'
import { getLogger } from './LoggerService'
import { getLocalIP, getLocalMAC } from './util/NetworkUtil'

const logger = getLogger()

/**
 * 存续状态分类结果
 */
interface SurvivalStatusClassification {
  newFilePaths: string[]              // 新文件路径列表
  normalFileRecords: DataDistributing[]  // 正常文件的完整记录列表（用于检测文件修改）
  deletedRecords: DataDistributing[]  // 删除文件的记录列表
}

/**
 * 扫描模式枚举
 */
export enum ScanMode {
  /** 首次普查 */
  FULL_INVENTORY = 'FULL_INVENTORY',
  /** 日常盘点 */
  DAILY_CHECK = 'DAILY_CHECK',
  /** 定点扫描 */
  TARGETED_SCAN = 'TARGETED_SCAN'
}

export interface AtomicScanOptions {
  directory: string              // 扫描目录
  extensions: string[]           // 文件后缀列表
  excludeDirs?: string[]         // 排除目录列表
  workspace?: string             // 工作空间目录（可选）
  md5Concurrency?: number        // MD5 计算并发数，默认 4
  batchSize?: number             // 批量写入大小，默认 100
  progressInterval?: number      // 进度更新间隔（文件数），默认 50
  scan_mode?: ScanMode           // 扫描模式（可选，默认为普通扫描）
  save_code?: string             // 安全操作码（重新首次普查时需要）
}

export interface ScanResult {
  taskId: number
  totalFiles: number
  scannedFiles: number
  duration: number               // 毫秒
  success: boolean
  errorMessage?: string
  usedExtensions?: string[]      // 本次扫描用到的所有后缀
  workspaceStats?: WorkspaceStats // 工作空间统计信息
  fileStatistics?: FileStatistics // 文件数量统计信息
}

export interface ScanProgressInfo {
  taskId: number
  phase: string
  scannedCount: number
  totalCount: number
  currentFile?: string
}

export type ScanProgressCallback = (progress: ScanProgressInfo) => void

/**
 * 读取文件魔数（前 8 字节的十六进制表示）
 */
async function readFileMagic(filePath: string): Promise<string | null> {
  try {
    const fd = await fs.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(8)
      const { bytesRead } = await fd.read(buffer, 0, 8, 0)
      if (bytesRead > 0) {
        return buffer.subarray(0, bytesRead).toString('hex').toUpperCase()
      }
      return null
    } finally {
      await fd.close()
    }
  } catch {
    return null
  }
}

/**
 * 文件信息接口
 */
interface FileInfo {
  path: string
  hash: string
  size: number
  suffix: string
  magic: string | null
  createTime: string | null
  updateTime: string | null
  readTime: string | null
  isHidden: number
}

/**
 * 原子扫描服务
 * 基于生产者消费者模型，实现高性能文件扫描和数据入库
 */
export class AtomicScanService {
  private db: DatabaseType
  private scanner: StreamingFileScannerService
  private taskRepo: ScanTaskRepository
  private dataRepo: DataDistributingRepository
  private resourceRepo: DataResourcesRepository
  private configRepo: SystemConfigRepository
  private statsRepo: FileStatisticsRepository
  private localIP: string
  private localMAC: string

  constructor(db: DatabaseType, batchSize: number = 100) {
    this.db = db
    this.scanner = new StreamingFileScannerService()
    this.taskRepo = new ScanTaskRepository(db)
    this.dataRepo = new DataDistributingRepository(db, batchSize)
    this.resourceRepo = new DataResourcesRepository(db, batchSize)
    this.configRepo = new SystemConfigRepository(db)
    this.statsRepo = new FileStatisticsRepository(db)
    this.localIP = getLocalIP()
    this.localMAC = getLocalMAC()
  }

  /**
   * 验证扫描模式的前置条件
   * @returns 错误信息，如果验证通过则返回 null
   */
  private validateScanMode(options: AtomicScanOptions): string | null {
    const { scan_mode, save_code, workspace } = options

    if (!scan_mode) {
      return null // 无模式，正常扫描
    }

    switch (scan_mode) {
      case ScanMode.FULL_INVENTORY: {
        logger.info('AtomicScanService', '验证首次普查模式')
        // 检查是否已进行首次普查
        if (this.configRepo.hasFullInventory()) {
          // 重新首次普查，需要验证 save_code
          if (!save_code) {
            logger.warn('AtomicScanService', '重新首次普查需要提供安全操作码')
            return '重新首次普查需要提供安全操作码 save_code'
          }
          if (!this.configRepo.verifySaveCode(save_code)) {
            logger.error('AtomicScanService', '安全操作码验证失败', null, { scan_mode })
            return '安全操作码验证失败'
          }
          logger.info('AtomicScanService', '安全操作码验证通过，准备清空数据重新普查')
        }
        return null
      }

      case ScanMode.DAILY_CHECK: {
        logger.info('AtomicScanService', '验证日常盘点模式')
        // 检查是否已进行首次普查
        if (!this.configRepo.hasFullInventory()) {
          logger.error('AtomicScanService', '日常盘点需要先进行首次普查')
          return '日常盘点需要先进行首次普查'
        }
        return null
      }

      case ScanMode.TARGETED_SCAN: {
        logger.info('AtomicScanService', '验证定点扫描模式', { workspace })
        // 定点扫描必须提供 workspace
        if (!workspace) {
          logger.error('AtomicScanService', '定点扫描需要指定 workspace 目录')
          return '定点扫描需要指定 workspace 目录'
        }
        return null
      }

      default:
        logger.error('AtomicScanService', '未知的扫描模式', null, { scan_mode })
        return `未知的扫描模式: ${scan_mode}`
    }
  }

  /**
   * 执行扫描模式的前置操作
   */
  private executeScanModePreActions(options: AtomicScanOptions): void {
    const { scan_mode } = options

    if (!scan_mode) {
      return
    }

    switch (scan_mode) {
      case ScanMode.FULL_INVENTORY: {
        // 如果已进行首次普查，需要清空数据表
        if (this.configRepo.hasFullInventory()) {
          logger.warn('AtomicScanService', '重新首次普查：清空 data_distributing 和 data_resources 表')
          this.dataRepo.truncate()
          this.resourceRepo.truncate()
        }
        break
      }

      case ScanMode.DAILY_CHECK:
      case ScanMode.TARGETED_SCAN:
        // 无前置操作
        break
    }
  }

  /**
   * 执行扫描模式的后置操作
   */
  private executeScanModePostActions(options: AtomicScanOptions, scanStartTime: string): void {
    const { scan_mode } = options

    if (!scan_mode) {
      return
    }

    switch (scan_mode) {
      case ScanMode.FULL_INVENTORY: {
        // 设置首次普查时间
        this.configRepo.setFullInventoryTime(new Date().toISOString())
        logger.info('AtomicScanService', '首次普查完成，已设置 FULL_INVENTORY_TIME')
        break
      }

      case ScanMode.DAILY_CHECK: {
        // 日常盘点模式：存续状态已在 performSurvivalStatusScan 中处理
        // 不再使用 disable=1 逻辑删除，而是通过 scan_found_count=0 标记删除
        logger.info('AtomicScanService', '日常盘点完成')
        break
      }

      case ScanMode.TARGETED_SCAN: {
        // 定点扫描：存续状态已在 performSurvivalStatusScan 中处理
        // 不再使用 disable=1 逻辑删除，而是通过 scan_found_count=0 标记删除
        logger.info('AtomicScanService', '定点扫描完成')
        break
      }
    }
  }

  /**
   * 获取实际的扫描目录
   * 针对定点扫描模式，只扫描 workspace 目录
   */
  private getEffectiveScanDirectory(options: AtomicScanOptions): string {
    if (options.scan_mode === ScanMode.TARGETED_SCAN && options.workspace) {
      return options.workspace
    }
    return options.directory
  }

  /**
   * 获取实际的 workspace 参数
   * 针对定点扫描模式，workspace 既是扫描目录也用于收集所有文件后缀
   * 这样可以确保定点扫描会扫描 workspace 目录中的所有文件
   */
  private getEffectiveWorkspace(options: AtomicScanOptions): string | undefined {
    // 定点扫描模式：workspace 用于收集后缀，确保扫描所有文件
    // 虽然 effectiveDirectory 已经是 workspace，但仍需传递 workspace 参数
    // 以触发后缀收集逻辑，这样才能扫描 workspace 中所有类型的文件
    return options.workspace
  }

  /**
   * 执行扫描任务
   */
  async scan(
    options: AtomicScanOptions,
    onProgress?: ScanProgressCallback
  ): Promise<ScanResult> {
    const {
      extensions,
      excludeDirs = [],
      md5Concurrency = 4,
      batchSize = 100,
      progressInterval = 50,
      scan_mode
    } = options

    const startTime = Date.now()
    const scanStartTime = new Date().toISOString()

    // 获取实际的扫描目录和工作空间
    const effectiveDirectory = this.getEffectiveScanDirectory(options)
    const effectiveWorkspace = this.getEffectiveWorkspace(options)

    logger.info('AtomicScanService', '开始扫描任务', {
      scan_mode,
      effectiveDirectory,
      effectiveWorkspace,
      extensions,
      excludeDirs
    })

    // 验证扫描模式的前置条件
    const validationError = this.validateScanMode(options)
    if (validationError) {
      logger.error('AtomicScanService', '扫描模式验证失败', null, { validationError })
      const taskId = this.taskRepo.create({
        scan_type: 'FILE',
        file_scan_range: effectiveDirectory,
        workspace_path: options.workspace,
        scan_args: JSON.stringify({ extensions, excludeDirs, workspace: options.workspace, scan_mode })
      })
      this.taskRepo.markFailed(taskId, validationError)
      return {
        taskId,
        totalFiles: 0,
        scannedFiles: 0,
        duration: Date.now() - startTime,
        success: false,
        errorMessage: validationError
      }
    }

    // 检查目录是否存在（全盘扫描时跳过）
    if (effectiveDirectory !== '/' && effectiveDirectory !== '\\') {
      try {
        const stat = await fs.stat(effectiveDirectory)
        if (!stat.isDirectory()) {
          throw new Error(`Path is not a directory: ${effectiveDirectory}`)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error('AtomicScanService', '扫描目录验证失败', error, { effectiveDirectory })
        const taskId = this.taskRepo.create({
          scan_type: 'FILE',
          file_scan_range: effectiveDirectory,
          workspace_path: options.workspace,
          scan_args: JSON.stringify({ extensions, excludeDirs, workspace: options.workspace, scan_mode })
        })
        this.taskRepo.markFailed(taskId, errorMessage)
        return {
          taskId,
          totalFiles: 0,
          scannedFiles: 0,
          duration: Date.now() - startTime,
          success: false,
          errorMessage
        }
      }
    }

    // 检查 workspace 目录是否存在
    if (effectiveWorkspace) {
      try {
        const stat = await fs.stat(effectiveWorkspace)
        if (!stat.isDirectory()) {
          throw new Error(`Workspace is not a directory: ${effectiveWorkspace}`)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error('AtomicScanService', '工作空间目录验证失败', error, { effectiveWorkspace })
        const taskId = this.taskRepo.create({
          scan_type: 'FILE',
          file_scan_range: effectiveDirectory,
          workspace_path: options.workspace,
          scan_args: JSON.stringify({ extensions, excludeDirs, workspace: options.workspace, scan_mode })
        })
        this.taskRepo.markFailed(taskId, errorMessage)
        return {
          taskId,
          totalFiles: 0,
          scannedFiles: 0,
          duration: Date.now() - startTime,
          success: false,
          errorMessage
        }
      }
    }

    // 执行扫描模式的前置操作
    this.executeScanModePreActions(options)

    // 1. 创建扫描任务
    const taskId = this.taskRepo.create({
      scan_type: 'FILE',
      file_scan_range: effectiveDirectory,
      workspace_path: options.workspace,
      scan_args: JSON.stringify({ extensions, excludeDirs, workspace: options.workspace, scan_mode })
    })
    logger.info('AtomicScanService', '扫描任务已创建', { taskId })

    try {
      // 2. 统计文件总数（包括 workspace 后缀合并）
      this.notifyProgress(onProgress, {
        taskId,
        phase: 'counting',
        scannedCount: 0,
        totalCount: 0
      })

      const countResult = await this.scanner.countFilesWithExtensions({
        directory: effectiveDirectory,
        extensions,
        excludeDirs,
        workspace: effectiveWorkspace
      })

      const totalFiles = countResult.count
      const usedExtensions = countResult.usedExtensions
      const workspaceStats = countResult.workspaceStats
      logger.info('AtomicScanService', '文件统计完成', { totalFiles, usedExtensions })

      // 更新工作空间相关信息
      if (workspaceStats) {
        this.taskRepo.updateWorkspaceInfo(taskId, {
          workspace_path: options.workspace,
          file_all_suffix_count: usedExtensions.length,
          file_count_suffix_count: workspaceStats.workspaceSuffixes.length,
          workspace_count: workspaceStats.workspaceFileCount
        })
      } else if (options.workspace) {
        // workspace 存在但可能在 directory 范围内，或者是定点扫描模式
        this.taskRepo.updateWorkspaceInfo(taskId, {
          workspace_path: options.workspace,
          file_all_suffix_count: usedExtensions.length
        })
      }

      this.taskRepo.updateFileTotal(taskId, totalFiles)
      this.taskRepo.updateProgress(taskId, {
        heartbeat: 1,
        file_scanned_count: 0,
        task_phase: 'scanning'
      })

      this.notifyProgress(onProgress, {
        taskId,
        phase: 'scanning',
        scannedCount: 0,
        totalCount: totalFiles
      })

      if (totalFiles === 0) {
        logger.warn('AtomicScanService', '未找到匹配的文件')
        // 如果是日常盘点模式，即使没有新文件也需要处理删除文件
        if (this.shouldPerformSurvivalStatusCheck(scan_mode)) {
          const existingRecords = this.dataRepo.getActiveByPathMap()
          if (existingRecords.size > 0) {
            // 所有现有记录都是删除文件
            const deletedIds = Array.from(existingRecords.values()).map(r => r.data_distribution_id!)
            this.dataRepo.batchMarkAsDeleted(deletedIds)
            logger.info('AtomicScanService', '标记所有记录为已删除', { deletedCount: deletedIds.length })

            // 更新 data_resources
            const isFileFromWorkspace = (filePath: string): boolean => {
              if (!effectiveWorkspace) return false
              return StreamingFileScannerService.isPathWithin(filePath, effectiveWorkspace)
            }
            const deletedUpdates: Array<{ contentSign: string; isFromWorkspace: boolean }> = []
            for (const record of existingRecords.values()) {
              deletedUpdates.push({
                contentSign: record.content_sign,
                isFromWorkspace: isFileFromWorkspace(record.path)
              })
            }
            this.resourceRepo.batchUpdateForDeletedFiles(deletedUpdates)
          }
        }

        // 执行扫描模式的后置操作
        this.executeScanModePostActions(options, scanStartTime)
        this.taskRepo.markSucceeded(taskId)

        // 执行文件数量统计
        const fileStatistics = this.statsRepo.executeAndSave(
          taskId,
          this.configRepo.getWorkspace(),
          this.configRepo.getFullInventoryTime()
        )

        logger.info('AtomicScanService', '扫描完成（无文件）', { taskId, duration: Date.now() - startTime })
        return {
          taskId,
          totalFiles: 0,
          scannedFiles: 0,
          duration: Date.now() - startTime,
          success: true,
          usedExtensions,
          workspaceStats,
          fileStatistics
        }
      }

      // 判断是否使用存续状态扫描
      if (this.shouldPerformSurvivalStatusCheck(scan_mode)) {
        logger.info('AtomicScanService', '执行存续状态扫描', { scan_mode })
        // 日常盘点模式：使用存续状态比对逻辑
        const survivalResult = await this.performSurvivalStatusScan(
          options,
          taskId,
          effectiveDirectory,
          effectiveWorkspace,
          usedExtensions,
          workspaceStats,
          totalFiles,
          onProgress
        )

        // 执行扫描模式的后置操作
        this.executeScanModePostActions(options, scanStartTime)

        // 更新任务状态为成功
        this.taskRepo.updateProgress(taskId, {
          heartbeat: 999,
          file_scanned_count: survivalResult.scannedCount,
          task_phase: 'completed'
        })
        this.taskRepo.markSucceeded(taskId)

        this.notifyProgress(onProgress, {
          taskId,
          phase: 'completed',
          scannedCount: survivalResult.scannedCount,
          totalCount: totalFiles
        })

        // 执行文件数量统计
        const fileStatistics = this.statsRepo.executeAndSave(
          taskId,
          this.configRepo.getWorkspace(),
          this.configRepo.getFullInventoryTime()
        )

        logger.info('AtomicScanService', '扫描完成（存续状态）', {
          taskId,
          scannedFiles: survivalResult.scannedCount,
          totalFiles,
          duration: Date.now() - startTime
        })
        return {
          taskId,
          totalFiles,
          scannedFiles: survivalResult.scannedCount,
          duration: Date.now() - startTime,
          success: true,
          usedExtensions,
          workspaceStats,
          fileStatistics
        }
      }

      // 首次普查或无模式：使用原有的直接插入逻辑
      // 3. 创建 MD5 计算队列（生产者消费者模型核心）
      const md5Queue = new PQueue({ concurrency: md5Concurrency })
      const scanTime = new Date().toISOString()

      let scannedCount = 0
      let heartbeat = 1
      let pendingWrites: CreateDataDistributingParams[] = []

      // MD5 统计信息收集（内存中进行）
      const md5StatsMap = new Map<string, Md5Statistics>()

      // 判断文件是否来自 workspace
      const isFileFromWorkspace = (filePath: string): boolean => {
        if (!effectiveWorkspace) return false
        return StreamingFileScannerService.isPathWithin(filePath, effectiveWorkspace)
      }

      // 处理单个文件的函数
      const processFile = async (filePath: string): Promise<void> => {
        try {
          // 计算文件信息
          const fileInfo = await this.getFileInfo(filePath)

          // 构建数据记录
          const record: CreateDataDistributingParams = {
            scan_task_id: taskId,
            path: fileInfo.path,
            data_type: 1,
            content_sign: fileInfo.hash,
            file_suffix: fileInfo.suffix,
            file_magic: fileInfo.magic || undefined,
            file_create_time: fileInfo.createTime || undefined,
            file_update_time: fileInfo.updateTime || undefined,
            file_read_time: fileInfo.readTime || undefined,
            file_size: fileInfo.size,
            file_hide: fileInfo.isHidden,
            ip: this.localIP,
            mac_address: this.localMAC,
            scan_time: scanTime
          }

          // 添加到待写入列表
          pendingWrites.push(record)

          // 更新 MD5 统计信息
          const existingStats = md5StatsMap.get(fileInfo.hash)
          const isFromWorkspace = isFileFromWorkspace(filePath)
          const fileCreateTime = fileInfo.createTime || scanTime
          const fileName = path.basename(filePath)

          if (existingStats) {
            // 已存在该 MD5，更新统计
            existingStats.sourceCount++
            if (isFromWorkspace) {
              existingStats.workspaceSourceCount++
            }
            // 更新最早创建时间和对应的文件名
            if (fileCreateTime < existingStats.firstCreateTime) {
              existingStats.firstCreateTime = fileCreateTime
              existingStats.firstFileName = fileName
            }
            // 更新最短文件名
            if (!existingStats.shortFileName || fileName.length < existingStats.shortFileName.length) {
              existingStats.shortFileName = fileName
            }
          } else {
            // 新的 MD5，创建统计记录
            md5StatsMap.set(fileInfo.hash, {
              contentSign: fileInfo.hash,
              sourceCount: 1,
              workspaceSourceCount: isFromWorkspace ? 1 : 0,
              firstCreateTime: fileCreateTime,
              fileMagic: fileInfo.magic || undefined,
              firstFileName: fileName,
              shortFileName: fileName
            })
          }

          // 达到批量大小时写入数据库
          if (pendingWrites.length >= batchSize) {
            this.dataRepo.insertBatch(pendingWrites)
            pendingWrites = []
          }

          scannedCount++

          // 定期更新进度
          if (scannedCount % progressInterval === 0) {
            heartbeat++
            this.taskRepo.updateProgress(taskId, {
              heartbeat,
              file_scanned_count: scannedCount,
              task_phase: 'scanning'
            })

            this.notifyProgress(onProgress, {
              taskId,
              phase: 'scanning',
              scannedCount,
              totalCount: totalFiles,
              currentFile: filePath
            })
          }
        } catch (error) {
          // 单个文件处理失败不影响整体流程
          logger.error('AtomicScanService', '文件处理失败', error, { filePath })
        }
      }

      // 4. 流式扫描并并发处理
      await this.scanner.scanWithCallback(
        { directory: effectiveDirectory, extensions, excludeDirs, workspace: effectiveWorkspace },
        async (filePath) => {
          // 将文件处理任务加入队列
          await md5Queue.add(() => processFile(filePath))
        }
      )

      // 等待所有 MD5 计算完成
      await md5Queue.onIdle()

      // 5. 写入剩余数据
      if (pendingWrites.length > 0) {
        this.dataRepo.insertBatch(pendingWrites)
      }

      // 6. 批量写入 MD5 统计到 data_resources 表
      heartbeat++
      this.taskRepo.updateProgress(taskId, {
        heartbeat,
        file_scanned_count: scannedCount,
        task_phase: 'aggregating'
      })

      this.notifyProgress(onProgress, {
        taskId,
        phase: 'aggregating',
        scannedCount,
        totalCount: totalFiles
      })

      const resourceCount = this.resourceRepo.insertFromStatistics(md5StatsMap)
      logger.info('AtomicScanService', 'MD5 资源统计完成', { resourceCount })

      // 7. 执行扫描模式的后置操作
      this.executeScanModePostActions(options, scanStartTime)

      // 8. 更新任务状态为成功
      heartbeat++
      this.taskRepo.updateProgress(taskId, {
        heartbeat,
        file_scanned_count: scannedCount,
        task_phase: 'completed'
      })
      this.taskRepo.markSucceeded(taskId)

      this.notifyProgress(onProgress, {
        taskId,
        phase: 'completed',
        scannedCount,
        totalCount: totalFiles
      })

      // 执行文件数量统计
      const fileStatistics = this.statsRepo.executeAndSave(
        taskId,
        this.configRepo.getWorkspace(),
        this.configRepo.getFullInventoryTime()
      )

      logger.info('AtomicScanService', '扫描完成（首次普查/普通扫描）', {
        taskId,
        totalFiles,
        scannedFiles: scannedCount,
        duration: Date.now() - startTime
      })
      return {
        taskId,
        totalFiles,
        scannedFiles: scannedCount,
        duration: Date.now() - startTime,
        success: true,
        usedExtensions,
        workspaceStats,
        fileStatistics
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('AtomicScanService', '扫描任务执行失败', error, { taskId, errorMessage })
      this.taskRepo.markFailed(taskId, errorMessage)

      return {
        taskId,
        totalFiles: 0,
        scannedFiles: 0,
        duration: Date.now() - startTime,
        success: false,
        errorMessage
      }
    }
  }

  /**
   * 获取文件详细信息
   */
  private async getFileInfo(filePath: string): Promise<FileInfo> {
    // 并行获取文件信息
    const [hashResult, stat, magic] = await Promise.all([
      calculateFileHash(filePath),
      fs.stat(filePath),
      readFileMagic(filePath)
    ])

    const suffix = path.extname(filePath).toLowerCase()
    const fileName = path.basename(filePath)
    const isHidden = fileName.startsWith('.') ? 1 : 0

    return {
      path: filePath,
      hash: hashResult.hash,
      size: hashResult.size,
      suffix,
      magic,
      createTime: stat.birthtime ? stat.birthtime.toISOString() : null,
      updateTime: stat.mtime ? stat.mtime.toISOString() : null,
      readTime: stat.atime ? stat.atime.toISOString() : null,
      isHidden
    }
  }

  /**
   * 通知进度更新
   */
  private notifyProgress(
    callback: ScanProgressCallback | undefined,
    progress: ScanProgressInfo
  ): void {
    if (callback) {
      try {
        callback(progress)
      } catch (error) {
        logger.error('AtomicScanService', '进度回调失败', error, { progress })
      }
    }
  }

  /**
   * 判断是否需要执行存续状态比对
   */
  private shouldPerformSurvivalStatusCheck(scanMode?: ScanMode): boolean {
    // 日常盘点和定点扫描模式需要存续状态比对
    return scanMode === ScanMode.DAILY_CHECK || scanMode === ScanMode.TARGETED_SCAN
  }

  /**
   * 收集所有扫描文件路径到 Set（不计算哈希）
   */
  private async collectFilePaths(
    effectiveDirectory: string,
    extensions: string[],
    excludeDirs: string[],
    effectiveWorkspace?: string
  ): Promise<Set<string>> {
    const filePaths = new Set<string>()

    await this.scanner.scanWithCallback(
      { directory: effectiveDirectory, extensions, excludeDirs, workspace: effectiveWorkspace },
      (filePath) => {
        filePaths.add(filePath)
      }
    )

    return filePaths
  }

  /**
   * 分类文件存续状态
   * @param scannedPaths 新扫描到的文件路径集合
   * @param existingRecords 现有的数据分布记录 Map
   */
  private classifySurvivalStatus(
    scannedPaths: Set<string>,
    existingRecords: Map<string, DataDistributing>
  ): SurvivalStatusClassification {
    const newFilePaths: string[] = []
    const normalFileRecords: DataDistributing[] = []
    const deletedRecords: DataDistributing[] = []

    // 遍历扫描到的文件路径
    for (const filePath of scannedPaths) {
      const existing = existingRecords.get(filePath)
      if (existing) {
        // 正常文件：之前有，现在也有（保存完整记录用于后续检测文件修改）
        normalFileRecords.push(existing)
      } else {
        // 新文件：之前没有，现在有
        newFilePaths.push(filePath)
      }
    }

    // 遍历现有记录，找出删除文件
    for (const [path, record] of existingRecords) {
      if (!scannedPaths.has(path)) {
        // 删除文件：之前有，现在没有
        deletedRecords.push(record)
      }
    }

    return { newFilePaths, normalFileRecords, deletedRecords }
  }

  /**
   * 执行存续状态扫描
   * 用于日常盘点和定点扫描模式，在内存中比对新旧文件状态
   * 区别：日常盘点比对所有记录，定点扫描只比对 workspace 范围内的记录
   */
  private async performSurvivalStatusScan(
    options: AtomicScanOptions,
    taskId: number,
    effectiveDirectory: string,
    effectiveWorkspace: string | undefined,
    usedExtensions: string[],
    workspaceStats: WorkspaceStats | undefined,
    totalFiles: number,
    onProgress?: ScanProgressCallback
  ): Promise<{ scannedCount: number }> {
    const {
      extensions,
      excludeDirs = [],
      md5Concurrency = 4,
      batchSize = 100,
      progressInterval = 50,
      scan_mode
    } = options

    const scanTime = new Date().toISOString()
    let scannedCount = 0
    let heartbeat = 1

    // 判断文件是否来自 workspace
    const isFileFromWorkspace = (filePath: string): boolean => {
      if (!effectiveWorkspace) return false
      return StreamingFileScannerService.isPathWithin(filePath, effectiveWorkspace)
    }

    // 1. 收集所有扫描文件路径到内存
    this.notifyProgress(onProgress, {
      taskId,
      phase: 'collecting',
      scannedCount: 0,
      totalCount: totalFiles
    })

    const scannedPaths = await this.collectFilePaths(
      effectiveDirectory,
      usedExtensions,
      excludeDirs,
      effectiveWorkspace
    )

    // 2. 加载现有记录到内存
    // 日常盘点：加载所有记录
    // 定点扫描：只加载 workspace 范围内的记录
    this.notifyProgress(onProgress, {
      taskId,
      phase: 'loading_existing',
      scannedCount: 0,
      totalCount: totalFiles
    })

    let existingRecords: Map<string, DataDistributing>
    if (scan_mode === ScanMode.TARGETED_SCAN && effectiveWorkspace) {
      // 定点扫描：只加载 workspace 目录内的记录
      existingRecords = this.dataRepo.getActiveByPathMapWithPrefix(effectiveWorkspace)
    } else {
      // 日常盘点：加载所有记录
      existingRecords = this.dataRepo.getActiveByPathMap()
    }
    const existingResources = this.resourceRepo.getActiveByContentSignMap()

    // 3. 分类存续状态
    this.notifyProgress(onProgress, {
      taskId,
      phase: 'classifying',
      scannedCount: 0,
      totalCount: totalFiles
    })

    const classification = this.classifySurvivalStatus(scannedPaths, existingRecords)

    logger.info('AtomicScanService', '存续状态分类', {
      newFiles: classification.newFilePaths.length,
      normalFiles: classification.normalFileRecords.length,
      deletedFiles: classification.deletedRecords.length
    })

    // 4. 处理正常文件：检测文件是否被修改，更新 scan_found_count
    if (classification.normalFileRecords.length > 0) {
      this.notifyProgress(onProgress, {
        taskId,
        phase: 'checking_modifications',
        scannedCount: 0,
        totalCount: totalFiles
      })

      const md5QueueNormal = new PQueue({ concurrency: md5Concurrency })

      // 未修改的文件 ID 列表（只需增加 scan_found_count）
      const unmodifiedFileIds: number[] = []
      // 已修改的文件更新信息
      const modifiedFileUpdates: Array<{
        dataDistributionId: number
        contentSign: string
        fileUpdateTime: string | null
        fileReadTime: string | null
        fileSize: number
        fileMagic: string | null
      }> = []
      // 用于更新 data_resources 的修改文件信息
      const modifiedResourceUpdates: Array<{
        oldContentSign: string
        newContentSign: string
        isFromWorkspace: boolean
        fileCreateTime: string
        fileMagic: string | null
        fileName: string
      }> = []

      const checkNormalFile = async (record: DataDistributing): Promise<void> => {
        try {
          // 获取文件当前的 stat 信息
          const stat = await fs.stat(record.path)
          const currentUpdateTime = stat.mtime ? stat.mtime.toISOString() : null

          // 比较修改时间
          if (record.file_update_time === currentUpdateTime) {
            // 修改时间相同，文件未修改
            unmodifiedFileIds.push(record.data_distribution_id!)
          } else {
            // 修改时间不同，需要重新计算哈希
            const fileInfo = await this.getFileInfo(record.path)

            if (fileInfo.hash !== record.content_sign) {
              // 哈希值也变了，文件确实被修改
              modifiedFileUpdates.push({
                dataDistributionId: record.data_distribution_id!,
                contentSign: fileInfo.hash,
                fileUpdateTime: fileInfo.updateTime,
                fileReadTime: fileInfo.readTime,
                fileSize: fileInfo.size,
                fileMagic: fileInfo.magic
              })
              modifiedResourceUpdates.push({
                oldContentSign: record.content_sign,
                newContentSign: fileInfo.hash,
                isFromWorkspace: isFileFromWorkspace(record.path),
                fileCreateTime: record.file_create_time || scanTime,
                fileMagic: fileInfo.magic,
                fileName: path.basename(record.path)
              })
              logger.info('AtomicScanService', '检测到文件修改', {
                path: record.path,
                oldHash: record.content_sign,
                newHash: fileInfo.hash
              })
            } else {
              // 哈希值没变（可能只是访问时间变了），视为未修改
              unmodifiedFileIds.push(record.data_distribution_id!)
            }
          }
        } catch (error) {
          // 文件访问失败，仍增加 scan_found_count
          logger.error('AtomicScanService', '检测正常文件失败', error, { path: record.path })
          unmodifiedFileIds.push(record.data_distribution_id!)
        }
      }

      // 并发检测所有正常文件
      for (const record of classification.normalFileRecords) {
        md5QueueNormal.add(() => checkNormalFile(record))
      }

      await md5QueueNormal.onIdle()

      // 批量更新未修改的文件（增加 scan_found_count）
      if (unmodifiedFileIds.length > 0) {
        this.dataRepo.batchIncrementScanFoundCount(unmodifiedFileIds)
      }

      // 批量更新已修改的文件
      if (modifiedFileUpdates.length > 0) {
        this.dataRepo.batchUpdateModifiedFiles(modifiedFileUpdates)
        // 更新 data_resources 表
        this.resourceRepo.batchUpdateForModifiedFiles(modifiedResourceUpdates, existingResources)
        logger.info('AtomicScanService', '已更新修改文件', { count: modifiedFileUpdates.length })
      }

      scannedCount += classification.normalFileRecords.length

      heartbeat++
      this.taskRepo.updateProgress(taskId, {
        heartbeat,
        file_scanned_count: scannedCount,
        task_phase: 'processing_normal'
      })
    }

    // 5. 处理删除文件：scan_found_count = 0，更新 data_resources
    if (classification.deletedRecords.length > 0) {
      this.notifyProgress(onProgress, {
        taskId,
        phase: 'marking_deleted',
        scannedCount,
        totalCount: totalFiles
      })

      const deletedIds = classification.deletedRecords.map(r => r.data_distribution_id!)
      this.dataRepo.batchMarkAsDeleted(deletedIds)

      // 更新 data_resources 的 source_count 和 workspace_source_count
      const deletedUpdates: Array<{ contentSign: string; isFromWorkspace: boolean }> = []
      for (const record of classification.deletedRecords) {
        deletedUpdates.push({
          contentSign: record.content_sign,
          isFromWorkspace: isFileFromWorkspace(record.path)
        })
      }
      this.resourceRepo.batchUpdateForDeletedFiles(deletedUpdates)

      heartbeat++
      this.taskRepo.updateProgress(taskId, {
        heartbeat,
        file_scanned_count: scannedCount,
        task_phase: 'processing_deleted'
      })
    }

    // 6. 处理新文件：计算哈希，插入 data_distributing，更新/新增 data_resources
    if (classification.newFilePaths.length > 0) {
      this.notifyProgress(onProgress, {
        taskId,
        phase: 'processing_new',
        scannedCount,
        totalCount: totalFiles
      })

      const md5Queue = new PQueue({ concurrency: md5Concurrency })
      let pendingWrites: CreateDataDistributingParams[] = []

      // MD5 统计信息收集（新文件的）
      const newMd5StatsMap = new Map<string, Md5Statistics>()

      const processNewFile = async (filePath: string): Promise<void> => {
        try {
          const fileInfo = await this.getFileInfo(filePath)

          // 构建数据记录
          const record: CreateDataDistributingParams = {
            scan_task_id: taskId,
            path: fileInfo.path,
            data_type: 1,
            content_sign: fileInfo.hash,
            file_suffix: fileInfo.suffix,
            file_magic: fileInfo.magic || undefined,
            file_create_time: fileInfo.createTime || undefined,
            file_update_time: fileInfo.updateTime || undefined,
            file_read_time: fileInfo.readTime || undefined,
            file_size: fileInfo.size,
            file_hide: fileInfo.isHidden,
            ip: this.localIP,
            mac_address: this.localMAC,
            scan_time: scanTime
          }

          pendingWrites.push(record)

          // 更新新文件的 MD5 统计
          const isFromWorkspace = isFileFromWorkspace(filePath)
          const fileCreateTime = fileInfo.createTime || scanTime
          const fileName = path.basename(filePath)

          // 检查是否已有该 MD5 的资源记录
          const existingResource = existingResources.get(fileInfo.hash)
          const existingNewStats = newMd5StatsMap.get(fileInfo.hash)

          if (existingNewStats) {
            existingNewStats.sourceCount++
            if (isFromWorkspace) {
              existingNewStats.workspaceSourceCount++
            }
            // 更新最早创建时间和对应的文件名
            if (fileCreateTime < existingNewStats.firstCreateTime) {
              existingNewStats.firstCreateTime = fileCreateTime
              existingNewStats.firstFileName = fileName
            }
            // 更新最短文件名
            if (!existingNewStats.shortFileName || fileName.length < existingNewStats.shortFileName.length) {
              existingNewStats.shortFileName = fileName
            }
          } else {
            // 如果有已存在的资源记录，使用其 first_create_time 和 resources_name
            const useExistingResource = existingResource && existingResource.first_create_time <= fileCreateTime
            newMd5StatsMap.set(fileInfo.hash, {
              contentSign: fileInfo.hash,
              sourceCount: 1,
              workspaceSourceCount: isFromWorkspace ? 1 : 0,
              firstCreateTime: useExistingResource ? existingResource.first_create_time : fileCreateTime,
              fileMagic: fileInfo.magic || undefined,
              firstFileName: useExistingResource ? existingResource.resources_name : fileName,
              shortFileName: useExistingResource ? existingResource.resources_name : fileName
            })
          }

          // 批量写入
          if (pendingWrites.length >= batchSize) {
            this.dataRepo.insertBatch(pendingWrites)
            pendingWrites = []
          }

          scannedCount++

          if (scannedCount % progressInterval === 0) {
            heartbeat++
            this.taskRepo.updateProgress(taskId, {
              heartbeat,
              file_scanned_count: scannedCount,
              task_phase: 'processing_new'
            })

            this.notifyProgress(onProgress, {
              taskId,
              phase: 'processing_new',
              scannedCount,
              totalCount: totalFiles,
              currentFile: filePath
            })
          }
        } catch (error) {
          logger.error('AtomicScanService', '新文件处理失败', error, { filePath })
        }
      }

      // 并发处理新文件
      for (const filePath of classification.newFilePaths) {
        md5Queue.add(() => processNewFile(filePath))
      }

      await md5Queue.onIdle()

      // 写入剩余数据
      if (pendingWrites.length > 0) {
        this.dataRepo.insertBatch(pendingWrites)
      }

      // 更新 data_resources 表
      for (const [contentSign, stats] of newMd5StatsMap) {
        const existingResource = existingResources.get(contentSign)
        if (existingResource) {
          // 已有记录，增加计数
          this.resourceRepo.incrementSourceCount(contentSign, stats.sourceCount)
          if (stats.workspaceSourceCount > 0) {
            // 也需要增加 workspace_source_count
            const now = new Date().toISOString()
            this.db.prepare(`
              UPDATE data_resources
              SET workspace_source_count = workspace_source_count + ?, update_time = ?
              WHERE content_sign = ? AND disable = 0
            `).run(stats.workspaceSourceCount, now, contentSign)
          }
        } else {
          // 新记录：从文件名中提取后缀作为 content_type
          let contentType: string | undefined
          if (stats.shortFileName) {
            const lastDotIndex = stats.shortFileName.lastIndexOf('.')
            if (lastDotIndex > 0 && lastDotIndex < stats.shortFileName.length - 1) {
              contentType = stats.shortFileName.substring(lastDotIndex + 1).toLowerCase()
            }
          }
          this.resourceRepo.insertBatch([{
            content_sign: stats.contentSign,
            source_count: stats.sourceCount,
            workspace_source_count: stats.workspaceSourceCount,
            first_create_time: stats.firstCreateTime,
            file_magic: stats.fileMagic,
            resources_name: stats.shortFileName,
            content_subject: 'file',
            content_type: contentType
          }])
        }
      }
    }

    return { scannedCount }
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId: number) {
    return this.taskRepo.getById(taskId)
  }
}
