import type { Database as DatabaseType } from 'better-sqlite3'
import { DataResourcesRepository } from './DataResourcesRepository'
import { DataDistributingRepository } from './DataDistributingRepository'
import { getLogger } from './LoggerService'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { SystemConfigRepository } from './SystemConfigRepository'

const logger = getLogger()

/**
 * 归类保护参数
 */
export interface ClassifyParams {
  data_resources_id: number
  importance_level: number  // 1=保密柜(核心要件) 2=档案柜(重要文件) 3=资料柜(一般文件) 5=不予归档
  resources_name?: string
  resources_desc?: string
  content_subject?: string
}

/**
 * 归类保护结果
 */
export interface ClassifyResult {
  success: boolean
  message: string
  data?: {
    id: number
    filePath?: string
  }
}

/**
 * 归类保护服务
 * 负责处理信息资源的归类保护操作
 */
export class ResourceClassifyService {
  private db: DatabaseType
  private dataResourcesRepo: DataResourcesRepository | null = null
  private dataDistributingRepo: DataDistributingRepository | null = null
  private configRepo: SystemConfigRepository | null = null

  /**
   * 归档目录名称映射
   */
  private static readonly ARCHIVE_DIR_MAP: Record<number, string> = {
    1: '.核心要件密码柜',
    2: '.重要文件档案柜',
    3: '.开放文本资料柜'
  }

  constructor(db: DatabaseType, configRepo?: SystemConfigRepository) {
    this.db = db
    this.dataResourcesRepo = new DataResourcesRepository(db)
    this.dataDistributingRepo = new DataDistributingRepository(db)
    this.configRepo = configRepo || null
  }

  /**
   * 设置配置仓库（延迟注入）
   */
  setConfigRepository(configRepo: SystemConfigRepository): void {
    this.configRepo = configRepo
  }

  /**
   * 生成唯一的文件名（处理重复问题）
   * @param fileName 原始文件名
   * @param targetDir 目标目录
   * @returns 唯一的文件名
   */
  private async generateUniqueFileName(fileName: string, targetDir: string): Promise<string> {
    const ext = path.extname(fileName)
    const baseName = path.basename(fileName, ext)

    // 检查原始文件名是否存在
    const originalPath = path.join(targetDir, fileName)
    try {
      await fs.access(originalPath)
      // 文件存在，需要生成新文件名
      let counter = 1
      while (true) {
        const newName = `${baseName}_${counter}${ext}`
        const newPath = path.join(targetDir, newName)
        try {
          await fs.access(newPath)
          counter++
        } catch {
          return newName
        }
      }
    } catch {
      // 文件不存在，直接返回原始文件名
      return fileName
    }
  }

  /**
   * 拷贝文件到归档目录
   * @param sourcePath 源文件路径
   * @param importanceLevel 重要程度 (1, 2, 3)
   * @returns 拷贝结果
   */
  private async copyFileToArchive(sourcePath: string, importanceLevel: number): Promise<{ success: boolean; targetPath?: string; error?: string }> {
    if (!this.configRepo) {
      return { success: false, error: '配置仓库未初始化' }
    }

    const targetDirName = ResourceClassifyService.ARCHIVE_DIR_MAP[importanceLevel]
    if (!targetDirName) {
      return { success: false, error: `不支持的归档级别: ${importanceLevel}` }
    }

    // 获取工作空间路径
    const workspacePath = this.configRepo.getWorkspace()
    if (!workspacePath) {
      return { success: false, error: '工作空间未配置' }
    }

    // 构建目标目录路径
    const targetDir = path.join(workspacePath, targetDirName)

    // 确保目标目录存在
    try {
      await fs.mkdir(targetDir, { recursive: true })
    } catch (error) {
      logger.error('ResourceClassifyService', '创建归档目录失败', error, { targetDir })
      return { success: false, error: `创建归档目录失败: ${error instanceof Error ? error.message : '未知错误'}` }
    }

    // 检查源文件是否存在
    try {
      await fs.access(sourcePath)
    } catch {
      return { success: false, error: `源文件不存在: ${sourcePath}` }
    }

    // 获取文件名并生成唯一文件名
    const fileName = path.basename(sourcePath)
    const uniqueFileName = await this.generateUniqueFileName(fileName, targetDir)
    const targetPath = path.join(targetDir, uniqueFileName)

    // 拷贝文件
    try {
      await fs.copyFile(sourcePath, targetPath)
      logger.info('ResourceClassifyService', '文件拷贝成功', { sourcePath, targetPath })
      return { success: true, targetPath }
    } catch (error) {
      logger.error('ResourceClassifyService', '文件拷贝失败', error, { sourcePath, targetPath })
      return { success: false, error: `文件拷贝失败: ${error instanceof Error ? error.message : '未知错误'}` }
    }
  }

