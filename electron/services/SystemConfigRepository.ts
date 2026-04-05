import type { Database as DatabaseType, Statement } from 'better-sqlite3'
import type { ConfigService } from './ConfigService'

export interface SystemConfig {
  id: number
  key: string
  type: string
  value: string | null
  describe: string | null
  create_time: string
  update_time: string
  disable: number
}

/**
 * 系统配置数据访问层
 * 用于管理 system_config 表中的配置项
 * 支持从 ConfigService 回退取值
 */
export class SystemConfigRepository {
  private db: DatabaseType
  private insertStmt: Statement
  private updateValueStmt: Statement
  private configService: ConfigService | null = null

  // 预定义的配置键
  static readonly KEYS = {
    FULL_INVENTORY_TIME: 'FULL_INVENTORY_TIME',  // 首次普查时间
    SAVE_CODE: 'save_code',                       // 安全操作码
    CONTROL_TYPE: 'control_type',                 // 默认管控列表
    DAILY_SCAN_INTERVAL: 'daily_scan_interval',  // 日常盘点扫描间隔时间（分钟）
    WORKSPACE: 'workspace',                       // 工作空间目录
    LAST_SCAN_TIME: 'last_scan_time',            // 最后扫描时间
    SCAN_AREA_PATH: 'scan_area_path',            // 扫描区域路径
    SCAN_EXCLUDE_DIR: 'scan_exclude_dir',        // 扫描排除目录
    UPLOAD_SERVER_URL: 'upload_server_url',       // 文件上传服务器地址
    LAST_SYNC_TIME: 'last_sync_time',             // 最后同步时间
    ALL_TERMINAL_USERS: 'all_terminal_users'      // 所有终端用户信息
  } as const

  constructor(db: DatabaseType, configService?: ConfigService) {
    this.db = db
    this.configService = configService ?? null
    this.prepareStatements()
  }

