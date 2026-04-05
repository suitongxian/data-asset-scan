import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ConfigService } from '../ConfigService'

describe('ConfigService', () => {
  let testDir: string
  let configPath: string

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `config-service-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  afterAll(async () => {
    // 清理测试目录
    await fs.rm(testDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    configPath = path.join(testDir, `config-${Date.now()}.yaml`)
  })

  describe('加载配置', () => {
    it('应该成功加载 config.yaml', async () => {
      const configContent = `# 应用配置文件
control_type: .doc,.ppt,.docx
`
      await fs.writeFile(configPath, configContent)

      const service = new ConfigService(configPath)
      const config = service.load()

      expect(config).toBeDefined()
      expect(config.control_type).toBe('.doc,.ppt,.docx')
    })

    it('配置文件不存在时应该抛出错误', () => {
      const nonExistentPath = path.join(testDir, 'non-existent.yaml')
      const service = new ConfigService(nonExistentPath)

      expect(() => service.load()).toThrow('配置文件不存在')
    })

    it('首次加载后应该缓存配置', async () => {
      const configContent = `control_type: .doc,.ppt`
      await fs.writeFile(configPath, configContent)

      const service = new ConfigService(configPath)
      const config1 = service.load()
      const config2 = service.load()

      expect(config1).toBe(config2)
    })
  })

  describe('获取配置', () => {
    it('应该使用 get 方法返回配置', async () => {
      const configContent = `control_type: .xls,.xlsx`
      await fs.writeFile(configPath, configContent)

      const service = new ConfigService(configPath)
      const config = service.get()

      expect(config.control_type).toBe('.xls,.xlsx')
    })

    it('如果未加载应该自动加载配置', async () => {
      const configContent = `control_type: .pdf`
      await fs.writeFile(configPath, configContent)

      const service = new ConfigService(configPath)
      // 直接调用 get，不先调用 load
      const config = service.get()

      expect(config.control_type).toBe('.pdf')
    })
  })

  describe('获取管控类型', () => {
    it('应该将 control_type 解析为数组', async () => {
      const configContent = `control_type: .doc,.ppt,.docx`
      await fs.writeFile(configPath, configContent)

      const service = new ConfigService(configPath)
      const types = service.getControlTypes()

      expect(types).toEqual(['.doc', '.ppt', '.docx'])
    })

    it('应该去除管控类型的空白字符', async () => {
      const configContent = `control_type: .doc , .ppt , .docx`
      await fs.writeFile(configPath, configContent)

      const service = new ConfigService(configPath)
      const types = service.getControlTypes()

      expect(types).toEqual(['.doc', '.ppt', '.docx'])
    })

    it('应该处理单个管控类型', async () => {
      const configContent = `control_type: .pdf`
      await fs.writeFile(configPath, configContent)

      const service = new ConfigService(configPath)
      const types = service.getControlTypes()

      expect(types).toEqual(['.pdf'])
    })
  })

  describe('获取配置项', () => {
    it('应该获取安全操作码', async () => {
      const configContent = `control_type: .doc
save_code: "123456"`
      await fs.writeFile(configPath, configContent)

      const service = new ConfigService(configPath)
      expect(service.getSaveCode()).toBe('123456')
    })

    it('应该获取日常盘点扫描间隔', async () => {
      const configContent = `control_type: .doc
daily_scan_interval: 30`
      await fs.writeFile(configPath, configContent)

      const service = new ConfigService(configPath)
      expect(service.getDailyScanInterval()).toBe(30)
    })

    it('应该获取扫描区域路径', async () => {
      const configContent = `control_type: .doc
scan_area_path: /Users/test`
      await fs.writeFile(configPath, configContent)

      const service = new ConfigService(configPath)
      expect(service.getScanAreaPath()).toBe('/Users/test')
    })

    it('应该获取扫描排除目录', async () => {
      const configContent = `control_type: .doc
scan_exclude_dir: node_modules,.git`
      await fs.writeFile(configPath, configContent)

      const service = new ConfigService(configPath)
      expect(service.getScanExcludeDir()).toBe('node_modules,.git')
    })

    it('应该获取工作空间目录', async () => {
      const configContent = `control_type: .doc
workspace: /Users/test/workspace`
      await fs.writeFile(configPath, configContent)

      const service = new ConfigService(configPath)
      expect(service.getWorkspace()).toBe('/Users/test/workspace')
    })
  })

  describe('设置配置文件路径', () => {
    it('应该支持设置新的配置文件路径', async () => {
      const configContent1 = `control_type: .doc`
      const configPath1 = path.join(testDir, `config1-${Date.now()}.yaml`)
      await fs.writeFile(configPath1, configContent1)

      const configContent2 = `control_type: .pdf`
      const configPath2 = path.join(testDir, `config2-${Date.now()}.yaml`)
      await fs.writeFile(configPath2, configContent2)

      const service = new ConfigService(configPath1)
      expect(service.getControlTypes()).toEqual(['.doc'])

      // 设置新的配置文件路径
      service.setConfigPath(configPath2)
      expect(service.getControlTypes()).toEqual(['.pdf'])
    })
  })
})