  /**
   * 单条归类保护
   * 更新 data_resources 表中的归类保护相关信息
   * @param params 归类保护参数
   * @returns 归类保护结果
   */
  async classifyResource(params: ClassifyParams): Promise<ClassifyResult> {
    if (!this.dataResourcesRepo) {
      logger.error('ResourceClassifyService', 'DataResourcesRepository 未初始化')
      return { success: false, message: '数据访问层未初始化' }
    }

    const { data_resources_id, importance_level, resources_name, resources_desc, content_subject } = params

    // 验证重要程度值范围 (1-3, 5)
    const validValues = [1, 2, 3, 5]
    if (!validValues.includes(importance_level)) {
      logger.warn('ResourceClassifyService', '无效的重要程度值', { importance_level })
      return { success: false, message: '重要程度值无效，有效值为 1, 2, 3, 5' }
    }

    // 获取资源记录
    const resource = this.dataResourcesRepo.getById(data_resources_id)
    if (!resource) {
      logger.warn('ResourceClassifyService', '资源不存在', { data_resources_id })
      return { success: false, message: '资源不存在' }
    }

    // 验证认领状态是否为个人工作数据 (claim_status = 2)
    if (resource.claim_status !== 2) {
      logger.warn('ResourceClassifyService', '只能对个人工作数据进行归类保护', {
        data_resources_id,
        claim_status: resource.claim_status
      })
      return { success: false, message: '只能对个人工作数据进行归类保护' }
    }

    const now = new Date().toISOString()

    // 更新归类保护信息
    try {
      const stmt = this.db.prepare(`
        UPDATE data_resources
        SET
          importance_level = @importance_level,
          resources_name = @resources_name,
          resources_desc = @resources_desc,
          content_subject = @content_subject,
          update_time = @update_time
        WHERE data_resources_id = @id AND disable = 0
      `)

      const result = stmt.run({
        importance_level,
        resources_name: resources_name ?? null,
        resources_desc: resources_desc ?? null,
        content_subject: content_subject ?? null,
        update_time: now,
        id: data_resources_id
      })

      if (result.changes === 0) {
        logger.warn('ResourceClassifyService', '归类保护更新失败，记录未找到或已禁用', { data_resources_id })
        return { success: false, message: '归类保护更新失败' }
      }

      logger.info('ResourceClassifyService', '归类保护成功', {
        data_resources_id,
        importance_level,
        resources_name
      })

      // 如果是归档操作 (importance_level = 1, 2, 3)，进行文件拷贝
      let targetPath: string | undefined
      if ([1, 2, 3].includes(importance_level)) {
        const sourcePath = this.getFilePathByContentSign(resource.content_sign)
        if (sourcePath) {
          const copyResult = await this.copyFileToArchive(sourcePath, importance_level)
          if (copyResult.success) {
            targetPath = copyResult.targetPath
          } else {
            // 文件拷贝失败，但不影响归类保护的成功状态
            logger.warn('ResourceClassifyService', '文件拷贝失败，但归类保护已完成', {
              error: copyResult.error,
              sourcePath,
              importance_level
            })
          }
        } else {
          logger.warn('ResourceClassifyService', '无法找到源文件路径', { content_sign: resource.content_sign })
        }
      }

      return {
        success: true,
        message: '归类保护成功',
        data: {
          id: data_resources_id,
          filePath: targetPath
        }
      }
    } catch (error) {
      logger.error('ResourceClassifyService', '归类保护失败', error, { params })
      return {
        success: false,
        message: error instanceof Error ? error.message : '归类保护失败'
      }
    }
  }

  /**
   * 获取资源对应的文件路径
   * @param contentSign 内容签名
   * @returns 文件路径，如果找不到返回 null
   */
  getFilePathByContentSign(contentSign: string): string | null {
    if (!this.dataDistributingRepo) {
      return null
    }

    const records = this.dataDistributingRepo.getByContentSign(contentSign)
    if (records && records.length > 0) {
      // 返回第一个记录的路径
      return records[0].path
    }

    return null
  }
}
