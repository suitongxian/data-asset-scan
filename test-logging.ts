/**
 * 测试日志级别和 SQL 日志功能
 *
 * 使用方式:
 * 1. 测试默认日志级别: node --loader tsx test-logging.ts
 * 2. 测试 DEBUG 级别: LOG_LEVEL=DEBUG node --loader tsx test-logging.ts
 * 3. 测试 INFO 级别: LOG_LEVEL=INFO node --loader tsx test-logging.ts
 */

import { LoggerService, LogLevel } from './electron/services/LoggerService'
import { DatabaseService } from './electron/services/DatabaseService'
import * as path from 'node:path'
import * as fs from 'node:fs'

// 获取命令行参数设置日志级别
const envLogLevel = process.env.LOG_LEVEL as LogLevel
const testLogLevel: LogLevel = envLogLevel && ['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(envLogLevel)
  ? envLogLevel
  : LogLevel.DEBUG // 默认使用 DEBUG 级别进行测试

console.log('\n===== 测试日志级别功能 =====')
console.log(`设置日志级别: ${testLogLevel}`)
console.log(`环境变量 LOG_LEVEL: ${process.env.LOG_LEVEL || '(未设置)'}`)

// 1. 测试日志级别
const logger = new LoggerService({ level: testLogLevel })

logger.debug('TestModule', '这是一条 DEBUG 日志')
logger.info('TestModule', '这是一条 INFO 日志')
logger.warn('TestModule', '这是一条 WARN 日志')
logger.error('TestModule', '这是一条 ERROR 日志')

// 2. 测试环境变量优先级
console.log('\n===== 测试环境变量优先级 =====')
if (process.env.LOG_LEVEL) {
  console.log(`日志级别已设置为: ${process.env.LOG_LEVEL}`)
} else {
  console.log('未设置 LOG_LEVEL 环境变量，使用默认级别')
}

// 3. 测试数据库 SQL 日志
console.log('\n===== 测试数据库 SQL 日志 =====')

const testDbPath = path.join(process.cwd(), '.runtime', 'test-data.db')
// 清理测试数据库
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath)
  console.log('已清理旧测试数据库')
}

const dbService = new DatabaseService({
  dbPath: testDbPath,
  sqlPath: path.join(process.cwd(), 'electron', 'database.sql')
})

try {
  dbService.init()

  const db = dbService.getDb()

  // 执行一些 SQL 操作来验证日志输出
  db.prepare('SELECT name FROM sqlite_master WHERE type="table"').all()
  db.prepare('SELECT COUNT(*) as count FROM scan_task').get()
  db.prepare('INSERT OR IGNORE INTO user_info (username, real_name, department) VALUES (?, ?, ?)').run('test_user', '测试用户', '测试部门')

  console.log('\nSQL 操作执行完成，请查看上述日志输出')

  dbService.close()

  // 清理测试数据库
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath)
    console.log('已清理测试数据库')
  }
} catch (error) {
  console.error('测试失败:', error)
  process.exit(1)
}

console.log('\n===== 测试完成 =====')
console.log('\n提示:')
console.log('- 设置环境变量 LOG_LEVEL=DEBUG 可以看到 SQL 日志')
console.log('- 设置环境变量 LOG_LEVEL=INFO 将不显示 DEBUG 日志')
console.log('- 设置环境变量 LOG_LEVEL=WARN 将只显示 WARN 和 ERROR 日志')
