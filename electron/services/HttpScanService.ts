import http from 'node:http'
import https from 'node:https'
import express from 'express';
// import { Router, Request, Response, NextFunction } from 'express';

import cors from 'cors';
import { URL } from 'node:url'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import type { Database as DatabaseType } from 'better-sqlite3'
import { StreamingFileScannerService } from './StreamingFileScannerService'
import { AtomicScanService, ScanProgressInfo, ScanMode } from './AtomicScanService'
import { DataDistributingRepository, FileWithCopyCount, ArchiveQueryOptions, ArchiveFileResult } from './DataDistributingRepository'
import { FileOpenerService } from './FileOpenerService'
import { DataResourcesRepository } from './DataResourcesRepository'
import { SystemConfigRepository } from './SystemConfigRepository'
import { ConfigService } from './ConfigService'
import { FileStatisticsRepository } from './FileStatisticsRepository'
import { UserInfoRepository } from './UserInfoRepository'
import { ScanTaskRepository, ScanTaskQueryParams, ScanTaskPageResult, ScanTaskWithParamsChanged } from './ScanTaskRepository'
import { calculateFileHash } from './FileHashUtil'
import { getLogger } from './LoggerService'
import { ResourceClassifyService } from './ResourceClassifyService'
import { getLocalIP, getLocalMAC } from './util/NetworkUtil'
import Files from "./routes/Files.ts";
import Config from "./routes/Config.ts";
import UserInfo from "./routes/UserInfo.ts";
import Resources from "./routes/Resources.ts";
import { Archive, ArchiveManagement } from "./routes/Archive.ts";
import ScanTasks from "./routes/ScanTasks.ts";
import ScanRoutes from "./routes/ScanRoutes.ts";
import Statistics from "./routes/Statistics.ts";
import { ScanContext } from "./routes/types";

const logger = getLogger()

export interface HttpServiceOptions {
  port?: number
  host?: string
  db?: DatabaseType
  configService?: ConfigService  // 用于注入到 SystemConfigRepository 中
}

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

export class HttpScanService {
  private server: http.Server | null = null
  private scanner: StreamingFileScannerService
  private atomicScanner: AtomicScanService | null = null
  private dataRepo: DataDistributingRepository | null = null
  private dataResourcesRepo: DataResourcesRepository | null = null
  private configRepo: SystemConfigRepository | null = null
  private statsRepo: FileStatisticsRepository | null = null
  private userInfoRepo: UserInfoRepository | null = null
  private scanTaskRepo: ScanTaskRepository | null = null
  private fileOpenerService: FileOpenerService | null = null
  private classifyService: ResourceClassifyService | null = null
  private configService: ConfigService | null = null
  private port: number
  private host: string
  private db: DatabaseType | null = null
  private isScanning: boolean = false
  private currentTaskId: number | null = null

  constructor(options: HttpServiceOptions = {}) {
    this.scanner = new StreamingFileScannerService()
    this.port = options.port ?? 3001
    this.host = options.host ?? '127.0.0.1'
    this.configService = options.configService ?? null
    if (options.db) {
      this.db = options.db
      this.atomicScanner = new AtomicScanService(options.db, 100)
      this.dataRepo = new DataDistributingRepository(options.db)
      this.dataResourcesRepo = new DataResourcesRepository(options.db)
      this.configRepo = new SystemConfigRepository(options.db, options.configService)
      this.statsRepo = new FileStatisticsRepository(options.db)
      this.userInfoRepo = new UserInfoRepository(options.db)
      this.scanTaskRepo = new ScanTaskRepository(options.db)
      this.fileOpenerService = new FileOpenerService(options.db)
      this.classifyService = new ResourceClassifyService(options.db, this.configRepo)
    }
  }

  /**
   * 设置数据库连接（支持延迟注入）
   */
  setDatabase(db: DatabaseType): void {
    this.db = db
    this.atomicScanner = new AtomicScanService(db, 100)
    this.dataRepo = new DataDistributingRepository(db)
    this.dataResourcesRepo = new DataResourcesRepository(db)
    this.configRepo = new SystemConfigRepository(db, this.configService ?? undefined)
    this.statsRepo = new FileStatisticsRepository(db)
    this.userInfoRepo = new UserInfoRepository(db)
    this.scanTaskRepo = new ScanTaskRepository(db)
    this.fileOpenerService = new FileOpenerService(db)
    this.classifyService = new ResourceClassifyService(db, this.configRepo)
  }

  /**
   * 设置配置服务（支持延迟注入）
   * 注入的 ConfigService 会被传递给 SystemConfigRepository
   */
  setConfigService(configService: ConfigService): void {
    this.configService = configService
    if (this.configRepo) {
      this.configRepo.setConfigService(configService)
    }
  }

