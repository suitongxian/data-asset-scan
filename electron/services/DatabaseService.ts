// @ts-nocheck
import type { Database as DatabaseType, Statement as StatementType } from 'better-sqlite3'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getLogger, LogLevel } from './LoggerService'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const Database = require('better-sqlite3')
const logger = getLogger()

export interface DatabaseServiceOptions {
  dbPath?: string
  sqlPath?: string
}

/**
 * Statement 包装器，拦截所有执行方法并打印 SQL 日志
 */
class StatementWrapper {
  private readonly original: StatementType
  private readonly sql: string

  constructor(original: StatementType, sql: string) {
    this.original = original
    this.sql = sql
  }

  run(...args: any[]): any {
    logger.debug('DatabaseService', `执行 SQL (run): ${this.sql}`, { args: this.sanitizeArgs(args) })
    return this.original.run(...args)
  }

  get(...args: any[]): any {
    logger.debug('DatabaseService', `执行 SQL (get): ${this.sql}`, { args: this.sanitizeArgs(args) })
    return this.original.get(...args)
  }

  all(...args: any[]): any {
    logger.debug('DatabaseService', `执行 SQL (all): ${this.sql}`, { args: this.sanitizeArgs(args) })
    return this.original.all(...args)
  }

  iterate(...args: any[]): any {
    logger.debug('DatabaseService', `执行 SQL (iterate): ${this.sql}`, { args: this.sanitizeArgs(args) })
    return this.original.iterate(...args)
  }

  raw(...args: any[]): any {
    logger.debug('DatabaseService', `执行 SQL (raw): ${this.sql}`, { args: this.sanitizeArgs(args) })
    return this.original.raw(...args)
  }

  /**
   * 委托其他属性到原始 Statement
   */
  get database(): any {
    return this.original.database
  }

  get busy(): any {
    return this.original.busy
  }

  get pluck(): any {
    return this.original.pluck
  }

  set pluck(value: any) {
    this.original.pluck = value
  }

  get expand(): any {
    return this.original.expand
  }

  set expand(value: any) {
    this.original.expand = value
  }

  get columns(): any {
    return this.original.columns
  }

  get readonly(): any {
    return this.original.readonly
  }

  get source(): any {
    return this.original.source
  }

  /**
   * 敏感信息过滤（避免打印密码等敏感数据）
   */
  private sanitizeArgs(args: unknown[]): unknown[] {
    return args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        const sanitized: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(arg as Record<string, unknown>)) {
          // 过滤可能包含敏感信息的字段
          if (key.toLowerCase().includes('password') || key.toLowerCase().includes('token') || key.toLowerCase().includes('secret')) {
            sanitized[key] = '***'
          } else {
            sanitized[key] = value
          }
        }
        return sanitized
      }
      return arg
    })
  }
}

/**
 * Database 包装器，拦截 prepare 和 exec 方法
 */
class DatabaseWrapper {
  private readonly original: DatabaseType

  constructor(original: DatabaseType) {
    this.original = original
  }

  prepare(sql: string): StatementType {
    return new StatementWrapper(this.original.prepare(sql), sql) as any
  }

  exec(sql: string): any {
    // 对于 exec 执行的多条 SQL，简化日志输出
    const trimmedSql = sql.trim()
    const preview = trimmedSql.length > 200 ? trimmedSql.substring(0, 200) + '...' : trimmedSql
    logger.debug('DatabaseService', `执行 SQL (exec): ${preview}`)
    return this.original.exec(sql)
  }

  transaction<T>(fn: (...args: any[]) => T): any {
    const wrappedFn = (...args: any[]) => {
      logger.debug('DatabaseService', '开始事务')
      try {
        const result = fn(...args)
        logger.debug('DatabaseService', '提交事务')
        return result
      } catch (error) {
        logger.debug('DatabaseService', '回滚事务')
        throw error
      }
    }
    return this.original.transaction(wrappedFn)
  }

  pragma(...args: any[]): any {
    logger.debug('DatabaseService', `执行 PRAGMA: ${args[0]}`)
    return this.original.pragma(...(args as any))
  }

  function(...args: any[]): any {
    return this.original.function(...(args as any))
  }

