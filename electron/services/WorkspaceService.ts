import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { SystemConfigRepository } from './SystemConfigRepository'
import type { LoggerService } from './LoggerService'

const execAsync = promisify(exec)

/**
 * Shell 接口，用于跨平台快捷方式操作
 */
export interface ShellAdapter {
  writeShortcutLink: (shortcutPath: string, operation: 'create' | 'update' | 'replace', options: { target: string; description?: string }) => boolean
}

/**
 * 工作空间子目录配置
 */
export interface WorkspaceSubdirectory {
  name: string      // 目录名称
  isHidden: boolean // 是否为隐藏目录
}

/**
 * 工作空间初始化结果
 */
export interface WorkspaceInitResult {
  success: boolean
  workspacePath: string | null
  createdNew: boolean       // 是否新建了工作空间
  message: string
}

/**
 * WorkspaceService 选项
 */
export interface WorkspaceServiceOptions {
  systemConfigRepo: SystemConfigRepository
  logger?: LoggerService
  shell?: ShellAdapter // 可选的 shell 适配器，用于创建快捷方式
}

/**
 * 工作空间管理服务
 * 负责检查和初始化用户工作空间目录
 */
export class WorkspaceService {
  private systemConfigRepo: SystemConfigRepository
  private logger?: LoggerService
  private shell?: ShellAdapter
  private readonly MODULE_NAME = 'WorkspaceService'

  /**
   * 预定义的工作空间子目录
   * macOS/Linux 使用点号前缀隐藏，Windows 使用 attrib +h
   */
  static readonly SUBDIRECTORIES: WorkspaceSubdirectory[] = [
    { name: '.核心要件密码柜', isHidden: true },
    { name: '.重要文件档案柜', isHidden: true },
    { name: '.开放文本资料柜', isHidden: true },
    { name: '.个人数据保护区', isHidden: true }
  ]

  /**
   * 工作空间默认名称
   */
  static readonly WORKSPACE_NAME = '我的工作空间'

  constructor(options: WorkspaceServiceOptions) {
    this.systemConfigRepo = options.systemConfigRepo
    this.logger = options.logger
    this.shell = options.shell
  }

  /**
   * 初始化工作空间
   * 检查 system_config 表中的 workspace 值，如果不存在或目录不存在则创建
   */
  async initializeWorkspace(): Promise<WorkspaceInitResult> {
    try {
      this.log('info', '开始检查工作空间配置...')

      // 1. 获取当前配置的工作空间路径
      const currentWorkspace = this.systemConfigRepo.getWorkspace()
      this.log('info', `当前配置的工作空间: ${currentWorkspace || '未配置'}`)

      // 2. 检查配置是否存在且目录是否存在
      if (currentWorkspace && this.directoryExists(currentWorkspace)) {
        this.log('info', '工作空间目录已存在，无需创建')

        // 检查并创建桌面快捷方式（如果不存在）
        await this.ensureDesktopShortcut(currentWorkspace)

        return {
          success: true,
          workspacePath: currentWorkspace,
          createdNew: false,
          message: '工作空间目录已存在'
        }
      }

      // 3. 需要创建新的工作空间
      this.log('info', '需要创建新的工作空间目录...')
      return await this.createWorkspace()

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.log('error', `工作空间初始化失败: ${errorMessage}`)
      return {
        success: false,
        workspacePath: null,
        createdNew: false,
        message: `工作空间初始化失败: ${errorMessage}`
      }
    }
  }

  /**
   * 创建工作空间目录
   */
  private async createWorkspace(): Promise<WorkspaceInitResult> {
    // 1. 创建主工作空间目录
    const homeDir = os.homedir()
    const workspacePath = path.join(homeDir, WorkspaceService.WORKSPACE_NAME)

    this.log('info', `创建工作空间目录: ${workspacePath}`)

    if (!this.directoryExists(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true })
      this.log('info', '主工作空间目录创建成功')
    }

    // 2. 创建子目录
    for (const subdir of WorkspaceService.SUBDIRECTORIES) {
      const subdirPath = path.join(workspacePath, subdir.name)

      if (!this.directoryExists(subdirPath)) {
        fs.mkdirSync(subdirPath, { recursive: true })
        this.log('info', `创建子目录: ${subdir.name}`)

        // 在 macOS/Linux 上设置隐藏属性（以点开头的目录自动隐藏，但我们使用中文名）
        // 对于 Windows，可以使用 attrib 命令
        if (subdir.isHidden && process.platform === 'win32') {
          try {
            await execAsync(`attrib +h "${subdirPath}"`)
            this.log('info', `设置目录隐藏属性: ${subdir.name}`)
          } catch (err) {
            this.log('warn', `设置隐藏属性失败: ${subdir.name}`)
          }
        }
      }
    }

    // 3. 在桌面创建快捷方式
    await this.createDesktopShortcut(workspacePath)

