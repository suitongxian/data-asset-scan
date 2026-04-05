import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse } from 'yaml'
import { getLogger } from './LoggerService'

const logger = getLogger()

export interface AppConfig {
  control_type: string
  save_code?: string
  daily_scan_interval?: number  // 日常盘点扫描间隔时间（分钟）
  scan_area_path?: string       // 扫描区域路径
  workspace?: string            // 工作空间目录
  scan_exclude_dir?: string     // 扫描排除目录
}

export interface ConfigServiceOptions {
  configPath?: string
}

export class ConfigService {
  private config: AppConfig | null = null
  private origin: Record<string, any> | null = null
  private configPath: string

  constructor(options: ConfigServiceOptions | string = {}) {
    // 兼容旧的字符串参数形式
    if (typeof options === 'string') {
      this.configPath = options
    } else {
      this.configPath = options.configPath || path.join(__dirname, '..', 'config.yaml')
    }
  }

  /**
   * 设置配置文件路径（用于延迟初始化）
   */
  setConfigPath(configPath: string): void {
    this.configPath = configPath
    // 清空缓存，下次获取时重新加载
    this.config = null
  }

  /**
   * 加载 yaml 配置文件
   */
  private loadYamlConfig(): AppConfig {
    if (!fs.existsSync(this.configPath)) {
      logger.error('ConfigService', '配置文件不存在', null, { configPath: this.configPath })
      throw new Error(`配置文件不存在: ${this.configPath}`)
    }

    const content = fs.readFileSync(this.configPath, 'utf-8')
    this.origin=parse(content);
    logger.info('ConfigService', '配置文件加载成功', { configPath: this.configPath })
    return this.origin as AppConfig
  }

  /**
   * 加载配置（只从 yaml 配置文件读取）
   */
  load(): AppConfig {
    if (this.config) {
      return this.config
    }

    this.config = this.loadYamlConfig()
    logger.info('ConfigService', '配置已加载', { config: this.config })
    return this.config
  }

  get(): AppConfig {
    if (!this.config) {
      return this.load()
    }
    return this.config
  }

  getControlTypes(): string[] {
    const config = this.get()
    return config.control_type.split(',').map(t => t.trim())
  }

  /**
   * 获取安全操作码
   */
  getSaveCode(): string | undefined {
    return this.get().save_code
  }

  /**
   * 获取日常盘点扫描间隔时间（分钟）
   */
  getDailyScanInterval(): number | undefined {
    return this.get().daily_scan_interval
  }

  /**
   * 获取扫描区域路径
   */
  getScanAreaPath(): string | undefined {
    return this.get().scan_area_path
  }

  /**
   * 获取工作空间目录
   */
  getWorkspace(): string | undefined {
    return this.get().workspace
  }

  /**
   * 获取扫描排除目录
   */
  getScanExcludeDir(): string | undefined {
    return this.get().scan_exclude_dir
  }

  /**
   * 根据键获取配置值（返回字符串或 null）
   */
  getStringValue(key: string): string | null {
    this.load()
    if (!this.origin) {
      return null
    }
    const value = this.origin[key]
    if (value === undefined || value === null) {
      return null
    }
    return String(value)
  }
}
