import path from 'node:path'
import * as fs from 'node:fs'
import { fdir, PathsOutput } from 'fdir'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import { getLogger } from './LoggerService'

const logger = getLogger()

export interface StreamingScanOptions {
  directory: string               // 扫描的目录
  extensions: string[]           // 包含的后缀列表
  excludeDirs?: string[]         // 排除的目录名称列表
  batchSize?: number             // 每批次回调的文件数量
  workspace?: string             // 工作空间目录，重点管控区域，该目录下所有文件的后缀并与extensions后缀列表合并后进行扫描
}

export interface ScanProgress {
  scannedCount: number           // 已扫描文件数
  currentPath: string            // 当前文件路径
}

export interface WorkspaceStats {
  workspacePath: string          // 工作空间路径
  workspaceFileCount: number     // 工作空间文件总数
  workspaceSuffixes: string[]    // 工作空间所有文件后缀
  suffixCounts: Record<string, number>  // 各后缀文件数量统计
}

export interface ScanResultWithSuffixes {
  scannedCount: number           // 扫描文件数
  usedExtensions: string[]       // 本次扫描用到的所有后缀
  workspaceStats?: WorkspaceStats // 工作空间统计信息
}

export type FileCallback = (filePath: string) => void | Promise<void>
export type BatchCallback = (filePaths: string[]) => void | Promise<void>
export type ProgressCallback = (progress: ScanProgress) => void

/**
 * 流式文件扫描服务
 * 基于 fdir 实现高性能目录扫描，支持流式处理避免内存溢出
 */
export class StreamingFileScannerService {
  // 默认排除的目录
  private static readonly DEFAULT_EXCLUDES = new Set(['.git', 'node_modules', '.svn', '.hg', '__pycache__', '.DS_Store'])