  aggregate(...args: any[]): any {
    return this.original.aggregate(...(args as any))
  }

  table(...args: any[]): any {
    return this.original.table(...(args as any))
  }

  loadExtension(...args: any[]): any {
    return this.original.loadExtension(...(args as any))
  }

  close(...args: any[]): any {
    return this.original.close(...(args as any))
  }

  /**
   * 委托其他属性到原始 Database
   */
  get memory(): any {
    return this.original.memory
  }

  get defaultSafeIntegers(): any {
    return this.original.defaultSafeIntegers
  }

  set defaultSafeIntegers(value: any) {
    this.original.defaultSafeIntegers = value
  }

  get open(): boolean {
    return this.original.open
  }

  get inTransaction(): boolean {
    return this.original.inTransaction
  }

  get readonly(): boolean {
    return this.original.readonly
  }

  get name(): string {
    return this.original.name
  }

  unsafeMode(...args: any[]): any {
    return this.original.unsafeMode(...(args as any))
  }

  serialize(...args: any[]): any {
    return this.original.serialize(...(args as any))
  }

  backup(...args: any[]): any {
    return this.original.backup(...(args as any))
  }
}

export class DatabaseService {
  private db: DatabaseType | null = null
  private dbPath: string
  private sqlPath: string

  constructor(options: DatabaseServiceOptions = {}) {
    if (options.dbPath) {
      this.dbPath = options.dbPath
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron')
      const db_version="2"
      // 开发模式下使用项目 .runtime 目录，方便开发测试
      if (!app.isPackaged) {
        this.dbPath = path.join(process.cwd(), '.runtime', `data.db`)
      } else {
        const userDataPath = app.getPath('userData')
        this.dbPath = path.join(userDataPath, `data_${db_version}.db`)
      }
    }
    this.sqlPath = options.sqlPath || path.join(__dirname, 'database.sql')
  }

  init(): void {
    const dbExists = fs.existsSync(this.dbPath)

    // 确保目录存在
    const dbDir = path.dirname(this.dbPath)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
      logger.info('DatabaseService', `创建数据库目录: ${dbDir}`)
    }

    try {
      this.db = new Database(this.dbPath)
      logger.info('DatabaseService', `数据库已连接`, { dbPath: this.dbPath })

      if (!dbExists) {
        logger.info('DatabaseService', '数据库文件不存在，开始初始化表结构...')
        this.createTables()
      } else {
        logger.info('DatabaseService', '数据库已存在，跳过初始化')
      }
    } catch (error) {
      logger.error('DatabaseService', '数据库初始化失败', error)
      throw error
    }
  }

  private createTables(): void {
    if (!fs.existsSync(this.sqlPath)) {
      logger.error('DatabaseService', `建表脚本不存在`, null, { sqlPath: this.sqlPath })
      throw new Error(`建表脚本不存在: ${this.sqlPath}`)
    }

    const sql = fs.readFileSync(this.sqlPath, 'utf-8')
    logger.info('DatabaseService', '读取建表脚本', { sqlPath: this.sqlPath })

    // 移除 SQL 注释（-- 开头的行）
    const sqlWithoutComments = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')

    // 按分号分割并执行每条语句
    const statements = sqlWithoutComments
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0)

    let successCount = 0
    for (const statement of statements) {
      try {
        this.db!.exec(statement)
        successCount++
      } catch (error) {
        logger.error('DatabaseService', '执行SQL失败', error, { statement })
        throw error
      }
    }

    logger.info('DatabaseService', '数据库表创建完成', { statementCount: successCount })
  }

  getDb(): DatabaseType {
    if (!this.db) {
      logger.error('DatabaseService', '数据库未初始化，无法获取数据库实例')
      throw new Error('数据库未初始化')
    }
    // 返回包装后的数据库实例，自动拦截所有 SQL 操作
    return new DatabaseWrapper(this.db) as any
  }

  /**
   * 获取原始数据库实例（绕过包装器，用于内部使用）
   */
  getRawDb(): DatabaseType {
    if (!this.db) {
      throw new Error('数据库未初始化')
    }
    return this.db
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      logger.info('DatabaseService', '数据库连接已关闭')
    }
  }
}
