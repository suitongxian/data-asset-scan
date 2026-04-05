import fs from 'node:fs/promises'
import path from 'node:path'
import { fdir } from 'fdir'

export interface ScanResult {
  files: string[]
  total: number
}

export interface ScanOptions {
  directory: string
  extensions: string[]  // 支持逗号分割的后缀列表，如 ['.ts', '.vue']
  countOnly?: boolean   // 只返回数量，不返回文件列表，用于大规模扫描防止内存溢出
}

export class FileScannerService {
  /**
   * 解析后缀字符串，支持逗号分割
   * @param extensionsStr 后缀字符串，如 ".ts,.vue" 或 "ts,vue"
   * @returns 规范化的后缀数组，如 ['.ts', '.vue']
   */
  static parseExtensions(extensionsStr: string): string[] {
    return extensionsStr
      .split(',')
      .map(ext => ext.trim())
      .filter(ext => ext.length > 0)
      .map(ext => ext.startsWith('.') ? ext : `.${ext}`)
  }

  /**
   * 扫描指定目录下符合后缀条件的所有文件
   * 使用 fdir 实现高性能全盘扫描
   * @param options 扫描选项
   * @returns 扫描结果，包含文件路径列表和总数
   */
  async scan(options: ScanOptions): Promise<ScanResult> {
    const { directory, extensions, countOnly = false } = options

    // 验证目录是否存在
    const stat = await fs.stat(directory)
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${directory}`)
    }

    // 转换后缀为小写集合以便快速查找
    const extSet = new Set(extensions.map(ext => ext.toLowerCase()))

    const baseCrawler = new fdir()
      .exclude((dirName) => dirName.startsWith('.') || dirName === 'node_modules')
      .filter((filePath) => {
        const ext = path.extname(filePath).toLowerCase()
        return extSet.has(ext)
      })

    if (countOnly) {
      // 只计数模式，不存储文件路径，节省内存
      const crawler = baseCrawler.onlyCounts().crawl(directory)
      const counts = await crawler.withPromise()
      return {
        files: [],
        total: counts.files
      }
    }

    // 完整模式，返回文件列表
    const crawler = baseCrawler.withFullPaths().crawl(directory)
    const files = await crawler.withPromise() as string[]

    return {
      files,
      total: files.length
    }
  }
}