  /**
   * 设置 ConfigService 实例（用于延迟注入）
   */
  setConfigService(configService: ConfigService): void {
    this.configService = configService
  }

  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT INTO system_config (key, type, value, describe, create_time, update_time, disable)
      VALUES (@key, @type, @value, @describe, @create_time, @update_time, 0)
    `)

    this.updateValueStmt = this.db.prepare(`
      UPDATE system_config
      SET value = @value, update_time = @update_time
      WHERE key = @key AND disable = 0
    `)
  }

  /**
   * 根据键获取配置（每次都从数据库读取最新值，不使用缓存）
   */
  getByKey(key: string): SystemConfig | null {
    const result = this.db.prepare(`
      SELECT * FROM system_config WHERE key = ? AND disable = 0
    `).get(key) as SystemConfig | undefined
    return result ?? null
  }

  /**
   * 获取配置值（如果数据库没有值，从 ConfigService 回退）
   */
  getValue(key: string): string | null {
    const config = this.getByKey(key)
    if (config !== null && config.value !== null && config.value !== undefined && config.value !== '') {
      return config.value
    }

    // 从 ConfigService 回退取值
    return this.getValueFromConfigService(key)
  }

  /**
   * 从 ConfigService 获取配置值
   */
  private getValueFromConfigService(key: string): string | null {
    if (!this.configService) {
      return null
    }

    // 直接使用 getStringValue 方法获取值
    return this.configService.getStringValue(key)
  }

  /**
   * 设置或更新配置值
   */
  setValue(key: string, value: string, describe?: string): void {
    const now = new Date().toISOString()
    const existing = this.getByKey(key)

    if (existing) {
      this.updateValueStmt.run({
        key,
        value,
        update_time: now
      })
    } else {
      this.insertStmt.run({
        key,
        type: 'string',
        value,
        describe: describe || null,
        create_time: now,
        update_time: now
      })
    }
  }

  /**
   * 检查配置是否存在
   */
  exists(key: string): boolean {
    return this.getByKey(key) !== null
  }

  /**
   * 获取首次普查时间
   */
  getFullInventoryTime(): string | null {
    return this.getValue(SystemConfigRepository.KEYS.FULL_INVENTORY_TIME)
  }

  /**
   * 设置首次普查时间
   */
  setFullInventoryTime(time: string): void {
    this.setValue(
      SystemConfigRepository.KEYS.FULL_INVENTORY_TIME,
      time,
      '首次普查完成时间（历史封帐时间）'
    )
  }

  /**
   * 检查是否已进行首次普查
   */
  hasFullInventory(): boolean {
    return this.exists(SystemConfigRepository.KEYS.FULL_INVENTORY_TIME)
  }

  /**
   * 获取安全操作码（数据库优先，不存在则从 ConfigService 回退）
   */
  getSaveCode(): string | null {
    return this.getValue(SystemConfigRepository.KEYS.SAVE_CODE)
  }

  /**
   * 设置安全操作码
   */
  setSaveCode(code: string): void {
    this.setValue(
      SystemConfigRepository.KEYS.SAVE_CODE,
      code,
      '安全操作码'
    )
  }

  /**
   * 验证安全操作码
   */
  verifySaveCode(code: string): boolean {
    const storedCode = this.getSaveCode()
    return storedCode !== null && storedCode === code
  }

  /**
   * 获取工作空间目录（数据库优先，不存在则从 ConfigService 回退）
   */
  getWorkspace(): string | null {
    return this.getValue(SystemConfigRepository.KEYS.WORKSPACE)
  }

  /**
   * 设置工作空间目录
   */
  setWorkspace(path: string): void {
    this.setValue(
      SystemConfigRepository.KEYS.WORKSPACE,
      path,
      '工作空间目录'
    )
  }

  /**
   * 获取最后扫描时间
   */
  getLastScanTime(): string | null {
    return this.getValue(SystemConfigRepository.KEYS.LAST_SCAN_TIME)
  }

  /**
   * 设置最后扫描时间
   */
  setLastScanTime(time: string): void {
    this.setValue(
      SystemConfigRepository.KEYS.LAST_SCAN_TIME,
      time,
      '最后扫描时间'
    )
  }

  /**
   * 获取日常盘点扫描间隔（分钟）
   * 数据库优先，不存在则从 ConfigService 回退（默认15分钟）
   */
  getDailyScanInterval(): number {
    const value = this.getValue(SystemConfigRepository.KEYS.DAILY_SCAN_INTERVAL)
    return value ? parseInt(value, 10) : 15
  }

  /**
   * 设置日常盘点扫描间隔（分钟）
   */
  setDailyScanInterval(minutes: number): void {
    this.setValue(
      SystemConfigRepository.KEYS.DAILY_SCAN_INTERVAL,
      String(minutes),
      '日常盘点扫描间隔时间（分钟）'
    )
  }

  /**
   * 获取扫描区域路径（数据库优先，不存在则从 ConfigService 回退）
   */
  getScanAreaPath(): string | null {
    return this.getValue(SystemConfigRepository.KEYS.SCAN_AREA_PATH)
  }

  /**
   * 设置扫描区域路径
   */
  setScanAreaPath(path: string): void {
    this.setValue(
      SystemConfigRepository.KEYS.SCAN_AREA_PATH,
      path,
      '扫描区域路径'
    )
  }

  /**
   * 获取扫描排除目录（逗号分隔）
   * 数据库优先，不存在则从 ConfigService 回退
   */
  getScanExcludeDir(): string | null {
    return this.getValue(SystemConfigRepository.KEYS.SCAN_EXCLUDE_DIR)
  }

  /**
   * 设置扫描排除目录（逗号分隔）
   */
  setScanExcludeDir(dirs: string): void {
    this.setValue(
      SystemConfigRepository.KEYS.SCAN_EXCLUDE_DIR,
      dirs,
      '扫描排除目录（逗号分隔）'
    )
  }

  /**
   * 获取管控文件类型（逗号分隔）
   * 数据库优先，不存在则从 ConfigService 回退
   */
  getControlType(): string | null {
    return this.getValue(SystemConfigRepository.KEYS.CONTROL_TYPE)
  }

  /**
   * 设置管控文件类型（逗号分隔）
   */
  setControlType(types: string): void {
    this.setValue(
      SystemConfigRepository.KEYS.CONTROL_TYPE,
      types,
      '管控文件类型（逗号分隔）'
    )
  }

  /**
   * 获取文件上传服务器地址
   */
  getUploadServerUrl(): string | null {
    return this.getValue(SystemConfigRepository.KEYS.UPLOAD_SERVER_URL)
  }

  /**
   * 设置文件上传服务器地址
   */
  setUploadServerUrl(url: string): void {
    this.setValue(
      SystemConfigRepository.KEYS.UPLOAD_SERVER_URL,
      url,
      '文件上传服务器地址'
    )
  }

  /**
   * 获取最后同步时间
   */
  getLastSyncTime(): string | null {
    return this.getValue(SystemConfigRepository.KEYS.LAST_SYNC_TIME)
  }

  /**
   * 设置最后同步时间
   */
  setLastSyncTime(time: string): void {
    this.setValue(
      SystemConfigRepository.KEYS.LAST_SYNC_TIME,
      time,
      '最后同步时间'
    )
  }

  /**
   * 获取所有终端用户信息（JSON 字符串）
   */
  getAllTerminalUsers(): string | null {
    return this.getValue(SystemConfigRepository.KEYS.ALL_TERMINAL_USERS)
  }

  /**
   * 设置所有终端用户信息（JSON 字符串）
   */
  setAllTerminalUsers(jsonValue: string): void {
    this.setValue(
      SystemConfigRepository.KEYS.ALL_TERMINAL_USERS,
      jsonValue,
      '所有终端用户信息'
    )
  }

  /**
   * 获取所有配置项
   */
  getAll(): SystemConfig[] {
    return this.db.prepare(`
      SELECT * FROM system_config WHERE disable = 0
    `).all() as SystemConfig[]
  }

  /**
   * 获取多个配置（用于批量读取）
   */
  getMultiple(keys: string[]): Record<string, string | null> {
    const result: Record<string, string | null> = {}
    for (const key of keys) {
      result[key] = this.getValue(key)
    }
    return result
  }
}
