import {Router, Request, Response} from 'express';
import * as os from 'node:os';
import {AtomicScanService, ScanProgressInfo, ScanMode} from "../AtomicScanService";
import {SystemConfigRepository} from "../SystemConfigRepository";
import {DataResourcesRepository} from "../DataResourcesRepository";
import {getLogger} from "../LoggerService";
import {ScanContext} from "./types";

const logger = getLogger()

/**
 * SSE 流式扫描进度事件
 */
interface ScanProgressEvent {
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

/**
 * 扫描相关路由
 * 处理 /scan/atomic 和 /scan/status 路径
 */
export function ScanRoutes(scanContext: ScanContext): Router {

  const router = Router();

  router.get('/atomic', handleAtomicScan)
  router.get('/status', handleScanStatus)

  /**
   * 处理原子扫描请求（SSE + 数据入库）
   * GET /scan/atomic?scan_mode=FULL_INVENTORY
   * 扫描参数从 SystemConfigRepository 获取（数据库优先，其次 yaml 配置文件）
   */
  async function handleAtomicScan(req: Request, res: Response): Promise<void> {
    const { atomicScanner, configRepo, dataResourcesRepo, performSync } = scanContext

    if (!atomicScanner || !configRepo) {
      logger.error('ScanRoutes', 'Atomic scan service not available. Database not configured.')
      res.status(503).json({ success: false, error: 'Atomic scan service not available. Database not configured.' })
      return
    }

    // 从 SystemConfigRepository 获取扫描参数（数据库优先，其次 yaml 配置文件）
    const dir = configRepo.getScanAreaPath() || os.homedir()
    const extensionsStr = configRepo.getControlType()
    const excludeDirsStr = configRepo.getScanExcludeDir() || ''
    const workspace = configRepo.getWorkspace()
    const saveCode = configRepo.getSaveCode()

    // scan_mode 从请求参数获取
    const scanModeStr = req.query.scan_mode as string

    if (!workspace) {
      logger.error('ScanRoutes', '请先配置工作空间目录')
      res.status(400).json({ success: false, error: '请先配置工作空间目录' })
      return
    }

    if (!extensionsStr) {
      logger.error('ScanRoutes', '配置中缺少管控文件类型 (control_type)')
      res.status(400).json({ success: false, error: '配置中缺少管控文件类型 (control_type)' })
      return
    }

    const { StreamingFileScannerService } = await import('../StreamingFileScannerService')
    const extensions = StreamingFileScannerService.parseExtensions(extensionsStr)
    const excludeDirs = excludeDirsStr ? excludeDirsStr.split(',').map(d => d.trim()).filter(d => d) : []

    // 解析扫描模式
    let scanMode: ScanMode | undefined
    if (scanModeStr) {
      if (Object.values(ScanMode).includes(scanModeStr as ScanMode)) {
        scanMode = scanModeStr as ScanMode
      } else {
        logger.error('ScanRoutes', '无效的扫描模式', null, { scanModeStr })
        res.status(400).json({
          success: false,
          error: `Invalid scan_mode: ${scanModeStr}. Valid values: ${Object.values(ScanMode).join(', ')}`
        })
        return
      }
    }

    if (extensions.length === 0) {
      logger.error('ScanRoutes', '无效的管控文件类型配置', null, { extensionsStr })
      res.status(400).json({ success: false, error: '无效的管控文件类型配置' })
      return
    }

    logger.info('ScanRoutes', '开始原子扫描', { scanMode, dir, workspace, extensionsCount: extensions.length })

    // 设置 SSE 头
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('Access-Control-Allow-Origin', '*')

    const startTime = Date.now()
    scanContext.setScanning(true)

    // 发送 SSE 事件的辅助函数
    const sendSSE = (data: ScanProgressEvent): void => {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const result = await atomicScanner.scan(
        {
          directory: dir,
          extensions,
          excludeDirs,
          workspace,
          md5Concurrency: 4,
          batchSize: 100,
          progressInterval: 10,
          scan_mode: scanMode,
          save_code: saveCode ?? undefined
        },
        (progress: ScanProgressInfo) => {
          scanContext.setCurrentTaskId(progress.taskId)
          sendSSE({
            type: 'progress',
            taskId: progress.taskId,
            phase: progress.phase,
            scannedCount: progress.scannedCount,
            totalCount: progress.totalCount,
            currentFile: progress.currentFile,
            elapsedMs: Date.now() - startTime
          })
        }
      )

      // 更新最后扫描时间
      if (result.success) {
        configRepo.setLastScanTime(new Date().toISOString())
      }

      logger.info('ScanRoutes', '原子扫描完成', {
        success: result.success,
        totalFiles: result.totalFiles,
        scannedFiles: result.scannedFiles,
        duration: result.duration,
        errorMessage: result.errorMessage
      })

      // 扫描成功后自动执行同步
      if (result.success && dataResourcesRepo) {
        const uploadServerUrl = configRepo.getUploadServerUrl()
        if (!uploadServerUrl) {
          logger.info('ScanRoutes', '未配置上传服务器地址，跳过自动同步')
        } else {
          logger.info('ScanRoutes', '开始执行数据同步...')
          // 后台执行同步，不阻塞 SSE 响应
          performSync()
            .then((syncResult) => {
              if (syncResult.success) {
                logger.info('ScanRoutes', '数据同步完成', {
                  syncedCount: syncResult.syncedCount,
                  failedCount: syncResult.failedCount
                })
              } else {
                logger.warn('ScanRoutes', '数据同步部分失败', {
                  syncedCount: syncResult.syncedCount,
                  failedCount: syncResult.failedCount,
                  message: syncResult.message
                })
              }
            })
            .catch((error) => {
              logger.error('ScanRoutes', '数据同步失败', error)
            })
        }
      }

      // 发送完成事件
      sendSSE({
        type: 'complete',
        taskId: result.taskId,
        phase: 'completed',
        scannedCount: result.scannedFiles,
        totalCount: result.totalFiles,
        elapsedMs: result.duration,
        success: result.success,
        errorMessage: result.errorMessage
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      sendSSE({
        type: 'error',
        scannedCount: 0,
        totalCount: 0,
        elapsedMs: Date.now() - startTime,
        success: false,
        errorMessage
      })
    } finally {
      scanContext.setScanning(false)
      scanContext.setCurrentTaskId(null)
    }

    res.end()
  }

  /**
   * 处理扫描状态请求
   * GET /scan/status
   */
  function handleScanStatus(req: Request, res: Response): void {
    const { configRepo, isScanning, currentTaskId } = scanContext
    const lastScanTime = configRepo?.getLastScanTime() ?? null

    res.json({
      success: true,
      data: {
        isScanning,
        currentTaskId,
        lastScanTime
      }
    })
  }

  return router;
}

export default ScanRoutes;