  /**
   * 解析后缀字符串
   */
  static parseExtensions(extensionsStr: string): string[] {
    return extensionsStr
      .split(',')
      .map(ext => ext.trim())
      .filter(ext => ext.length > 0)
      .map(ext => ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`)
  }

  /**
   * 获取 Windows 系统的所有盘符
   */
  static getWindowsDrives(): string[] {
    if (os.platform() !== 'win32') {
      return []
    }
    try {
      // 使用 wmic 命令获取所有逻辑磁盘
      const output = execSync('wmic logicaldisk get name', { encoding: 'utf-8' })
      const drives = output
        .split('\n')
        .map(line => line.trim())
        .filter(line => /^[A-Z]:$/i.test(line))
        .map(drive => drive + '\\')
      return drives
    } catch {
      // 备选方案：尝试常见盘符
      const commonDrives: string[] = []
      for (let i = 65; i <= 90; i++) { // A-Z
        const drive = String.fromCharCode(i) + ':\\'
        try {
          const { statSync } = fs
          statSync(drive)
          commonDrives.push(drive)
        } catch {
          // 盘符不存在，跳过
        }
      }
      return commonDrives
    }
  }

  /**
   * 获取扫描目录列表（支持全盘扫描）
   */
  static getScanDirectories(directory: string): string[] {
    // 检测是否为全盘扫描
    if (directory === '/' || directory === '\\') {
      if (os.platform() === 'win32') {
        return StreamingFileScannerService.getWindowsDrives()
      }
      return ['/']
    }
    return [directory]
  }

  /**
   * 检测路径是否在另一个路径范围内
   */
  static isPathWithin(childPath: string, parentPath: string): boolean {
    const normalizedChild = path.resolve(childPath).toLowerCase()
    const normalizedParent = path.resolve(parentPath).toLowerCase()

    if (normalizedChild === normalizedParent) {
      return true
    }

    // 确保 parent 路径以分隔符结尾
    const parentWithSep = normalizedParent.endsWith(path.sep)
      ? normalizedParent
      : normalizedParent + path.sep

    return normalizedChild.startsWith(parentWithSep)
  }

  /**
   * 统计目录下所有文件的后缀
   */
  async collectWorkspaceSuffixes(workspacePath: string, excludeDirs: string[] = []): Promise<WorkspaceStats> {
    const excludeSet = new Set(excludeDirs.map(d => d.toLowerCase()))
    const suffixCounts: Record<string, number> = {}
    let totalFiles = 0

    const crawler = new fdir()
      .exclude((dirName) => {
        const lowerName = dirName.toLowerCase()
        if (dirName.startsWith('.') || StreamingFileScannerService.DEFAULT_EXCLUDES.has(lowerName)) {
          return true
        }
        return excludeSet.has(lowerName)
      })
      .withFullPaths()
      .crawl(workspacePath)

    const files = await crawler.withPromise() as PathsOutput

    for (const filePath of files) {
      const ext = path.extname(filePath).toLowerCase()
      if (ext) {
        suffixCounts[ext] = (suffixCounts[ext] || 0) + 1
        totalFiles++
      }
    }

    const workspaceSuffixes = Object.keys(suffixCounts).sort()

    return {
      workspacePath,
      workspaceFileCount: totalFiles,
      workspaceSuffixes,
      suffixCounts
    }
  }

  /**
   * 合并扩展名列表（去重）
   */
  static mergeExtensions(baseExtensions: string[], additionalExtensions: string[]): string[] {
    const extSet = new Set<string>()
    for (const ext of baseExtensions) {
      extSet.add(ext.toLowerCase())
    }
    for (const ext of additionalExtensions) {
      extSet.add(ext.toLowerCase())
    }
    return Array.from(extSet).sort()
  }

  /**
   * 流式扫描目录，通过回调处理每个文件
   * 支持异步回调，等待每个回调完成后再处理下一个
   * 支持 workspace 参数：统计 workspace 后缀并合并，避免重复扫描
   */
  async scanWithCallback(
    options: StreamingScanOptions,
    onFile: FileCallback,
    onProgress?: ProgressCallback
  ): Promise<ScanResultWithSuffixes> {
    const { directory, extensions, excludeDirs = [], workspace } = options
    const excludeSet = new Set(excludeDirs.map(d => d.toLowerCase()))

    let workspaceStats: WorkspaceStats | undefined
    let finalExtensions = extensions

    // 如果指定了 workspace，先统计其文件后缀
    if (workspace) {
      workspaceStats = await this.collectWorkspaceSuffixes(workspace, excludeDirs)
      finalExtensions = StreamingFileScannerService.mergeExtensions(extensions, workspaceStats.workspaceSuffixes)
    }

    const extSet = new Set(finalExtensions.map(ext => ext.toLowerCase()))
    const scanDirs = StreamingFileScannerService.getScanDirectories(directory)

    let scannedCount = 0
    const scannedPaths = new Set<string>() // 用于去重

    // 扫描单个目录
    const scanDirectory = async (dir: string): Promise<void> => {
      const crawler = new fdir()
        .exclude((dirName) => {
          const lowerName = dirName.toLowerCase()
          if (dirName.startsWith('.') || StreamingFileScannerService.DEFAULT_EXCLUDES.has(lowerName)) {
            return true
          }
          return excludeSet.has(lowerName)
        })
        .filter((filePath) => {
          const ext = path.extname(filePath).toLowerCase()
          return extSet.has(ext)
        })
        .withFullPaths()
        .crawl(dir)

      const files = await crawler.withPromise() as PathsOutput

      for (const filePath of files) {
        // 检查是否已扫描过（防止 workspace 在 directory 范围内重复扫描）
        const normalizedPath = path.resolve(filePath).toLowerCase()
        if (scannedPaths.has(normalizedPath)) {
          continue
        }
        scannedPaths.add(normalizedPath)

        try {
          await onFile(filePath)
          scannedCount++

          if (onProgress) {
            onProgress({
              scannedCount,
              currentPath: filePath
            })
          }
        } catch (error) {
          logger.error('StreamingFileScannerService', '文件处理失败', error, { filePath })
        }
      }
    }

    // 扫描主目录
    for (const dir of scanDirs) {
      await scanDirectory(dir)
    }

    // 如果 workspace 不在 directory 范围内，单独扫描 workspace
    if (workspace) {
      let workspaceNeedsScanning = true
      for (const dir of scanDirs) {
        if (StreamingFileScannerService.isPathWithin(workspace, dir)) {
          workspaceNeedsScanning = false
          break
        }
      }
      if (workspaceNeedsScanning) {
        await scanDirectory(workspace)
      }
    }

    return {
      scannedCount,
      usedExtensions: finalExtensions,
      workspaceStats
    }
  }

  /**
   * 批量流式扫描
   * 将文件分批次处理，减少回调次数
   */
  async scanWithBatchCallback(
    options: StreamingScanOptions,
    onBatch: BatchCallback,
    onProgress?: ProgressCallback
  ): Promise<ScanResultWithSuffixes> {
    const { directory, extensions, excludeDirs = [], batchSize = 100, workspace } = options
    const excludeSet = new Set(excludeDirs.map(d => d.toLowerCase()))

    let workspaceStats: WorkspaceStats | undefined
    let finalExtensions = extensions

    // 如果指定了 workspace，先统计其文件后缀
    if (workspace) {
      workspaceStats = await this.collectWorkspaceSuffixes(workspace, excludeDirs)
      finalExtensions = StreamingFileScannerService.mergeExtensions(extensions, workspaceStats.workspaceSuffixes)
    }

    const extSet = new Set(finalExtensions.map(ext => ext.toLowerCase()))
    const scanDirs = StreamingFileScannerService.getScanDirectories(directory)

    let scannedCount = 0
    let batch: string[] = []
    const scannedPaths = new Set<string>() // 用于去重

    const processBatch = async (currentBatch: string[], lastPath: string): Promise<void> => {
      try {
        await onBatch([...currentBatch])
        scannedCount += currentBatch.length

        if (onProgress) {
          onProgress({
            scannedCount,
            currentPath: lastPath
          })
        }
      } catch (error) {
        logger.error('StreamingFileScannerService', '批量处理失败', error)
      }
    }

    // 扫描单个目录
    const scanDirectory = async (dir: string): Promise<void> => {
      const crawler = new fdir()
        .exclude((dirName) => {
          const lowerName = dirName.toLowerCase()
          if (dirName.startsWith('.') || StreamingFileScannerService.DEFAULT_EXCLUDES.has(lowerName)) {
            return true
          }
          return excludeSet.has(lowerName)
        })
        .filter((filePath) => {
          const ext = path.extname(filePath).toLowerCase()
          return extSet.has(ext)
        })
        .withFullPaths()
        .crawl(dir)

      const files = await crawler.withPromise() as PathsOutput

      for (const filePath of files) {
        // 检查是否已扫描过
        const normalizedPath = path.resolve(filePath).toLowerCase()
        if (scannedPaths.has(normalizedPath)) {
          continue
        }
        scannedPaths.add(normalizedPath)

        batch.push(filePath)

        if (batch.length >= batchSize) {
          await processBatch(batch, filePath)
          batch = []
        }
      }
    }

    // 扫描主目录
    for (const dir of scanDirs) {
      await scanDirectory(dir)
    }

    // 如果 workspace 不在 directory 范围内，单独扫描 workspace
    if (workspace) {
      let workspaceNeedsScanning = true
      for (const dir of scanDirs) {
        if (StreamingFileScannerService.isPathWithin(workspace, dir)) {
          workspaceNeedsScanning = false
          break
        }
      }
      if (workspaceNeedsScanning) {
        await scanDirectory(workspace)
      }
    }

    // 处理剩余的文件
    if (batch.length > 0) {
      await processBatch(batch, batch[batch.length - 1])
    }

    return {
      scannedCount,
      usedExtensions: finalExtensions,
      workspaceStats
    }
  }

  /**
   * 异步生成器扫描
   * 允许调用者使用 for-await-of 逐个处理文件
   */
  async *scanAsGenerator(options: StreamingScanOptions): AsyncGenerator<string, void, unknown> {
    const { directory, extensions, excludeDirs = [], workspace } = options
    const excludeSet = new Set(excludeDirs.map(d => d.toLowerCase()))

    let finalExtensions = extensions

    // 如果指定了 workspace，先统计其文件后缀
    if (workspace) {
      const workspaceStats = await this.collectWorkspaceSuffixes(workspace, excludeDirs)
      finalExtensions = StreamingFileScannerService.mergeExtensions(extensions, workspaceStats.workspaceSuffixes)
    }

    const extSet = new Set(finalExtensions.map(ext => ext.toLowerCase()))
    const scanDirs = StreamingFileScannerService.getScanDirectories(directory)
    const scannedPaths = new Set<string>()

    const scanDirectory = async (dir: string): Promise<PathsOutput> => {
      const crawler = new fdir()
        .exclude((dirName) => {
          const lowerName = dirName.toLowerCase()
          if (dirName.startsWith('.') || StreamingFileScannerService.DEFAULT_EXCLUDES.has(lowerName)) {
            return true
          }
          return excludeSet.has(lowerName)
        })
        .filter((filePath) => {
          const ext = path.extname(filePath).toLowerCase()
          return extSet.has(ext)
        })
        .withFullPaths()
        .crawl(dir)

      return await crawler.withPromise() as PathsOutput
    }

    // 扫描主目录
    for (const dir of scanDirs) {
      const files = await scanDirectory(dir)
      for (const filePath of files) {
        const normalizedPath = path.resolve(filePath).toLowerCase()
        if (!scannedPaths.has(normalizedPath)) {
          scannedPaths.add(normalizedPath)
          yield filePath
        }
      }
    }

    // 如果 workspace 不在 directory 范围内，单独扫描 workspace
    if (workspace) {
      let workspaceNeedsScanning = true
      for (const dir of scanDirs) {
        if (StreamingFileScannerService.isPathWithin(workspace, dir)) {
          workspaceNeedsScanning = false
          break
        }
      }
      if (workspaceNeedsScanning) {
        const files = await scanDirectory(workspace)
        for (const filePath of files) {
          const normalizedPath = path.resolve(filePath).toLowerCase()
          if (!scannedPaths.has(normalizedPath)) {
            scannedPaths.add(normalizedPath)
            yield filePath
          }
        }
      }
    }
  }

  /**
   * 计算符合条件的文件总数（不返回文件列表）
   * 支持 workspace 和全盘扫描
   */
  async countFiles(options: Omit<StreamingScanOptions, 'batchSize'>): Promise<number> {
    const { directory, extensions, excludeDirs = [], workspace } = options
    const excludeSet = new Set(excludeDirs.map(d => d.toLowerCase()))

    let finalExtensions = extensions

    // 如果指定了 workspace，先统计其文件后缀
    if (workspace) {
      const workspaceStats = await this.collectWorkspaceSuffixes(workspace, excludeDirs)
      finalExtensions = StreamingFileScannerService.mergeExtensions(extensions, workspaceStats.workspaceSuffixes)
    }

    const extSet = new Set(finalExtensions.map(ext => ext.toLowerCase()))
    const scanDirs = StreamingFileScannerService.getScanDirectories(directory)

    let totalCount = 0

    const countInDirectory = async (dir: string): Promise<number> => {
      const crawler = new fdir()
        .exclude((dirName) => {
          const lowerName = dirName.toLowerCase()
          if (dirName.startsWith('.') || StreamingFileScannerService.DEFAULT_EXCLUDES.has(lowerName)) {
            return true
          }
          return excludeSet.has(lowerName)
        })
        .filter((filePath) => {
          const ext = path.extname(filePath).toLowerCase()
          return extSet.has(ext)
        })
        .onlyCounts()
        .crawl(dir)

      const counts = await crawler.withPromise()
      return counts.files
    }

    // 计算主目录
    for (const dir of scanDirs) {
      totalCount += await countInDirectory(dir)
    }

    // 如果 workspace 不在 directory 范围内，单独计算 workspace
    if (workspace) {
      let workspaceNeedsScanning = true
      for (const dir of scanDirs) {
        if (StreamingFileScannerService.isPathWithin(workspace, dir)) {
          workspaceNeedsScanning = false
          break
        }
      }
      if (workspaceNeedsScanning) {
        totalCount += await countInDirectory(workspace)
      }
    }

    return totalCount
  }

  /**
   * 计算符合条件的文件总数并返回扩展名信息
   */
  async countFilesWithExtensions(options: Omit<StreamingScanOptions, 'batchSize'>): Promise<{
    count: number
    usedExtensions: string[]
    workspaceStats?: WorkspaceStats
  }> {
    const { directory, extensions, excludeDirs = [], workspace } = options
    const excludeSet = new Set(excludeDirs.map(d => d.toLowerCase()))

    let workspaceStats: WorkspaceStats | undefined
    let finalExtensions = extensions

    // 如果指定了 workspace，先统计其文件后缀
    if (workspace) {
      workspaceStats = await this.collectWorkspaceSuffixes(workspace, excludeDirs)
      finalExtensions = StreamingFileScannerService.mergeExtensions(extensions, workspaceStats.workspaceSuffixes)
    }

    const extSet = new Set(finalExtensions.map(ext => ext.toLowerCase()))
    const scanDirs = StreamingFileScannerService.getScanDirectories(directory)

    let totalCount = 0

    const countInDirectory = async (dir: string): Promise<number> => {
      const crawler = new fdir()
        .exclude((dirName) => {
          const lowerName = dirName.toLowerCase()
          if (dirName.startsWith('.') || StreamingFileScannerService.DEFAULT_EXCLUDES.has(lowerName)) {
            return true
          }
          return excludeSet.has(lowerName)
        })
        .filter((filePath) => {
          const ext = path.extname(filePath).toLowerCase()
          return extSet.has(ext)
        })
        .onlyCounts()
        .crawl(dir)

      const counts = await crawler.withPromise()
      return counts.files
    }

    // 计算主目录
    for (const dir of scanDirs) {
      totalCount += await countInDirectory(dir)
    }

    // 如果 workspace 不在 directory 范围内，单独计算 workspace
    if (workspace) {
      let workspaceNeedsScanning = true
      for (const dir of scanDirs) {
        if (StreamingFileScannerService.isPathWithin(workspace, dir)) {
          workspaceNeedsScanning = false
          break
        }
      }
      if (workspaceNeedsScanning) {
        totalCount += await countInDirectory(workspace)
      }
    }

    return {
      count: totalCount,
      usedExtensions: finalExtensions,
      workspaceStats
    }
  }
}
