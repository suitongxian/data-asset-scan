import type { Database as DatabaseType } from 'better-sqlite3'
import type { DataDistributing } from './DataDistributingRepository'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { getLogger } from './LoggerService'

const execAsync = promisify(exec)

export interface OpenFileResult {
  success: boolean
  message: string
  filePath?: string
}

/**
 * 文件打开服务
 * 提供根据 content_sign 打开本地文件的功能
 */
export class FileOpenerService {
  private db: DatabaseType

  constructor(db: DatabaseType) {
    this.db = db
  }

  /**
   * 根据 content_sign 打开文件
   * 1. 查询 data_distributing 表中所有该 content_sign 的记录
   * 2. 遍历路径，找到第一个存在的文件并打开
   * 3. 如果都不存在，返回文件已移除的提示
   */
  async openFileByContentSign(contentSign: string): Promise<OpenFileResult> {
    const logger = getLogger()

    try {
      // 查询所有匹配的记录
      const records = this.db.prepare(`
        SELECT * FROM data_distributing
        WHERE content_sign = ? AND disable = 0
      `).all(contentSign) as DataDistributing[]

      if (records.length === 0) {
        return {
          success: false,
          message: '未找到相关文件记录'
        }
      }

      // 遍历路径，找到第一个存在的文件
      for (const record of records) {
        if (existsSync(record.path)) {
          // 打开文件
          const openResult = await this.openFileWithDefaultApp(record.path)
          if (openResult) {
            logger.info('FileOpenerService', '文件打开成功', { path: record.path })
            return {
              success: true,
              message: '文件已打开',
              filePath: record.path
            }
          }
        }
      }

      // 所有文件都不存在
      return {
        success: false,
        message: '文件已移除或不存在'
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '打开文件失败'
      logger.error('FileOpenerService', '打开文件失败', error, { contentSign })
      return {
        success: false,
        message
      }
    }
  }

  /**
   * 使用系统默认程序打开文件
   * 根据不同操作系统使用不同的命令
   */
  private async openFileWithDefaultApp(filePath: string): Promise<boolean> {
    const platform = process.platform
    let command: string

    switch (platform) {
      case 'win32':
        // Windows: 使用 start 命令
        command = `start "" "${filePath}"`
        break
      case 'darwin':
        // macOS: 使用 open 命令
        command = `open "${filePath}"`
        break
      case 'linux':
        // Linux: 使用 xdg-open 命令
        command = `xdg-open "${filePath}"`
        break
      default:
        return false
    }

    try {
      await execAsync(command, {
        shell: true as any,
        windowsHide: true as any // 隐藏 Windows 下的命令行窗口
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取指定 content_sign 的所有文件路径
   * 用于前端显示文件位置
   */
  getFilePathsByContentSign(contentSign: string): string[] {
    const records = this.db.prepare(`
      SELECT path FROM data_distributing
      WHERE content_sign = ? AND disable = 0
    `).all(contentSign) as { path: string }[]

    return records.map(r => r.path)
  }
}
