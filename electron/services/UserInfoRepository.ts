import type { Database as DatabaseType, Statement } from 'better-sqlite3'
import { getLocalIP, getLocalMAC } from './util/NetworkUtil'

export interface UserInfo {
  id: number
  company_name: string
  user_name: string
  department: string
  ip: string
  mac_address: string
  work_address: string | null
  phone: string | null
  password_md5: string | null
  id_card: string | null
  create_time: string
  update_time: string
  disable: number
}

export interface CreateUserInfoParams {
  company_name: string
  user_name: string
  department: string
  phone?: string | null
  work_address?: string | null
}

export interface UpdateUserInfoParams {
  company_name?: string
  user_name?: string
  department?: string
  phone?: string | null
  work_address?: string | null
}

/**
 * 用户信息数据访问层
 * 用于管理 user_info 表中的用户信息
 */
export class UserInfoRepository {
  private db: DatabaseType
  private getActiveUserStmt: Statement
  private insertStmt: Statement
  private updateStmt: Statement

  constructor(db: DatabaseType) {
    this.db = db
    this.prepareStatements()
  }

  private prepareStatements(): void {
    // 获取当前有效用户（只有一条有效记录）
    this.getActiveUserStmt = this.db.prepare(`
      SELECT * FROM user_info WHERE disable = 0 ORDER BY id DESC LIMIT 1
    `)

    // 插入新用户
    this.insertStmt = this.db.prepare(`
      INSERT INTO user_info (company_name, user_name, department, ip, mac_address, work_address, phone, create_time, update_time, disable)
      VALUES (@company_name, @user_name, @department, @ip, @mac_address, @work_address, @phone, @create_time, @update_time, 0)
    `)

    // 更新用户信息
    this.updateStmt = this.db.prepare(`
      UPDATE user_info
      SET company_name = @company_name,
          user_name = @user_name,
          department = @department,
          ip = @ip,
          mac_address = @mac_address,
          work_address = @work_address,
          phone = @phone,
          update_time = @update_time
      WHERE id = @id AND disable = 0
    `)
  }

  /**
   * 获取当前有效用户信息
   */
  getActiveUser(): UserInfo | null {
    const result = this.getActiveUserStmt.get() as UserInfo | undefined
    return result ?? null
  }

  /**
   * 创建用户信息
   */
  create(params: CreateUserInfoParams): UserInfo {
    const now = new Date().toISOString()
    const result = this.insertStmt.run({
      company_name: params.company_name,
      user_name: params.user_name,
      department: params.department,
      ip: getLocalIP(),
      mac_address: getLocalMAC(),
      work_address: params.work_address || null,
      phone: params.phone || null,
      create_time: now,
      update_time: now
    })

    return this.getById(Number(result.lastInsertRowid))!
  }

  /**
   * 更新用户信息
   */
  update(id: number, params: UpdateUserInfoParams): UserInfo | null {
    const existing = this.getById(id)
    if (!existing) {
      return null
    }

    const now = new Date().toISOString()
    this.updateStmt.run({
      id,
      company_name: params.company_name ?? existing.company_name,
      user_name: params.user_name ?? existing.user_name,
      department: params.department ?? existing.department,
      ip: getLocalIP(),
      mac_address: getLocalMAC(),
      work_address: params.work_address !== undefined ? params.work_address : existing.work_address,
      phone: params.phone !== undefined ? params.phone : existing.phone,
      update_time: now
    })

    return this.getById(id)
  }

  /**
   * 保存用户信息（创建或更新）
   * 如果存在有效用户则更新，否则创建
   */
  save(params: CreateUserInfoParams): UserInfo {
    const existing = this.getActiveUser()
    if (existing) {
      return this.update(existing.id, params)!
    } else {
      return this.create(params)
    }
  }

  /**
   * 根据 ID 获取用户信息
   */
  getById(id: number): UserInfo | null {
    const stmt = this.db.prepare(`
      SELECT * FROM user_info WHERE id = ? AND disable = 0
    `)
    const result = stmt.get(id) as UserInfo | undefined
    return result ?? null
  }

  /**
   * 检查是否存在有效用户
   */
  hasActiveUser(): boolean {
    return this.getActiveUser() !== null
  }
}