    // 4. 保存工作空间路径到数据库
    this.systemConfigRepo.setWorkspace(workspacePath)
    this.log('info', '工作空间路径已保存到配置')

    return {
      success: true,
      workspacePath,
      createdNew: true,
      message: '工作空间创建成功'
    }
  }

  /**
   * 确保桌面快捷方式存在（检查并创建）
   */
  private async ensureDesktopShortcut(workspacePath: string): Promise<void> {
    this.log('info', '检查桌面快捷方式...')
    await this.createDesktopShortcut(workspacePath)
  }

  /**
   * 在桌面创建工作空间快捷方式
   */
  private async createDesktopShortcut(workspacePath: string): Promise<void> {
    const desktopPath = this.getDesktopPath()

    if (!desktopPath) {
      this.log('warn', '无法获取桌面路径，跳过创建快捷方式')
      return
    }

    const shortcutName = WorkspaceService.WORKSPACE_NAME

    try {
      if (process.platform === 'darwin') {
        // macOS: 创建符号链接
        const linkPath = path.join(desktopPath, shortcutName)
        if (!fs.existsSync(linkPath)) {
          fs.symlinkSync(workspacePath, linkPath, 'dir')
          this.log('info', `桌面快捷方式创建成功: ${linkPath}`)
        } else {
          this.log('info', '桌面快捷方式已存在')
        }
      } else if (process.platform === 'win32') {
        // Windows: 使用 Electron 原生 API 创建快捷方式 (.lnk)
        // 这样可以避免中文路径乱码问题
        const lnkPath = path.join(desktopPath, `${shortcutName}.lnk`)
        if (!fs.existsSync(lnkPath)) {
          if (this.shell) {
            // 使用 Electron shell.writeShortcutLink API
            const success = this.shell.writeShortcutLink(lnkPath, 'create', {
              target: workspacePath,
              description: WorkspaceService.WORKSPACE_NAME
            })
            if (success) {
              this.log('info', `桌面快捷方式创建成功: ${lnkPath}`)
            } else {
              this.log('warn', `桌面快捷方式创建失败`)
            }
          } else {
            this.log('warn', 'Shell 适配器未提供，跳过创建快捷方式')
          }
        } else {
          this.log('info', '桌面快捷方式已存在')
        }
      } else if (process.platform === 'linux') {
        // Linux: 创建符号链接
        const linkPath = path.join(desktopPath, shortcutName)
        if (!fs.existsSync(linkPath)) {
          fs.symlinkSync(workspacePath, linkPath, 'dir')
          this.log('info', `桌面快捷方式创建成功: ${linkPath}`)
        } else {
          this.log('info', '桌面快捷方式已存在')
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.log('warn', `创建桌面快捷方式失败: ${errorMessage}`)
    }
  }

  /**
   * 获取桌面路径
   */
  private getDesktopPath(): string | null {
    const homeDir = os.homedir()

    if (process.platform === 'win32') {
      // Windows
      return path.join(homeDir, 'Desktop')
    } else if (process.platform === 'darwin') {
      // macOS
      return path.join(homeDir, 'Desktop')
    } else if (process.platform === 'linux') {
      // Linux - 尝试多种可能的桌面路径
      const possiblePaths = [
        path.join(homeDir, 'Desktop'),
        path.join(homeDir, '桌面')
      ]
      for (const p of possiblePaths) {
        if (this.directoryExists(p)) {
          return p
        }
      }
      // 默认返回 Desktop
      return path.join(homeDir, 'Desktop')
    }

    return null
  }

  /**
   * 检查目录是否存在
   */
  private directoryExists(dirPath: string): boolean {
    try {
      const stats = fs.statSync(dirPath)
      return stats.isDirectory()
    } catch {
      return false
    }
  }

  /**
   * 获取当前工作空间路径
   */
  getWorkspacePath(): string | null {
    return this.systemConfigRepo.getWorkspace()
  }

  /**
   * 检查工作空间是否有效（存在且可访问）
   */
  isWorkspaceValid(): boolean {
    const workspacePath = this.getWorkspacePath()
    if (!workspacePath) {
      return false
    }
    return this.directoryExists(workspacePath)
  }

  /**
   * 获取工作空间子目录路径
   */
  getSubdirectoryPath(subdirName: string): string | null {
    const workspacePath = this.getWorkspacePath()
    if (!workspacePath) {
      return null
    }
    return path.join(workspacePath, subdirName)
  }

  /**
   * 记录日志
   */
  private log(level: 'info' | 'warn' | 'error', message: string): void {
    if (this.logger) {
      if (level === 'info') {
        this.logger.info(this.MODULE_NAME, message)
      } else if (level === 'warn') {
        this.logger.warn(this.MODULE_NAME, message)
      } else {
        this.logger.error(this.MODULE_NAME, message)
      }
    } else {
      const logFn = level === 'error' ? console.error : (level === 'warn' ? console.warn : console.log)
      logFn(`[${this.MODULE_NAME}] ${message}`)
    }
  }
}