  /**
   * 启动 HTTP 服务
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const app = express();
      this.server = http.createServer(app);

      // 第一步：立即启用 CORS
      app.use(cors());
      // 第二步：其他全局中间件（例如解析 JSON 的）
      app.use(express.json());
      app.use('/files', Files(this.configRepo!, this.dataRepo!, this.fileOpenerService))
      app.use('/config', Config(this.configRepo!))
      app.use('/user-info', UserInfo(this.userInfoRepo!, (userInfo) => this.performTerminalRegistration(userInfo)))
      app.use('/resources', Resources(this.dataResourcesRepo!, this.configRepo!, this.classifyService!))
      app.use('/archive', Archive(this.dataRepo!, this.configRepo!))
      app.use('/archive-management', ArchiveManagement(this.dataRepo!, this.configRepo!))
      app.use('/scan-tasks', ScanTasks(this.scanTaskRepo!))
      app.use('/statistics', Statistics(this.statsRepo!))

      // 创建扫描上下文传递给 ScanRoutes
      const scanContext: ScanContext = {
        atomicScanner: this.atomicScanner,
        configRepo: this.configRepo,
        dataResourcesRepo: this.dataResourcesRepo,
        isScanning: this.isScanning,
        currentTaskId: this.currentTaskId,
        setScanning: (isScanning: boolean) => { this.isScanning = isScanning },
        setCurrentTaskId: (taskId: number | null) => { this.currentTaskId = taskId },
        performSync: () => this.performSync()
      }
      app.use('/scan', ScanRoutes(scanContext))

      app.use(async (req, res,next) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
        try {
         /* if (url.pathname === '/scan' && req.method === 'GET') {
            await this.handleScan(url, res)
          }
          else if (url.pathname === '/scan/stream' && req.method === 'GET') {
            await this.handleStreamScan(url, res)
          }
          // /scan/atomic 和 /scan/status 已迁移到 routes/ScanRoutes.ts，由 express 路由处理
          else*/ if (url.pathname === '/files' && req.method === 'GET') {
            return next();
          }
          else if (url.pathname.startsWith('/files/') && url.pathname.endsWith('/copies') && req.method === 'GET') {
            // this.handleGetCopies(url, res)
            return next();
          } else if (url.pathname === '/config') {
            // 已迁移到 routes/Config.ts
            return next();
          } else if (url.pathname === '/statistics' && req.method === 'GET') {
            // 已迁移到 routes/Statistics.ts
            return next();
          } else if (url.pathname === '/upload' && req.method === 'POST') {
            await this.handleUploadFile(req, res)
          } else if (url.pathname === '/archive' && req.method === 'POST') {
            // 已迁移到 routes/Archive.ts
            return next();
          } else if (url.pathname.startsWith('/archive/') && req.method === 'GET') {
            // /archive/list 已迁移到 routes/Archive.ts
            return next();
          } else if (url.pathname === '/archive/download' && req.method === 'POST') {
            // 已迁移到 routes/Archive.ts
            return next();
          } else if (url.pathname === '/user-info') {
            // 已迁移到 routes/UserInfo.ts
            return next();
          } else if (url.pathname === '/resources' && req.method === 'GET') {
            // 已迁移到 routes/Resources.ts
            // await this.handleGetResources(url, res)
            return next();
          } else if (url.pathname === '/resources/claim' && req.method === 'POST') {
            // 已迁移到 routes/Resources.ts
            return next();
          } else if (url.pathname === '/resources/classify' && req.method === 'POST') {
            // 已迁移到 routes/Resources.ts
            return next();
          } else if (url.pathname === '/resources/classify/single' && req.method === 'POST') {
            // 已迁移到 routes/Resources.ts
            return next();
          } else if (url.pathname === '/resources/statistics' && req.method === 'GET') {
            // 已迁移到 routes/Resources.ts
            return next();
          } else if (url.pathname === '/sync/source' && req.method === 'POST') {
            await this.handleSyncSource(req, res)
          } else if (url.pathname === '/scan-tasks' && req.method === 'GET') {
            // 已迁移到 routes/ScanTasks.ts
            return next();
          } else if (url.pathname.startsWith('/scan-tasks/') && req.method === 'GET') {
            // 已迁移到 routes/ScanTasks.ts
            return next();
          } else if (url.pathname === '/files/open' && req.method === 'POST') {
            // 已迁移到 routes/Files.ts
            return next();
          } else if (url.pathname === '/archive-management' && req.method === 'GET') {
            // 已迁移到 routes/Archive.ts
            return next();
          } else if (url.pathname === '/archive-management/no-archive' && req.method === 'POST') {
            // 已迁移到 routes/Archive.ts
            return next();
          } else if (url.pathname === '/health' && req.method === 'GET') {
            this.handleHealth(res)
          } else {
            this.sendError(res, 404, 'Not Found')
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Internal Server Error'
          logger.error('HttpScanService', '请求处理失败', error, { pathname: url.pathname, method: req.method })
          this.sendError(res, 500, message)
        }
      })


      this.server.on('error', (error) => {
        logger.error('HttpScanService', 'HTTP服务启动失败', error)
        reject(error)
      })
      this.server.listen(this.port, this.host, () => {
        logger.info('HttpScanService', `扫描服务已启动`, { address: `http://${this.host}:${this.port}` })
        resolve()
      })
    })
  }

  /**
   * 停止 HTTP 服务
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  /**
   * 处理普通扫描请求（兼容旧接口）
   * GET /scan?dir=/path/to/scan&extensions=.ts,.vue&countOnly=true
   */
  private async handleScan(url: URL, res: http.ServerResponse): Promise<void> {
    const dir = url.searchParams.get('dir')
    const extensionsStr = url.searchParams.get('extensions')
    const countOnly = url.searchParams.get('countOnly') === 'true'

    if (!dir) {
      this.sendError(res, 400, 'Missing required parameter: dir')
      return
    }

    if (!extensionsStr) {
      this.sendError(res, 400, 'Missing required parameter: extensions')
      return
    }

    const extensions = StreamingFileScannerService.parseExtensions(extensionsStr)

    if (extensions.length === 0) {
      this.sendError(res, 400, 'Invalid extensions parameter')
      return
    }

    // 验证目录是否存在
    try {
      const stat = await fs.stat(dir)
      if (!stat.isDirectory()) {
        this.sendError(res, 500, `Path is not a directory: ${dir}`)
        return
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Directory not accessible'
      this.sendError(res, 500, message)
      return
    }

    res.setHeader('Content-Type', 'application/json')

    if (countOnly) {
      const total = await this.scanner.countFiles({ directory: dir, extensions })
      this.sendJson(res, 200, {
        success: true,
        data: { files: [], total }
      })
    } else {
      const files: string[] = []
      await this.scanner.scanWithCallback(
        { directory: dir, extensions },
        (filePath) => { files.push(filePath) }
      )
      this.sendJson(res, 200, {
        success: true,
        data: { files, total: files.length }
      })
    }
  }

  /**
   * 处理流式扫描请求（SSE）
   * GET /scan/stream?dir=/path&extensions=.ts,.vue&excludeDirs=node_modules&workspace=/workspace
   */
  private async handleStreamScan(url: URL, res: http.ServerResponse): Promise<void> {
    const dir = url.searchParams.get('dir')
    const extensionsStr = url.searchParams.get('extensions')
    const excludeDirsStr = url.searchParams.get('excludeDirs')
    const workspace = url.searchParams.get('workspace')

    if (!dir) {
      this.sendError(res, 400, 'Missing required parameter: dir')
      return
    }

    if (!extensionsStr) {
      this.sendError(res, 400, 'Missing required parameter: extensions')
      return
    }

    const extensions = StreamingFileScannerService.parseExtensions(extensionsStr)
    const excludeDirs = excludeDirsStr ? excludeDirsStr.split(',').map(d => d.trim()).filter(d => d) : []

    if (extensions.length === 0) {
      this.sendError(res, 400, 'Invalid extensions parameter')
      return
    }

    // 设置 SSE 头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    })

    const startTime = Date.now()
    let scannedCount = 0

    // 先获取文件总数
    const totalCount = await this.scanner.countFiles({ directory: dir, extensions, excludeDirs, workspace: workspace || undefined })

    // 发送初始事件
    this.sendSSE(res, {
      type: 'progress',
      phase: 'counting',
      scannedCount: 0,
      totalCount,
      elapsedMs: Date.now() - startTime
    })

    try {
      const scanResult = await this.scanner.scanWithCallback(
        { directory: dir, extensions, excludeDirs, workspace: workspace || undefined },
        (filePath) => {
          scannedCount++
          // 每处理 10 个文件发送一次进度更新，避免频繁推送
          if (scannedCount % 10 === 0 || scannedCount === totalCount) {
            this.sendSSE(res, {
              type: 'progress',
              phase: 'scanning',
              scannedCount,
              totalCount,
              currentFile: filePath,
              elapsedMs: Date.now() - startTime
            })
          }
        }
      )

      // 发送完成事件
      this.sendSSE(res, {
        type: 'complete',
        phase: 'completed',
        scannedCount: scanResult.scannedCount,
        totalCount,
        elapsedMs: Date.now() - startTime,
        success: true
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.sendSSE(res, {
        type: 'error',
        scannedCount,
        totalCount,
        elapsedMs: Date.now() - startTime,
        success: false,
        errorMessage
      })
    }

    res.end()
  }

  /**
   * 处理原子扫描请求（SSE + 数据入库）
   * GET /scan/atomic?scan_mode=FULL_INVENTORY
   * 扫描参数从 SystemConfigRepository 获取（数据库优先，其次 yaml 配置文件）
   */
  private async handleAtomicScan(url: URL, res: http.ServerResponse): Promise<void> {
    if (!this.atomicScanner || !this.db) {
      logger.error('HttpScanService', 'Atomic scan service not available. Database not configured.')
      this.sendError(res, 503, 'Atomic scan service not available. Database not configured.')
      return
    }

    if (!this.configRepo) {
      logger.error('HttpScanService', 'Config repository not available.')
      this.sendError(res, 503, 'Config repository not available.')
      return
    }

    // 从 SystemConfigRepository 获取扫描参数（数据库优先，其次 yaml 配置文件）
    const dir = this.configRepo.getScanAreaPath() || os.homedir()
    const extensionsStr = this.configRepo.getControlType()
    const excludeDirsStr = this.configRepo.getScanExcludeDir() || ''
    const workspace = this.configRepo.getWorkspace()
    const saveCode = this.configRepo.getSaveCode()

    // scan_mode 仍然从请求参数获取
    const scanModeStr = url.searchParams.get('scan_mode')

    if (!workspace) {
      logger.error('HttpScanService', '请先配置工作空间目录')
      this.sendError(res, 400, '请先配置工作空间目录')
      return
    }

    if (!extensionsStr) {
      logger.error('HttpScanService', '配置中缺少管控文件类型 (control_type)')
      this.sendError(res, 400, '配置中缺少管控文件类型 (control_type)')
      return
    }

    const extensions = StreamingFileScannerService.parseExtensions(extensionsStr)
    const excludeDirs = excludeDirsStr ? excludeDirsStr.split(',').map(d => d.trim()).filter(d => d) : []

    // 解析扫描模式
    let scanMode: ScanMode | undefined
    if (scanModeStr) {
      if (Object.values(ScanMode).includes(scanModeStr as ScanMode)) {
        scanMode = scanModeStr as ScanMode
      } else {
        logger.error('HttpScanService', '无效的扫描模式', null, { scanModeStr })
        this.sendError(res, 400, `Invalid scan_mode: ${scanModeStr}. Valid values: ${Object.values(ScanMode).join(', ')}`)
        return
      }
    }

    if (extensions.length === 0) {
      logger.error('HttpScanService', '无效的管控文件类型配置', null, { extensionsStr })
      this.sendError(res, 400, '无效的管控文件类型配置')
      return
    }

    logger.info('HttpScanService', '开始原子扫描', { scanMode, dir, workspace, extensionsCount: extensions.length })

    // 设置 SSE 头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    })

    const startTime = Date.now()
    this.isScanning = true

    try {
      const result = await this.atomicScanner.scan(
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
          this.currentTaskId = progress.taskId
          this.sendSSE(res, {
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
      if (this.configRepo && result.success) {
        this.configRepo.setLastScanTime(new Date().toISOString())
      }

      logger.info('HttpScanService', '原子扫描完成', {
        success: result.success,
        totalFiles: result.totalFiles,
        scannedFiles: result.scannedFiles,
        duration: result.duration,
        errorMessage: result.errorMessage
      })

      // 扫描成功后自动执行同步
      if (result.success && this.configRepo && this.dataResourcesRepo) {
        const uploadServerUrl = this.configRepo.getUploadServerUrl()
        if (!uploadServerUrl) {
          logger.info('HttpScanService', '未配置上传服务器地址，跳过自动同步')
        } else {
          logger.info('HttpScanService', '开始执行数据同步...')
          // TODO 同步时关联进度条信息
          this.performSync()
            .then((syncResult) => {
              if (syncResult.success) {
                logger.info('HttpScanService', '数据同步完成', {
                  syncedCount: syncResult.syncedCount,
                  failedCount: syncResult.failedCount
                })
              } else {
                logger.warn('HttpScanService', '数据同步部分失败', {
                  syncedCount: syncResult.syncedCount,
                  failedCount: syncResult.failedCount,
                  message: syncResult.message
                })
              }
            })
            .catch((error) => {
              logger.error('HttpScanService', '数据同步失败', error)
            })
        }
      }

      // 发送完成事件
      this.sendSSE(res, {
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
      this.sendSSE(res, {
        type: 'error',
        scannedCount: 0,
        totalCount: 0,
        elapsedMs: Date.now() - startTime,
        success: false,
        errorMessage
      })
    } finally {
      this.isScanning = false
      this.currentTaskId = null
    }

    res.end()
  }

  /**
   * 发送 SSE 事件
   */
  private sendSSE(res: http.ServerResponse, data: ScanProgressEvent): void {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  /**
   * 处理健康检查请求
   * GET /health
   */
  private handleHealth(res: http.ServerResponse): void {
    this.sendJson(res, 200, {
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      atomicScanAvailable: this.atomicScanner !== null
    })
  }

  private sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data, null, 2))
  }

  private sendError(res: http.ServerResponse, statusCode: number, message: string): void {
    this.sendJson(res, statusCode, {
      success: false,
      error: message
    })
  }

  get isRunning(): boolean {
    return this.server !== null && this.server.listening
  }

  get address(): string {
    return `http://${this.host}:${this.port}`
  }

  /**
   * 处理扫描状态请求
   * GET /scan/status
   */
  private handleScanStatus(res: http.ServerResponse): void {
    const lastScanTime = this.configRepo?.getLastScanTime() ?? null
    this.sendJson(res, 200, {
      success: true,
      data: {
        isScanning: this.isScanning,
        currentTaskId: this.currentTaskId,
        lastScanTime
      }
    })
  }

  /**
   * 处理获取文件列表请求
   * GET /files?search=xxx&workspaceFilter=inside&survivalFilter=new&page=1&pageSize=50
   */
  private handleGetFiles(req :any, res:any): void {
    if (!this.dataRepo || !this.configRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    const search = req.query.search || undefined
    const workspaceFilter = req.query.workspaceFilter || 'all' as 'inside' | 'outside' | 'all'
    const survivalFilter = req.query.survivalFilter || 'all' as 'new' | 'deleted' | 'normal' | 'all'
    const page = parseInt(req.query.page || '1', 10)
    const pageSize = parseInt(req.query.pageSize|| '50', 10)
    const noPagination =req.query.noPagination === 'true'

    const workspacePath = this.configRepo.getWorkspace() || undefined

    if (noPagination) {
      // 用于虚拟表格，不分页
      const files = this.dataRepo.getAllFilesWithCopyCount({
        search,
        workspacePath,
        workspaceFilter,
        survivalFilter
      })
      this.sendJson(res, 200, {
        success: true,
        data: {
          files,
          total: files.length
        }
      })
    } else {
      // 分页查询
      const result = this.dataRepo.getFilesWithPagination({
        page,
        pageSize,
        search,
        workspacePath,
        workspaceFilter,
        survivalFilter
      })
      res.json({
        success: true,
        data: {
          files: result.files,
          total: result.total,
          page,
          pageSize
        }
      });
      // this.sendJson(res, 200, {
      //   success: true,
      //   data: {
      //     files: result.files,
      //     total: result.total,
      //     page,
      //     pageSize
      //   }
      // })
    }
  }

  /**
   * 处理获取副本列表请求
   * GET /files/:contentSign/copies
   */
  private handleGetCopies(url: URL, res: http.ServerResponse): void {
    if (!this.dataRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    // 从路径中提取 contentSign
    const pathParts = url.pathname.split('/')
    const contentSign = pathParts[2] // /files/:contentSign/copies

    if (!contentSign) {
      this.sendError(res, 400, 'Missing content sign')
      return
    }

    const copies = this.dataRepo.getCopiesByContentSign(decodeURIComponent(contentSign))
    this.sendJson(res, 200, {
      success: true,
      data: {
        copies,
        count: copies.length
      }
    })
  }

  /**
   * 处理获取配置请求
   * GET /config
   */
  private handleGetConfig(res: http.ServerResponse): void {
    if (!this.configRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    const config = {
      workspace: this.configRepo.getWorkspace(),
      full_inventory_time: this.configRepo.getFullInventoryTime(),
      daily_scan_interval: this.configRepo.getDailyScanInterval(),
      last_scan_time: this.configRepo.getLastScanTime(),
      control_type: this.configRepo.getControlType(),
      scan_area_path: this.configRepo.getScanAreaPath(),
      scan_exclude_dir: this.configRepo.getScanExcludeDir(),
      upload_server_url: this.configRepo.getUploadServerUrl(),
      last_sync_time: this.configRepo.getLastSyncTime(),
      home_dir: os.homedir()
    }

    this.sendJson(res, 200, {
      success: true,
      data: config
    })
  }

  /**
   * 处理保存配置请求
   * POST /config
   */
  private async handleSaveConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.configRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    // 读取请求体
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }

    let config: Record<string, string | number | null>
    try {
      config = JSON.parse(body)
    } catch {
      logger.error('HttpScanService', '配置保存失败: Invalid JSON body')
      this.sendError(res, 400, 'Invalid JSON body')
      return
    }

    // 更新配置
    if (config.workspace !== undefined && config.workspace !== null) {
      this.configRepo.setWorkspace(String(config.workspace))
    }
    if (config.daily_scan_interval !== undefined && config.daily_scan_interval !== null) {
      this.configRepo.setDailyScanInterval(Number(config.daily_scan_interval))
    }
    if (config.control_type !== undefined && config.control_type !== null) {
      this.configRepo.setControlType(String(config.control_type))
    }
    if (config.scan_area_path !== undefined && config.scan_area_path !== null) {
      this.configRepo.setScanAreaPath(String(config.scan_area_path))
    }
    if (config.scan_exclude_dir !== undefined && config.scan_exclude_dir !== null) {
      this.configRepo.setScanExcludeDir(String(config.scan_exclude_dir))
    }
    if (config.upload_server_url !== undefined && config.upload_server_url !== null) {
      this.configRepo.setUploadServerUrl(String(config.upload_server_url))
    }

    logger.info('HttpScanService', '配置已保存', { config })
    this.sendJson(res, 200, {
      success: true,
      message: 'Configuration saved'
    })
  }

  /**
   * 处理获取文件统计数据请求
   * GET /statistics
   * 返回最近两次扫描的统计对比数据
   */
  private handleGetStatistics(res: http.ServerResponse): void {
    if (!this.statsRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    const comparison = this.statsRepo.getStatisticsComparison()

    this.sendJson(res, 200, {
      success: true,
      data: comparison
    })
  }

  /**
   * 处理文件上传请求
   * POST /upload
   * Body: { filePath: string, serverUrl: string }
   */
  private async handleUploadFile(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // 读取请求体
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }

    let params: { filePath: string, serverUrl: string }
    try {
      params = JSON.parse(body)
    } catch {
      logger.error('HttpScanService', '文件上传请求: Invalid JSON body')
      this.sendError(res, 400, 'Invalid JSON body')
      return
    }

    if (!params.filePath || !params.serverUrl) {
      logger.error('HttpScanService', '文件上传请求缺少必需参数', null, { params })
      this.sendError(res, 400, 'Missing required parameters: filePath, serverUrl')
      return
    }

    logger.info('HttpScanService', '开始文件上传', { filePath: params.filePath, serverUrl: params.serverUrl })

    try {
      // 读取本地文件
      const fileContent = await fs.readFile(params.filePath)
      const fileName = path.basename(params.filePath)

      // 构建 multipart/form-data
      const boundary = '----FormBoundary' + Math.random().toString(36).substring(2)
      const contentDisposition = `Content-Disposition: form-data; name="files"; filename="${fileName}"`
      const contentType = 'Content-Type: application/octet-stream'

      const header = `--${boundary}\r\n${contentDisposition}\r\n${contentType}\r\n\r\n`
      const footer = `\r\n--${boundary}--\r\n`

      const headerBuffer = Buffer.from(header, 'utf8')
      const footerBuffer = Buffer.from(footer, 'utf8')
      const bodyBuffer = Buffer.concat([headerBuffer, fileContent, footerBuffer])

      // 解析目标 URL
      const targetUrl = new URL(params.serverUrl)
      const isHttps = targetUrl.protocol === 'https:'
      const httpModule = isHttps ? https : http

      // 发送请求
      const uploadResult = await new Promise<{ success: boolean, message?: string }>((resolve) => {
        const uploadReq = httpModule.request({
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: targetUrl.pathname + targetUrl.search,
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': bodyBuffer.length
          }
        }, (uploadRes) => {
          let responseData = ''
          uploadRes.on('data', chunk => { responseData += chunk })
          uploadRes.on('end', () => {
            if (uploadRes.statusCode && uploadRes.statusCode >= 200 && uploadRes.statusCode < 300) {
              logger.info('HttpScanService', '文件上传成功', { fileName })
              resolve({ success: true, message: '上传成功' })
            } else {
              logger.error('HttpScanService', '文件上传失败', null, {
                fileName,
                statusCode: uploadRes.statusCode,
                responseData
              })
              resolve({ success: false, message: `上传失败: ${uploadRes.statusCode} ${responseData}` })
            }
          })
        })

        uploadReq.on('error', (error) => {
          logger.error('HttpScanService', '文件上传错误', error, { fileName })
          resolve({ success: false, message: `上传错误: ${error.message}` })
        })

        uploadReq.write(bodyBuffer)
        uploadReq.end()
      })

      this.sendJson(res, 200, uploadResult)
    } catch (error) {
      logger.error('HttpScanService', '文件上传异常', error, { filePath: params.filePath })
      const message = error instanceof Error ? error.message : '上传失败'
      this.sendJson(res, 200, { success: false, message })
    }
  }

  /**
   * 处理文件归档上传请求
   * POST /archive
   * Body: { filePath: string, archiveApplication: ArchiveApplication }
   */
  private async handleArchiveFile(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // 读取请求体
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }

    interface ArchiveApplication {
      applicant_unit: string
      applicant_department: string
      applicant_name: string
      applicant_contact: string
      archive_file_name: string
      archive_file_category: string
      archive_file_hash: string
      application_time: string
      content_title: string
      data_classification: string
      protection_method: number
    }

    let params: { filePath: string, archiveApplication: ArchiveApplication }
    try {
      params = JSON.parse(body)
    } catch {
      logger.error('HttpScanService', '文件归档请求: Invalid JSON body')
      this.sendError(res, 400, 'Invalid JSON body')
      return
    }

    if (!params.filePath) {
      logger.error('HttpScanService', '文件归档请求缺少必需参数: filePath')
      this.sendError(res, 400, 'Missing required parameter: filePath')
      return
    }

    if (!params.archiveApplication) {
      logger.error('HttpScanService', '文件归档请求缺少必需参数: archiveApplication')
      this.sendError(res, 400, 'Missing required parameter: archiveApplication')
      return
    }

    // 获取上传服务器地址
    if (!this.configRepo) {
      this.sendJson(res, 200, { success: false, message: '数据库未初始化' })
      return
    }

    const uploadServerUrl = this.configRepo.getUploadServerUrl()
    if (!uploadServerUrl) {
      logger.error('HttpScanService', '请先在系统设置中配置文件上传服务器地址')
      this.sendJson(res, 200, { success: false, message: '请先在系统设置中配置文件上传服务器地址' })
      return
    }

    logger.info('HttpScanService', '开始文件归档', {
      filePath: params.filePath,
      applicantName: params.archiveApplication.applicant_name
    })

    try {
      // 读取本地文件
      const fileContent = await fs.readFile(params.filePath)
      const fileName = path.basename(params.filePath)

      // 计算文件 MD5
      const hashResult = await calculateFileHash(params.filePath)
      const fileMd5 = hashResult.hash

      // 更新申请表中的 hash
      params.archiveApplication.archive_file_hash = fileMd5

      // 构建 multipart/form-data
      const boundary = '----FormBoundary' + Math.random().toString(36).substring(2)

      // 构建各部分
      const filePart = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      const md5Part = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="fileMd5"\r\n\r\n${fileMd5}`
      const applicationPart = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="archiveApplication"\r\n\r\n${JSON.stringify(params.archiveApplication)}`
      const endPart = `\r\n--${boundary}--\r\n`

      const bodyBuffer = Buffer.concat([
        Buffer.from(filePart, 'utf8'),
        fileContent,
        Buffer.from(md5Part, 'utf8'),
        Buffer.from(applicationPart, 'utf8'),
        Buffer.from(endPart, 'utf8')
      ])

      // 解析目标 URL
      const targetUrl = new URL('/api/file/archive', uploadServerUrl)
      const isHttps = targetUrl.protocol === 'https:'
      const httpModule = isHttps ? https : http

      // 发送请求
      const archiveResult = await new Promise<{ success: boolean, message?: string, data?: any }>((resolve) => {
        const archiveReq = httpModule.request({
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: targetUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': bodyBuffer.length
          }
        }, (archiveRes) => {
          let responseData = ''
          archiveRes.on('data', chunk => { responseData += chunk })
          archiveRes.on('end', () => {
            try {
              const jsonResponse = JSON.parse(responseData)
              if (jsonResponse.code === 0) {
                logger.info('HttpScanService', '文件归档成功', { fileName })
                resolve({ success: true, message: jsonResponse.message || '归档成功', data: jsonResponse.data })
              } else {
                logger.error('HttpScanService', '文件归档失败', null, {
                  fileName,
                  responseCode: jsonResponse.code,
                  responseMessage: jsonResponse.message
                })
                resolve({ success: false, message: jsonResponse.message || '归档失败' })
              }
            } catch {
              if (archiveRes.statusCode && archiveRes.statusCode >= 200 && archiveRes.statusCode < 300) {
                logger.info('HttpScanService', '文件归档成功', { fileName })
                resolve({ success: true, message: '归档成功' })
              } else {
                logger.error('HttpScanService', '文件归档失败', null, {
                  fileName,
                  statusCode: archiveRes.statusCode,
                  responseData
                })
                resolve({ success: false, message: `归档失败: ${archiveRes.statusCode} ${responseData}` })
              }
            }
          })
        })

        archiveReq.on('error', (error) => {
          logger.error('HttpScanService', '文件归档错误', error, { fileName })
          resolve({ success: false, message: `归档错误: ${error.message}` })
        })

        archiveReq.write(bodyBuffer)
        archiveReq.end()
      })

      // 更新文件上传状态
      if (this.dataRepo) {
        const fileRecord = this.dataRepo.getByPathWithUploadState(params.filePath)
        if (fileRecord && fileRecord.data_distribution_id) {
          if (archiveResult.success) {
            // 上传成功：更新当前文件状态为1（已上传）
            this.dataRepo.updateUploadState(fileRecord.data_distribution_id, 1)
            // 更新相同content_sign的其他文件状态为2（副本上传）
            this.dataRepo.updateCopiesUploadState(fileRecord.content_sign, fileRecord.data_distribution_id)
          } else {
            // 上传失败：更新当前文件状态为3（上传失败）
            this.dataRepo.updateUploadState(fileRecord.data_distribution_id, 3)
          }
        }
      }

      this.sendJson(res, 200, archiveResult)
    } catch (error) {
      const message = error instanceof Error ? error.message : '归档失败'
      this.sendJson(res, 200, { success: false, message })
    }
  }

  /**
   * 处理获取用户信息请求
   * GET /user-info
   */
  private handleGetUserInfo(res: http.ServerResponse): void {
    if (!this.userInfoRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    const userInfo = this.userInfoRepo.getActiveUser()

    this.sendJson(res, 200, {
      success: true,
      data: userInfo
    })
  }

  /**
   * 处理保存用户信息请求
   * POST /user-info
   */
  private async handleSaveUserInfo(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.userInfoRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    // 读取请求体
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }

    let params: { company_name: string, user_name: string, department: string, phone?: string | null }
    try {
      params = JSON.parse(body)
    } catch {
      this.sendError(res, 400, 'Invalid JSON body')
      return
    }

    // 验证必填字段
    if (!params.company_name || !params.user_name || !params.department) {
      this.sendError(res, 400, 'Missing required fields: company_name, user_name, department')
      return
    }

    const userInfo = this.userInfoRepo.save({
      company_name: params.company_name,
      user_name: params.user_name,
      department: params.department,
      phone: params.phone
    })

    // 在后台执行终端注册和同步（不阻塞响应）
    // 如果未配置上传服务器地址，只会记录日志，不会抛出错误
    this.performTerminalRegistration({
      user_name: params.user_name,
      user_department: params.department,
      user_unit: params.company_name
    }).catch(error => {
      logger.error('HttpScanService', '终端注册执行失败', error)
    })

    this.sendJson(res, 200, {
      success: true,
      data: userInfo,
      message: '用户信息已保存'
    })
  }

  /**
   * 处理获取信息资源列表请求
   * GET /resources?page=1&pageSize=50&claimStatusFilter=0&importanceLevelFilter=0&search=xxx&businessTypeFilter=workspace|new_access|history_inventory
   */
  private handleGetResources(url: URL, res: http.ServerResponse): void {
    if (!this.dataResourcesRepo || !this.configRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = parseInt(url.searchParams.get('pageSize') || '50', 10)
    const claimStatusFilterStr = url.searchParams.get('claimStatusFilter')
    const claimStatusInStr = url.searchParams.get('claimStatusIn')
    const importanceLevelFilterStr = url.searchParams.get('importanceLevelFilter')
    const businessTypeFilterStr = url.searchParams.get('businessTypeFilter')
    const search = url.searchParams.get('search') || undefined

    const claimStatusFilter = claimStatusFilterStr !== null ? parseInt(claimStatusFilterStr, 10) : undefined
    const importanceLevelFilter = importanceLevelFilterStr !== null ? parseInt(importanceLevelFilterStr, 10) : undefined

    // 解析 claimStatusIn 参数（逗号分隔的数字列表）
    let claimStatusIn: number[] | undefined
    if (claimStatusInStr) {
      claimStatusIn = claimStatusInStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
      if (claimStatusIn.length === 0) {
        claimStatusIn = undefined
      }
    }

    // 处理业务类型过滤参数
    let businessTypeFilter: 'workspace' | 'new_access' | 'history_inventory' | null = null
    if (businessTypeFilterStr && ['workspace', 'new_access', 'history_inventory'].includes(businessTypeFilterStr)) {
      businessTypeFilter = businessTypeFilterStr as 'workspace' | 'new_access' | 'history_inventory'
    }

    // 获取历史封帐时间
    const fullInventoryTime = this.configRepo.getFullInventoryTime()

    const result = this.dataResourcesRepo.getResourcesWithPagination({
      page,
      pageSize,
      claimStatusFilter,
      claimStatusIn,
      importanceLevelFilter,
      search,
      businessTypeFilter,
      fullInventoryTime: fullInventoryTime || undefined
    })

    this.sendJson(res, 200, {
      success: true,
      data: result
    })
  }

  /**
   * 处理批量认领请求
   * POST /resources/claim
   * Body: { ids: number[], is_claimed: number, claim_status: number, claimant_name: string, claimant_unit: string }
   */
  private async handleBatchClaim(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.dataResourcesRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    // 读取请求体
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }

    let params: {
      ids: number[]
      is_claimed: number
      claim_status: number
      claimant_name: string
      claimant_unit: string
    }

    try {
      params = JSON.parse(body)
    } catch {
      this.sendError(res, 400, 'Invalid JSON body')
      return
    }

    // 验证必填字段
    if (!params.ids || !Array.isArray(params.ids) || params.ids.length === 0) {
      this.sendError(res, 400, 'Missing or invalid required field: ids')
      return
    }
    if (params.is_claimed === undefined || params.claim_status === undefined) {
      this.sendError(res, 400, 'Missing required fields: is_claimed, claim_status')
      return
    }
    if (!params.claimant_name || !params.claimant_unit) {
      this.sendError(res, 400, 'Missing required fields: claimant_name, claimant_unit')
      return
    }

    const updatedCount = this.dataResourcesRepo.batchClaim({
      ids: params.ids,
      is_claimed: params.is_claimed,
      claim_status: params.claim_status,
      claimant_name: params.claimant_name,
      claimant_unit: params.claimant_unit
    })

    this.sendJson(res, 200, {
      success: true,
      data: { updatedCount },
      message: `成功认领 ${updatedCount} 条资源`
    })
  }

  /**
   * 处理批量归类保护请求
   * POST /resources/classify
   * Body: { ids: number[], importance_level: number }
   */
  private async handleBatchClassify(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.dataResourcesRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    // 读取请求体
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }

    let params: {
      ids: number[]
      importance_level: number
    }

    try {
      params = JSON.parse(body)
    } catch {
      this.sendError(res, 400, 'Invalid JSON body')
      return
    }

    // 验证必填字段
    if (!params.ids || !Array.isArray(params.ids) || params.ids.length === 0) {
      this.sendError(res, 400, 'Missing or invalid required field: ids')
      return
    }
    if (params.importance_level === undefined) {
      this.sendError(res, 400, 'Missing required field: importance_level')
      return
    }

    // 验证重要程度值范围 (0-4)
    if (params.importance_level < 0 || params.importance_level > 4) {
      this.sendError(res, 400, 'Invalid importance_level value. Valid values: 0-4')
      return
    }

    const updatedCount = this.dataResourcesRepo.batchClassify({
      ids: params.ids,
      importance_level: params.importance_level
    })

    this.sendJson(res, 200, {
      success: true,
      data: { updatedCount },
      message: `成功归类 ${updatedCount} 条资源`
    })
  }

  /**
   * 处理单条归类保护请求
   * POST /resources/classify/single
   * Body: {
   *   data_resources_id: number,
   *   importance_level: number,
   *   resources_name?: string,
   *   resources_desc?: string,
   *   content_subject?: string
   * }
   */
  private async handleSingleClassify(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.classifyService) {
      this.sendError(res, 503, 'Classify service not available')
      return
    }

    // 读取请求体
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }

    let params: {
      data_resources_id: number
      importance_level: number
      resources_name?: string
      resources_desc?: string
      content_subject?: string
    }

    try {
      params = JSON.parse(body)
    } catch {
      logger.error('HttpScanService', '单条归类保护请求: Invalid JSON body')
      this.sendError(res, 400, 'Invalid JSON body')
      return
    }

    // 验证必填字段
    if (!params.data_resources_id || params.importance_level === undefined) {
      this.sendError(res, 400, 'Missing required fields: data_resources_id, importance_level')
      return
    }

    // 验证重要程度值范围 (1-3, 5)
    const validValues = [1, 2, 3, 5]
    if (!validValues.includes(params.importance_level)) {
      this.sendError(res, 400, 'Invalid importance_level value. Valid values: 1, 2, 3, 5')
      return
    }

    const result = await this.classifyService.classifyResource(params)

    this.sendJson(res, 200, result)
  }

  /**
   * 处理获取信息资源统计请求
   * GET /resources/statistics
   * 返回基于 data_resources 表的统计数据
   */
  private handleGetResourcesStatistics(res: http.ServerResponse): void {
    if (!this.dataResourcesRepo || !this.configRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    // 获取历史封帐时间
    const fullInventoryTime = this.configRepo.getFullInventoryTime()

    const statistics = this.dataResourcesRepo.getResourcesStatistics(fullInventoryTime || null)

    this.sendJson(res, 200, {
      success: true,
      data: statistics
    })
  }

  /**
   * 处理归档文件列表查询请求
   * GET /archive/list?page=1&pageSize=10&applicant_name=张三
   * 代理到远程服务器的 /api/file/archive
   */
  private async handleArchiveList(url: URL, res: http.ServerResponse): Promise<void> {
    if (!this.configRepo) {
      this.sendJson(res, 200, { code: -1, message: '数据库未初始化' })
      return
    }

    const uploadServerUrl = this.configRepo.getUploadServerUrl()
    if (!uploadServerUrl) {
      this.sendJson(res, 200, { code: -1, message: '请先在系统设置中配置文件上传服务器地址' })
      return
    }

    try {
      // 构建查询参数
      const page = url.searchParams.get('page') || '1'
      const pageSize = url.searchParams.get('pageSize') || '50'
      const applicantName = url.searchParams.get('applicant_name')

      // 构建目标URL
      const targetUrl = new URL('/api/file/archive', uploadServerUrl)
      if (page) targetUrl.searchParams.set('page', page)
      if (pageSize) targetUrl.searchParams.set('pageSize', pageSize)
      if (applicantName) targetUrl.searchParams.set('applicant_name', applicantName)

      const isHttps = targetUrl.protocol === 'https:'
      const httpModule = isHttps ? https : http

      // 代理请求到远程服务器
      const proxyResult = await new Promise<{ code: number, message?: string, data?: any }>((resolve) => {
        const proxyReq = httpModule.request({
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: targetUrl.pathname + targetUrl.search,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        }, (proxyRes) => {
          let responseData = ''
          proxyRes.on('data', chunk => { responseData += chunk })
          proxyRes.on('end', () => {
            try {
              const jsonResponse = JSON.parse(responseData)
              resolve(jsonResponse)
            } catch {
              resolve({ code: -1, message: '解析响应失败' })
            }
          })
        })

        proxyReq.on('error', (error) => {
          resolve({ code: -1, message: `请求失败: ${error.message}` })
        })

        proxyReq.end()
      })

      this.sendJson(res, 200, proxyResult)
    } catch (error) {
      const message = error instanceof Error ? error.message : '查询失败'
      this.sendJson(res, 200, { code: -1, message })
    }
  }

  /**
   * 处理归档文件下载请求
   * POST /archive/download
   * Body: { archive_id: number, borrower_name: string, borrower_department: string, borrow_reason?: string, borrow_method: 1|2 }
   * 代理到远程服务器的 /api/file/download
   */
  private async handleArchiveDownload(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.configRepo) {
      this.sendJson(res, 200, { code: -1, message: '数据库未初始化' })
      return
    }

    const uploadServerUrl = this.configRepo.getUploadServerUrl()
    if (!uploadServerUrl) {
      this.sendJson(res, 200, { code: -1, message: '请先在系统设置中配置文件上传服务器地址' })
      return
    }

    // 读取请求体
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }

    interface BorrowDownloadParams {
      archive_id: number
      borrower_name: string
      borrower_department: string
      borrow_reason?: string
      borrow_method: 1 | 2
    }

    let params: BorrowDownloadParams
    try {
      params = JSON.parse(body)
    } catch {
      this.sendJson(res, 200, { code: -1, message: 'Invalid JSON body' })
      return
    }

    // 验证必填字段
    if (!params.archive_id || !params.borrower_name || !params.borrower_department || !params.borrow_method) {
      this.sendJson(res, 200, { code: -1, message: 'Missing required fields: archive_id, borrower_name, borrower_department, borrow_method' })
      return
    }

    // 验证borrow_method值
    if (params.borrow_method !== 1 && params.borrow_method !== 2) {
      this.sendJson(res, 200, { code: -1, message: 'Invalid borrow_method value. Must be 1 (online view) or 2 (download)' })
      return
    }

    try {
      // 构建目标URL
      const targetUrl = new URL('/api/file/download', uploadServerUrl)
      const isHttps = targetUrl.protocol === 'https:'
      const httpModule = isHttps ? https : http

      // 代理请求到远程服务器
      const proxyResult = await new Promise<{ code: number, message?: string, data?: any }>((resolve) => {
        const proxyReq = httpModule.request({
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: targetUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          }
        }, (proxyRes) => {
          // 如果返回的是文件（二进制），则透传给客户端
          const contentType = proxyRes.headers['content-type']
          if (contentType && contentType.includes('application/octet-stream')) {
            // 透传文件流
            res.writeHead(proxyRes.statusCode || 200, {
              'Content-Type': contentType,
              'Content-Disposition': proxyRes.headers['content-disposition'],
              'Access-Control-Allow-Origin': '*'
            })
            proxyRes.pipe(res)
            resolve({ code: 0, message: '下载成功' })
            return
          }

          // 如果返回JSON响应，则解析并返回
          let responseData = ''
          proxyRes.on('data', chunk => { responseData += chunk })
          proxyRes.on('end', () => {
            try {
              const jsonResponse = JSON.parse(responseData)
              resolve(jsonResponse)
            } catch {
              resolve({ code: -1, message: '解析响应失败' })
            }
          })
        })

        proxyReq.on('error', (error) => {
          resolve({ code: -1, message: `请求失败: ${error.message}` })
        })

        proxyReq.write(JSON.stringify(params))
        proxyReq.end()
      })

      this.sendJson(res, 200, proxyResult)
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载失败'
      this.sendJson(res, 200, { code: -1, message })
    }
  }

  /**
   * 执行数据同步
   * 将 data_resources 表中的记录同步到服务端
   * @returns 同步结果
   */
  private async performSync(): Promise<{
    success: boolean
    syncedCount: number
    failedCount: number
    totalCount: number
    message?: string
  }> {
    if (!this.configRepo || !this.dataResourcesRepo) {
      throw new Error('Database not configured')
    }

    // 获取上传服务器地址
    const uploadServerUrl = this.configRepo.getUploadServerUrl()
    if (!uploadServerUrl) {
      throw new Error('未配置上传服务器地址')
    }

    // 获取最后同步时间
    const lastSyncTime = this.configRepo.getLastSyncTime()

    // 获取待同步的记录总数
    const totalCount = this.dataResourcesRepo.countPendingSyncRecords(lastSyncTime)

    if (totalCount === 0) {
      // 即使没有数据需要同步，也上传统计数据
      const statsResult = await this.syncStatisticsToServer(uploadServerUrl)
      if (statsResult.success) {
        logger.info('HttpScanService', '统计数据上传完成（无数据同步）')
      } else {
        logger.warn('HttpScanService', '统计数据上传失败', { error: statsResult.error })
      }

      return {
        success: true,
        syncedCount: 0,
        failedCount: 0,
        totalCount: 0,
        message: '没有需要同步的记录'
      }
    }

    const batchSize = 100
    let syncedCount = 0
    let failedCount = 0
    let maxUpdateTime = lastSyncTime || ''

    // 分批同步
    for (let offset = 0; offset < totalCount; offset += batchSize) {
      const records = this.dataResourcesRepo.getPendingSyncRecords(lastSyncTime, batchSize, offset)

      if (records.length === 0) {
        break
      }

      // 构建同步数据
      const syncData = records.map(record => {
        // 跟踪最大的 update_time
        if (!maxUpdateTime || record.update_time > maxUpdateTime) {
          maxUpdateTime = record.update_time
        }

        // 构建基础数据（必填字段）
        const baseData: {
          content_md5: string
          source_ip: string
          source_mac: string
          quantity: number
          first_create_time?: string
          content_subject?: string
          content_type?: string
          file_magic?: string
          claim_status?: number
          claim_time?: string
          importance_level?: number
          data_share?: string
        } = {
          content_md5: record.content_sign,
          source_ip: record.source_ip || '',
          source_mac: record.source_mac || '',
          quantity: record.source_count
        }

        // 添加可选字段（仅当有值时才添加）
        if (record.first_create_time) {
          baseData.first_create_time = record.first_create_time
        }
        if (record.content_subject) {
          baseData.content_subject = record.content_subject
        }
        if (record.content_type) {
          baseData.content_type = record.content_type
        }
        if (record.file_magic) {
          baseData.file_magic = record.file_magic
        }
        if (record.claim_status !== undefined && record.claim_status !== null) {
          baseData.claim_status = record.claim_status
        }
        if (record.claim_time) {
          baseData.claim_time = record.claim_time
        }
        if (record.importance_level !== undefined && record.importance_level !== null) {
          baseData.importance_level = record.importance_level
        }
        if (record.data_share) {
          baseData.data_share = record.data_share
        }

        return baseData
      })

      // 过滤掉没有 IP 和 MAC 的记录
      const validRecords = syncData.filter(r => r.source_ip && r.source_mac)

      if (validRecords.length === 0) {
        failedCount += records.length
        continue
      }

      // 发送同步请求
      const syncResult = await this.syncToServer(uploadServerUrl, validRecords)

      if (syncResult.success) {
        syncedCount += validRecords.length
      } else {
        failedCount += validRecords.length
      }
    }

    // 数据同步完成后，上传统计数据
    const statsResult = await this.syncStatisticsToServer(uploadServerUrl)
    if (statsResult.success) {
      logger.info('HttpScanService', '统计数据上传完成')
    } else {
      logger.warn('HttpScanService', '统计数据上传失败', { error: statsResult.error })
    }

    // 更新最后同步时间（使用本次同步的最大 update_time）
    if (syncedCount > 0 && maxUpdateTime) {
      this.configRepo.setLastSyncTime(maxUpdateTime)
    }


    return {
      success: failedCount === 0,
      syncedCount,
      failedCount,
      totalCount,
      message: failedCount === 0
        ? `成功同步 ${syncedCount} 条记录`
        : `同步完成: 成功 ${syncedCount} 条, 失败 ${failedCount} 条`
    }
  }

  /**
   * 处理数据同步请求
   * POST /sync/source
   * 将 data_resources 表中的记录同步到服务端
   */
  private async handleSyncSource(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.configRepo || !this.dataResourcesRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    // 检查上传服务器地址
    const uploadServerUrl = this.configRepo.getUploadServerUrl()
    if (!uploadServerUrl) {
      this.sendJson(res, 400, {
        success: false,
        error: '请先在系统设置中配置上传服务器地址'
      })
      return
    }

    try {
      const result = await this.performSync()
      this.sendJson(res, 200, {
        success: result.success,
        message: result.message,
        data: {
          syncedCount: result.syncedCount,
          failedCount: result.failedCount,
          totalCount: result.totalCount,
          lastSyncTime: this.configRepo.getLastSyncTime()
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '同步失败'
      this.sendJson(res, 500, {
        success: false,
        error: message
      })
    }
  }

  /**
   * 发送统计数据到服务器
   * @param serverUrl 服务器地址
   */
  private async syncStatisticsToServer(serverUrl: string): Promise<{ success: boolean; error?: string }> {
    if (!this.dataResourcesRepo || !this.configRepo) {
      return { success: false, error: 'Repository not initialized' }
    }

    try {
      // 获取历史封帐时间
      const fullInventoryTime = this.configRepo.getFullInventoryTime()

      // 获取统计数据
      const statistics = this.dataResourcesRepo.getResourcesStatistics(fullInventoryTime || null)

      // 构建请求数据
      const requestBody = {
        computer_ip: getLocalIP(),
        computer_mac: getLocalMAC(),
        file_total: statistics.totalFileCount,
        workspace_file_total: statistics.workspaceTotalCount,
        history_file_count: statistics.historyFileCount >= 0 ? statistics.historyFileCount : 0,
        non_history_file_count: statistics.nonHistoryFileCount >= 0 ? statistics.nonHistoryFileCount : 0,
        workspace_file_claimed_count: statistics.workspaceClaimedCount,
        history_file_claimed_count: statistics.historyClaimedCount >= 0 ? statistics.historyClaimedCount : 0,
        non_history_file_claimed_count: statistics.nonHistoryClaimedCount >= 0 ? statistics.nonHistoryClaimedCount : 0,
        unclassified_file_count: statistics.unclassifiedCount,
        core_file_count: statistics.coreCount,
        important_file_count: statistics.importantCount,
        open_file_count: statistics.openCount,
        private_file_count: statistics.privacyCount
      }

      const targetUrl = new URL('/api/sync/file-statistics', serverUrl)
      const isHttps = targetUrl.protocol === 'https:'
      const httpModule = isHttps ? https : http

      const body = JSON.stringify(requestBody)

      return await new Promise<{ success: boolean; error?: string }>((resolve) => {
        const syncReq = httpModule.request({
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: targetUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        }, (syncRes) => {
          let responseData = ''
          syncRes.on('data', chunk => { responseData += chunk })
          syncRes.on('end', () => {
            const isSuccess = syncRes.statusCode && syncRes.statusCode >= 200 && syncRes.statusCode < 300
            if (isSuccess) {
              logger.info('HttpScanService', '统计数据同步成功', { responseData })
              resolve({ success: true })
            } else {
              logger.error('HttpScanService', '统计数据同步失败', null, {
                statusCode: syncRes.statusCode,
                responseData
              })
              resolve({
                success: false,
                error: `服务器返回错误: ${syncRes.statusCode} ${responseData}`
              })
            }
          })
        })

        syncReq.on('error', (error) => {
          logger.error('HttpScanService', '统计数据同步请求失败', error)
          resolve({ success: false, error: `统计同步请求失败: ${error.message}` })
        })

        syncReq.write(body)
        syncReq.end()
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误'
      logger.error('HttpScanService', '统计数据同步异常', error)
      return { success: false, error: errorMsg }
    }
  }

  /**
   * 发送同步请求到服务器
   */
  private async syncToServer(
    serverUrl: string,
    data: Array<{
      content_md5: string
      source_ip: string
      source_mac: string
      quantity: number
      first_create_time?: string
      content_subject?: string
      content_type?: string
      file_magic?: string
      claim_status?: number
      claim_time?: string
      importance_level?: number
      data_share?: string
    }>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const targetUrl = new URL('/api/sync/source', serverUrl)
      const isHttps = targetUrl.protocol === 'https:'
      const httpModule = isHttps ? https : http

      const body = JSON.stringify(data)

      return await new Promise<{ success: boolean; error?: string }>((resolve) => {
        const syncReq = httpModule.request({
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: targetUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        }, (syncRes) => {
          let responseData = ''
          syncRes.on('data', chunk => { responseData += chunk })
          syncRes.on('end', () => {
            const isSuccess = syncRes.statusCode && syncRes.statusCode >= 200 && syncRes.statusCode < 300
            if (isSuccess) {
              resolve({ success: true })
            } else {
              resolve({
                success: false,
                error: `服务器返回错误: ${syncRes.statusCode} ${responseData}`
              })
            }
          })
        })

        syncReq.on('error', (error) => {
          resolve({ success: false, error: `同步请求失败: ${error.message}` })
        })

        syncReq.write(body)
        syncReq.end()
      })
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '同步失败'
      }
    }
  }

  /**
   * 终端用户注册登记
   * 调用远程服务的 /api/terminal/register 接口
   */
  private async registerTerminal(
    serverUrl: string,
    userInfo: { user_name: string; user_department: string; user_unit: string }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const targetUrl = new URL('/api/terminal/register', serverUrl)
      const isHttps = targetUrl.protocol === 'https:'
      const httpModule = isHttps ? https : http

      const requestBody = {
        user_name: userInfo.user_name,
        user_department: userInfo.user_department,
        user_unit: userInfo.user_unit,
        terminal_app_version: 'V1.0.0',
        computer_ip: getLocalIP(),
        computer_mac: getLocalMAC()
      }

      const body = JSON.stringify(requestBody)

      return await new Promise<{ success: boolean; error?: string }>((resolve) => {
        const registerReq = httpModule.request({
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: targetUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        }, (registerRes) => {
          let responseData = ''
          registerRes.on('data', chunk => { responseData += chunk })
          registerRes.on('end', () => {
            const isSuccess = registerRes.statusCode && registerRes.statusCode >= 200 && registerRes.statusCode < 300
            if (isSuccess) {
              logger.info('HttpScanService', '终端注册成功', { responseData })
              resolve({ success: true })
            } else {
              logger.error('HttpScanService', '终端注册失败', null, {
                statusCode: registerRes.statusCode,
                responseData
              })
              resolve({
                success: false,
                error: `服务器返回错误: ${registerRes.statusCode} ${responseData}`
              })
            }
          })
        })

        registerReq.on('error', (error) => {
          logger.error('HttpScanService', '终端注册请求失败', error)
          resolve({ success: false, error: `注册请求失败: ${error.message}` })
        })

        registerReq.write(body)
        registerReq.end()
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误'
      logger.error('HttpScanService', '终端注册异常', error)
      return { success: false, error: errorMsg }
    }
  }

  /**
   * 获取所有终端用户信息
   * 调用远程服务的 /api/terminal/list 接口
   */
  private async fetchAllTerminalUsers(
    serverUrl: string
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const targetUrl = new URL('/api/terminal/list', serverUrl)
      const isHttps = targetUrl.protocol === 'https:'
      const httpModule = isHttps ? https : http

      return await new Promise<{ success: boolean; data?: any; error?: string }>((resolve) => {
        const fetchReq = httpModule.request({
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: targetUrl.pathname,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        }, (fetchRes) => {
          let responseData = ''
          fetchRes.on('data', chunk => { responseData += chunk })
          fetchRes.on('end', () => {
            const isSuccess = fetchRes.statusCode && fetchRes.statusCode >= 200 && fetchRes.statusCode < 300
            if (isSuccess) {
              try {
                const jsonData = JSON.parse(responseData)
                logger.info('HttpScanService', '终端同步：获取终端列表成功')
                resolve({ success: true, data: jsonData })
              } catch (e) {
                logger.error('HttpScanService', '终端同步：解析响应失败', e, { responseData })
                resolve({
                  success: false,
                  error: `解析响应失败: ${e instanceof Error ? e.message : '未知错误'}`
                })
              }
            } else {
              logger.error('HttpScanService', '终端同步：获取失败', null, {
                statusCode: fetchRes.statusCode,
                responseData
              })
              resolve({
                success: false,
                error: `服务器返回错误: ${fetchRes.statusCode} ${responseData}`
              })
            }
          })
        })

        fetchReq.on('error', (error) => {
          logger.error('HttpScanService', '终端同步：请求失败', error)
          resolve({ success: false, error: `请求失败: ${error.message}` })
        })

        fetchReq.end()
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误'
      logger.error('HttpScanService', '终端同步：异常', error)
      return { success: false, error: errorMsg }
    }
  }

  /**
   * 执行终端注册和同步
   * 1. 注册当前终端
   * 2. 获取所有终端用户信息并保存到系统配置  TODO 与注册分开，在系统启动时执行同步
   */
  private async performTerminalRegistration(
    userInfo: { user_name: string; user_department: string; user_unit: string }
  ): Promise<void> {
    if (!this.configRepo) {
      logger.info('HttpScanService', '配置仓库未初始化，跳过终端注册')
      return
    }

    const uploadServerUrl = this.configRepo.getUploadServerUrl()
    if (!uploadServerUrl) {
      logger.info('HttpScanService', '未配置上传服务器地址，跳过终端注册')
      return
    }

    logger.info('HttpScanService', '开始终端注册流程...')

    // 1. 注册当前终端
    const registerResult = await this.registerTerminal(uploadServerUrl, userInfo)
    if (!registerResult.success) {
      logger.warn('HttpScanService', '终端注册失败，但继续执行后续流程', { error: registerResult.error })
    }

    // 2. 获取所有终端用户信息
    const fetchResult = await this.fetchAllTerminalUsers(uploadServerUrl)
    if (fetchResult.success && fetchResult.data !== undefined) {
      try {
        // 将数据转换为 JSON 字符串并保存
        const jsonValue = JSON.stringify(fetchResult.data)
        this.configRepo.setAllTerminalUsers(jsonValue)
        logger.info('HttpScanService', '终端用户信息已保存到系统配置')
      } catch (e) {
        logger.error('HttpScanService', '保存终端用户信息失败', e)
      }
    } else {
      logger.warn('HttpScanService', '获取终端用户信息失败', { error: fetchResult.error })
    }
  }

  /**
   * 处理获取扫描任务列表请求
   * GET /scan-tasks?page=1&pageSize=20
   */
  private handleGetScanTasks(url: URL, res: http.ServerResponse): void {
    if (!this.scanTaskRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10)

    const result = this.scanTaskRepo.getTasksWithPagination({ page, pageSize })

    this.sendJson(res, 200, {
      success: true,
      data: result
    })
  }

  /**
   * 处理获取扫描任务详情请求
   * GET /scan-tasks/:id
   */
  private async handleGetScanTaskDetail(url: URL, res: http.ServerResponse): Promise<void> {
    if (!this.scanTaskRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    // 从路径中提取任务ID
    const pathParts = url.pathname.split('/')
    const taskId = parseInt(pathParts[2], 10)

    if (isNaN(taskId)) {
      this.sendError(res, 400, 'Invalid task ID')
      return
    }

    const task = this.scanTaskRepo.getTaskDetailById(taskId)

    if (!task) {
      this.sendError(res, 404, 'Task not found')
      return
    }

    this.sendJson(res, 200, {
      success: true,
      data: task
    })
  }

  /**
   * 处理打开文件请求
   * POST /file/open
   * Body: { contentSign: string }
   */
  private async handleOpenFile(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.fileOpenerService) {
      this.sendError(res, 503, 'File opener service not available')
      return
    }

    // 读取请求体
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }

    let params: { contentSign: string }
    try {
      params = JSON.parse(body)
    } catch {
      this.sendError(res, 400, 'Invalid JSON body')
      return
    }

    // 验证必填字段
    if (!params.contentSign) {
      this.sendError(res, 400, 'Missing required field: contentSign')
      return
    }

    const result = await this.fileOpenerService.openFileByContentSign(params.contentSign)

    this.sendJson(res, 200, {
      success: result.success,
      message: result.message,
      data: result.filePath ? { filePath: result.filePath } : undefined
    })
  }

  /**
   * 处理获取归档管理文件列表请求
   * GET /archive-management?page=1&pageSize=50&search=xxx&archiveType=pending|core|important|open
   */
  private handleGetArchiveManagement(url: URL, res: http.ServerResponse): void {
    if (!this.dataRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = parseInt(url.searchParams.get('pageSize') || '50', 10)
    const search = url.searchParams.get('search') || undefined
    const archiveType = (url.searchParams.get('archiveType') || 'pending') as 'pending' | 'core' | 'important' | 'open'

    const options: ArchiveQueryOptions = {
      page,
      pageSize,
      search,
      archiveType
    }

    const result = this.dataRepo.getArchiveFiles(options)

    this.sendJson(res, 200, {
      success: true,
      data: {
        files: result.files,
        total: result.total,
        page,
        pageSize
      }
    })
  }

  /**
   * 处理批量无需归档请求
   * POST /archive-management/no-archive
   * Body: { ids: number[] }
   */
  private async handleBatchNoArchive(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.dataRepo) {
      this.sendError(res, 503, 'Database not configured')
      return
    }

    // 读取请求体
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }

    let params: { ids: number[] }
    try {
      params = JSON.parse(body)
    } catch {
      this.sendError(res, 400, 'Invalid JSON body')
      return
    }

    // 验证必填字段
    if (!params.ids || !Array.isArray(params.ids) || params.ids.length === 0) {
      this.sendError(res, 400, 'Missing or invalid required field: ids')
      return
    }

    const updatedCount = this.dataRepo.batchUpdateToNoArchive(params.ids)

    logger.info('HttpScanService', '批量设置为无需归档', { count: updatedCount })

    this.sendJson(res, 200, {
      success: true,
      data: { updatedCount },
      message: `成功将 ${updatedCount} 条记录设置为无需归档`
    })
  }
}
