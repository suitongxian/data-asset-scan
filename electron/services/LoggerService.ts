import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'

/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

/**
 * 日志条目接口
 */
interface LogEntry {
  timestamp: string
  level: LogLevel
  module: string
  message: string
  data?: unknown
}

/**
 * 日志服务选项
 */
export interface LoggerServiceOptions {
  logDir?: string        // 自定义日志目录，不指定则自动确定
  level?: LogLevel       // 最低日志级别，默认 INFO
  isProduction?: boolean // 是否生产环境，默认自动检测
}

/**
 * 日志服务类
 * 支持开发环境（.runtime/log）和生产环境（数据库同级目录/log）
 */
export class LoggerService {
  private logDir: string
  private level: LogLevel
  private writeQueue: LogEntry[] = []
  private isWriting = false
  private currentLogFile?: string
  private levelPriority: Record<LogLevel, number> = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.ERROR]: 3
  }

  constructor(options: LoggerServiceOptions = {}) {
    // 优先级: 选项参数 > 环境变量 > 默认 INFO
    const envLogLevel = process.env.LOG_LEVEL as LogLevel
    this.level = options.level ?? (envLogLevel && Object.values(LogLevel).includes(envLogLevel) ? envLogLevel : LogLevel.INFO)
    this.logDir = options.logDir ?? this.getDefaultLogDir(options.isProduction)

    // 确保日志目录存在
    this.ensureLogDir()
  }

  /**
   * 获取默认日志目录
   */
  private getDefaultLogDir(isProduction?: boolean): string {
    // 判断是否为生产环境
    const isProd = isProduction ?? app?.isPackaged ?? false

    if (isProd) {
      // 生产环境：使用数据库同级目录的 log
      // 数据库路径：app.getPath('userData')/data.db
      const userDataPath = app.getPath('userData')
      return path.join(userDataPath, 'log')
    } else {
      // 开发环境：使用项目根目录下的 .runtime/log
      return path.join(process.cwd(), '.runtime', 'log')
    }
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDir(): void {
    if (!fsSync.existsSync(this.logDir)) {
      fsSync.mkdirSync(this.logDir, { recursive: true })
    }
  }

  /**
   * 获取北京时间的日期字符串 (YYYY-MM-DD)
   */
  private getBeijingDateString(date: Date): string {
    // 转换成北京时间（UTC+8）
    const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000)
    // 用 UTC 方式获取年月日（因为已经加了8小时）
    const year = beijingTime.getUTCFullYear()
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0')
    const day = String(beijingTime.getUTCDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  /**
   * 获取北京时间的时间戳字符串 (YYYY-MM-DDTHH:mm:ss.sss+08:00)
   */
  private getBeijingTimestampString(date: Date): string {
    // 转换成北京时间（UTC+8）
    const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000)
    // 用 UTC 方式获取各部分（因为已经加了8小时）
    const year = beijingTime.getUTCFullYear()
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0')
    const day = String(beijingTime.getUTCDate()).padStart(2, '0')
    const hours = String(beijingTime.getUTCHours()).padStart(2, '0')
    const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0')
    const seconds = String(beijingTime.getUTCSeconds()).padStart(2, '0')
    const milliseconds = String(beijingTime.getUTCMilliseconds()).padStart(3, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}+08:00`
  }

  /**
   * 获取日志文件路径
   * 按日期分割日志文件：app-YYYY-MM-DD.log
   */
  private getLogFilePath(level: LogLevel): string {
    const date = this.getBeijingDateString(new Date())
    return path.join(this.logDir, `app-${date}.log`)
  }

  /**
   * 格式化日志条目
   */
  private formatLogEntry(entry: LogEntry): string {
    const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : ''
    return `[${entry.timestamp}] [${entry.level}] [${entry.module}] ${entry.message}${dataStr}`
  }

  /**
   * 将日志条目写入队列并触发写入
   */
  private async write(entry: LogEntry): Promise<void> {
    // 检查日志级别
    if (this.levelPriority[entry.level] < this.levelPriority[this.level]) {
      return
    }

    this.writeQueue.push(entry)

    // 同时输出到控制台
    const formatted = this.formatLogEntry(entry)
    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(formatted)
        break
      case LogLevel.WARN:
        console.warn(formatted)
        break
      case LogLevel.DEBUG:
        console.debug(formatted)
        break
      default:
        console.log(formatted)
    }

    // 触发写入
    this.flush()
  }

  /**
   * 刷新写入队列
   */
  private async flush(): Promise<void> {
    if (this.isWriting || this.writeQueue.length === 0) {
      return
    }

    this.isWriting = true
    const entries = [...this.writeQueue]
    this.writeQueue = []

    try {
      // 按日期分组（使用北京时间）
      const groupedByDate = new Map<string, LogEntry[]>()
      for (const entry of entries) {
        // 从北京时间戳中提取日期部分
        const date = entry.timestamp.split('T')[0]
        if (!groupedByDate.has(date)) {
          groupedByDate.set(date, [])
        }
        groupedByDate.get(date)!.push(entry)
      }

      // 写入各个日期的日志文件
      for (const [date, dateEntries] of groupedByDate) {
        const filePath = path.join(this.logDir, `app-${date}.log`)
        const lines = dateEntries.map(e => this.formatLogEntry(e)).join('\n') + '\n'

        try {
          await fs.appendFile(filePath, lines, 'utf-8')
        } catch (error) {
          // 写入失败，回退到控制台
          console.error(`Failed to write log to ${filePath}:`, error)
        }
      }
    } finally {
      this.isWriting = false

      // 如果队列中还有新条目，继续写入
      if (this.writeQueue.length > 0) {
        this.flush().catch(err => console.error('Flush error:', err))
      }
    }
  }

  /**
   * 获取当前时间戳（北京时间）
   */
  private getTimestamp(): string {
    return this.getBeijingTimestampString(new Date())
  }

  /**
   * 记录 DEBUG 日志
   */
  debug(module: string, message: string, data?: unknown): void {
    this.write({
      timestamp: this.getTimestamp(),
      level: LogLevel.DEBUG,
      module,
      message,
      data
    }).catch(err => console.error('Debug log error:', err))
  }

  /**
   * 记录 INFO 日志
   */
  info(module: string, message: string, data?: unknown): void {
    this.write({
      timestamp: this.getTimestamp(),
      level: LogLevel.INFO,
      module,
      message,
      data
    }).catch(err => console.error('Info log error:', err))
  }

  /**
   * 记录 WARN 日志
   */
  warn(module: string, message: string, data?: unknown): void {
    this.write({
      timestamp: this.getTimestamp(),
      level: LogLevel.WARN,
      module,
      message,
      data
    }).catch(err => console.error('Warn log error:', err))
  }

  /**
   * 记录 ERROR 日志
   */
  error(module: string, message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    let errorData: Record<string, unknown> = data || {}
    if (error instanceof Error) {
      errorData = {
        ...data,
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack
      }
    } else if (error) {
      errorData = { ...data, error: String(error) }
    }

    this.write({
      timestamp: this.getTimestamp(),
      level: LogLevel.ERROR,
      module,
      message,
      data: errorData
    }).catch(err => console.error('Error log error:', err))
  }

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.level = level
  }

  /**
   * 关闭日志服务，确保所有日志写入完成
   */
  async close(): Promise<void> {
    while (this.writeQueue.length > 0 || this.isWriting) {
      await this.flush()
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}

/**
 * 创建日志实例的单例工厂
 */
let loggerInstance: LoggerService | null = null

export function createLogger(options?: LoggerServiceOptions): LoggerService {
  if (!loggerInstance) {
    loggerInstance = new LoggerService(options)
  }
  return loggerInstance
}

export function getLogger(): LoggerService {
  if (!loggerInstance) {
    loggerInstance = new LoggerService()
  }
  return loggerInstance
}

export function resetLogger(): void {
  loggerInstance = null
}
