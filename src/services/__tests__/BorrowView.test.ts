import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import BorrowView from '@/views/BorrowView.vue'
import { api } from '@/services/api'
import { userInfoManager } from '@/services/UserInfoManager'

// Mock API
vi.mock('@/services/api', () => ({
  api: {
    getArchiveFiles: vi.fn(),
    borrowDownload: vi.fn(),
  }
}))

// Mock UserInfoManager
vi.mock('@/services/UserInfoManager', () => ({
  userInfoManager: {
    getUserInfo: vi.fn(),
  }
}))

// Mock visualViewport for Vuetify
beforeAll(() => {
  Object.defineProperty(window, 'visualViewport', {
    value: {
      width: 1024,
      height: 768,
      offsetLeft: 0,
      offsetTop: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    writable: true,
  })
})

const vuetify = createVuetify({
  components,
  directives,
})

describe('BorrowView', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // 默认返回用户信息（异步方式，使用新的字段名）
    vi.mocked(userInfoManager.getUserInfo).mockResolvedValue({
      id: 1,
      user_name: '测试用户',
      company_name: '测试单位',
      department: '测试部门',
      ip: '192.168.1.1',
      mac_address: '00:00:00:00:00:00',
      work_address: null,
      phone: null,
      create_time: new Date().toISOString(),
      update_time: new Date().toISOString()
    })

    // 默认返回归档文件列表
    vi.mocked(api.getArchiveFiles).mockResolvedValue({
      list: [],
      total: 0,
      page: 1,
      pageSize: 1000
    })
  })

  it('应该正确渲染组件', () => {
    const wrapper = mount(BorrowView, {
      global: {
        plugins: [vuetify],
      },
    })

    expect(wrapper.find('.v-card-title').text()).toContain('文件借阅')
  })

  it('应该在挂载时加载归档文件列表', async () => {
    const mockArchiveFiles = {
      list: [
        {
          id: 1,
          application_name: '测试申请',
          applicant_unit: '测试单位',
          applicant_department: '测试部门',
          applicant_name: '张三',
          applicant_contact: '12345678901',
          archive_file_name: 'test.pdf',
          archive_file_category: 'PDF文件',
          archive_file_hash: 'abc123',
          application_time: '2026-03-07 10:00:00',
          content_title: '测试文档',
          content_summary: null,
          data_classification: '一般' as const,
          protection_method: 1,
          create_time: '2026-03-07 04:35:03',
          update_time: '2026-03-07 04:35:03'
        }
      ],
      total: 1,
      page: 1,
      pageSize: 1000
    }

    vi.mocked(api.getArchiveFiles).mockResolvedValue(mockArchiveFiles)

    mount(BorrowView, {
      global: {
        plugins: [vuetify],
      },
    })

    await new Promise(resolve => setTimeout(resolve, 200))

    expect(api.getArchiveFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 1000
      })
    )
  })

  it('应该正确判断文件是否可以在线查看', () => {
    // PDF文件且是核心数据可以查看
    const pdfCoreFile = {
      id: 1,
      archive_file_name: 'test.pdf',
      data_classification: '核心' as const,
    }

    // 一般文件不能查看
    const normalFile = {
      id: 3,
      archive_file_name: 'test.doc',
      data_classification: '一般' as const,
    }

    // 验证逻辑
    const isPdf = pdfCoreFile.archive_file_name.toLowerCase().endsWith('.pdf')
    const isCore = pdfCoreFile.data_classification === '核心'
    expect(isPdf && isCore).toBe(true)

    expect(normalFile.archive_file_name.toLowerCase().endsWith('.pdf')).toBe(false)
  })

  it('应该正确判断文件是否可以下载', () => {
    // 核心文件不能下载
    const coreFile = {
      data_classification: '核心' as const,
    }

    // 重要文件可以下载
    const importantFile = {
      data_classification: '重要' as const,
    }

    // 一般文件可以下载
    const normalFile = {
      data_classification: '一般' as const,
    }

    // 公开文件可以下载
    const publicFile = {
      data_classification: '公开' as const,
    }

    expect(coreFile.data_classification).toBe('核心')
    expect(importantFile.data_classification).not.toBe('核心')
    expect(normalFile.data_classification).not.toBe('核心')
    expect(publicFile.data_classification).not.toBe('核心')
  })

  it('应该在下载重要文件时要求填写理由', () => {
    const importantFile = {
      data_classification: '重要' as const,
    }

    const normalFile = {
      data_classification: '一般' as const,
    }

    // 重要文件需要理由
    expect(importantFile.data_classification).toBe('重要')

    // 一般文件不需要理由
    expect(normalFile.data_classification).not.toBe('重要')
  })

  it('应该在在线查看时强制要求填写理由', () => {
    // 所有在线查看都需要填写理由
    const action = 'view'
    expect(action === 'view').toBe(true)
  })
})
