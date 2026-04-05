import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { StreamingFileScannerService } from '../StreamingFileScannerService'

describe('StreamingFileScannerService', () => {
  let testDir: string
  let scanner: StreamingFileScannerService

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `streaming-scanner-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    // 创建测试文件结构
    // testDir/
    //   ├── file1.doc
    //   ├── file2.pdf
    //   ├── file3.txt
    //   ├── subdir/
    //   │   ├── file4.doc
    //   │   └── file5.pdf
    //   ├── excluded/
    //   │   └── file6.doc
    //   ├── .hidden/
    //   │   └── hidden.doc
    //   └── node_modules/
    //       └── pkg.doc

    await fs.writeFile(path.join(testDir, 'file1.doc'), 'doc content 1')
    await fs.writeFile(path.join(testDir, 'file2.pdf'), 'pdf content')
    await fs.writeFile(path.join(testDir, 'file3.txt'), 'text content')

    await fs.mkdir(path.join(testDir, 'subdir'))
    await fs.writeFile(path.join(testDir, 'subdir', 'file4.doc'), 'doc content 4')
    await fs.writeFile(path.join(testDir, 'subdir', 'file5.pdf'), 'pdf content 5')

    await fs.mkdir(path.join(testDir, 'excluded'))
    await fs.writeFile(path.join(testDir, 'excluded', 'file6.doc'), 'excluded doc')

    await fs.mkdir(path.join(testDir, '.hidden'))
    await fs.writeFile(path.join(testDir, '.hidden', 'hidden.doc'), 'hidden doc')

    await fs.mkdir(path.join(testDir, 'node_modules'))
    await fs.writeFile(path.join(testDir, 'node_modules', 'pkg.doc'), 'node modules doc')

    scanner = new StreamingFileScannerService()
  })

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('parseExtensions', () => {
    it('should parse comma-separated extensions', () => {
      const result = StreamingFileScannerService.parseExtensions('.doc,.pdf,.docx')
      expect(result).toEqual(['.doc', '.pdf', '.docx'])
    })

    it('should add dot prefix if missing', () => {
      const result = StreamingFileScannerService.parseExtensions('doc,pdf,docx')
      expect(result).toEqual(['.doc', '.pdf', '.docx'])
    })

    it('should convert to lowercase', () => {
      const result = StreamingFileScannerService.parseExtensions('.DOC,.PDF')
      expect(result).toEqual(['.doc', '.pdf'])
    })
  })

  describe('scanWithCallback', () => {
    it('should scan files with specified extensions', async () => {
      const foundFiles: string[] = []

      const result = await scanner.scanWithCallback(
        { directory: testDir, extensions: ['.doc'] },
        (filePath) => { foundFiles.push(filePath) }
      )

      // 应该找到 file1.doc 和 file4.doc（排除 hidden, node_modules, excluded 不在默认排除列表中）
      expect(result.scannedCount).toBe(3) // file1.doc, subdir/file4.doc, excluded/file6.doc
      expect(foundFiles.some(f => f.endsWith('file1.doc'))).toBe(true)
      expect(foundFiles.some(f => f.endsWith('file4.doc'))).toBe(true)
    })

    it('should support multiple extensions', async () => {
      const foundFiles: string[] = []

      await scanner.scanWithCallback(
        { directory: testDir, extensions: ['.doc', '.pdf'] },
        (filePath) => { foundFiles.push(filePath) }
      )

      expect(foundFiles.some(f => f.endsWith('.doc'))).toBe(true)
      expect(foundFiles.some(f => f.endsWith('.pdf'))).toBe(true)
    })

    it('should skip hidden directories', async () => {
      const foundFiles: string[] = []

      await scanner.scanWithCallback(
        { directory: testDir, extensions: ['.doc'] },
        (filePath) => { foundFiles.push(filePath) }
      )

      expect(foundFiles.some(f => f.includes('.hidden'))).toBe(false)
    })

    it('should skip node_modules by default', async () => {
      const foundFiles: string[] = []

      await scanner.scanWithCallback(
        { directory: testDir, extensions: ['.doc'] },
        (filePath) => { foundFiles.push(filePath) }
      )

      expect(foundFiles.some(f => f.includes('node_modules'))).toBe(false)
    })

    it('should exclude specified directories', async () => {
      const foundFiles: string[] = []

      await scanner.scanWithCallback(
        { directory: testDir, extensions: ['.doc'], excludeDirs: ['excluded'] },
        (filePath) => { foundFiles.push(filePath) }
      )

      expect(foundFiles.some(f => f.includes('excluded'))).toBe(false)
      // 还应该能找到其他 .doc 文件
      expect(foundFiles.some(f => f.endsWith('file1.doc'))).toBe(true)
    })

    it('should call progress callback', async () => {
      const progressCalls: number[] = []

      await scanner.scanWithCallback(
        { directory: testDir, extensions: ['.doc'] },
        () => {},
        (progress) => { progressCalls.push(progress.scannedCount) }
      )

      // 进度应该递增
      expect(progressCalls.length).toBeGreaterThan(0)
      for (let i = 1; i < progressCalls.length; i++) {
        expect(progressCalls[i]).toBeGreaterThan(progressCalls[i - 1])
      }
    })

    it('should support async callback', async () => {
      const foundFiles: string[] = []

      await scanner.scanWithCallback(
        { directory: testDir, extensions: ['.doc'] },
        async (filePath) => {
          await new Promise(resolve => setTimeout(resolve, 1))
          foundFiles.push(filePath)
        }
      )

      expect(foundFiles.length).toBeGreaterThan(0)
    })

    it('should return usedExtensions in result', async () => {
      const result = await scanner.scanWithCallback(
        { directory: testDir, extensions: ['.doc', '.pdf'] },
        () => {}
      )

      expect(result.usedExtensions).toContain('.doc')
      expect(result.usedExtensions).toContain('.pdf')
    })
  })

  describe('scanWithBatchCallback', () => {
    it('should process files in batches', async () => {
      const batches: string[][] = []

      await scanner.scanWithBatchCallback(
        { directory: testDir, extensions: ['.doc', '.pdf', '.txt'], batchSize: 2 },
        (batch) => { batches.push([...batch]) }
      )

      // 应该有多个批次
      expect(batches.length).toBeGreaterThan(0)
      // 除最后一个批次外，其他批次大小应为 batchSize
      for (let i = 0; i < batches.length - 1; i++) {
        expect(batches[i].length).toBe(2)
      }
    })

    it('should handle fewer files than batch size', async () => {
      const batches: string[][] = []

      await scanner.scanWithBatchCallback(
        { directory: testDir, extensions: ['.txt'], batchSize: 100 },
        (batch) => { batches.push([...batch]) }
      )

      // 只应该有一个批次（因为只有 1 个 .txt 文件）
      expect(batches.length).toBe(1)
      expect(batches[0].length).toBe(1)
    })
  })

  describe('scanAsGenerator', () => {
    it('should yield files one by one', async () => {
      const foundFiles: string[] = []

      for await (const filePath of scanner.scanAsGenerator({
        directory: testDir,
        extensions: ['.doc']
      })) {
        foundFiles.push(filePath)
      }

      expect(foundFiles.length).toBeGreaterThan(0)
      expect(foundFiles.every(f => f.endsWith('.doc'))).toBe(true)
    })

    it('should support early termination', async () => {
      let count = 0

      for await (const _filePath of scanner.scanAsGenerator({
        directory: testDir,
        extensions: ['.doc', '.pdf', '.txt']
      })) {
        count++
        if (count >= 2) break
      }

      expect(count).toBe(2)
    })
  })

  describe('countFiles', () => {
    it('should count files without returning paths', async () => {
      const count = await scanner.countFiles({
        directory: testDir,
        extensions: ['.doc']
      })

      expect(count).toBe(3) // file1.doc, subdir/file4.doc, excluded/file6.doc
    })

    it('should respect exclude directories', async () => {
      const count = await scanner.countFiles({
        directory: testDir,
        extensions: ['.doc'],
        excludeDirs: ['excluded']
      })

      expect(count).toBe(2) // file1.doc, subdir/file4.doc
    })

    it('should return 0 for no matching files', async () => {
      const count = await scanner.countFiles({
        directory: testDir,
        extensions: ['.xyz']
      })

      expect(count).toBe(0)
    })
  })

  describe('case insensitivity', () => {
    it('should match extensions case-insensitively', async () => {
      // 创建大写后缀文件
      await fs.writeFile(path.join(testDir, 'uppercase.DOC'), 'uppercase')

      const count = await scanner.countFiles({
        directory: testDir,
        extensions: ['.doc']
      })

      // 应该包含 .DOC 文件
      expect(count).toBeGreaterThanOrEqual(4)

      await fs.unlink(path.join(testDir, 'uppercase.DOC'))
    })
  })

  describe('isPathWithin', () => {
    it('should detect when child is within parent', () => {
      expect(StreamingFileScannerService.isPathWithin('/a/b/c', '/a/b')).toBe(true)
      expect(StreamingFileScannerService.isPathWithin('/a/b', '/a/b')).toBe(true)
    })

    it('should detect when child is not within parent', () => {
      expect(StreamingFileScannerService.isPathWithin('/a/b', '/a/b/c')).toBe(false)
      expect(StreamingFileScannerService.isPathWithin('/a/bc', '/a/b')).toBe(false)
      expect(StreamingFileScannerService.isPathWithin('/x/y', '/a/b')).toBe(false)
    })
  })

  describe('mergeExtensions', () => {
    it('should merge and deduplicate extensions', () => {
      const result = StreamingFileScannerService.mergeExtensions(
        ['.doc', '.pdf'],
        ['.pdf', '.txt']
      )
      expect(result).toContain('.doc')
      expect(result).toContain('.pdf')
      expect(result).toContain('.txt')
      expect(result.filter(e => e === '.pdf').length).toBe(1)
    })

    it('should handle empty arrays', () => {
      expect(StreamingFileScannerService.mergeExtensions([], [])).toEqual([])
      expect(StreamingFileScannerService.mergeExtensions(['.doc'], [])).toEqual(['.doc'])
      expect(StreamingFileScannerService.mergeExtensions([], ['.pdf'])).toEqual(['.pdf'])
    })
  })
})

describe('Workspace functionality', () => {
  let testDir: string
  let workspaceDir: string
  let scanner: StreamingFileScannerService

  beforeAll(async () => {
    // 创建临时测试目录结构
    testDir = path.join(os.tmpdir(), `scan-workspace-test-${Date.now()}`)
    workspaceDir = path.join(testDir, 'workspace')

    await fs.mkdir(testDir, { recursive: true })
    await fs.mkdir(workspaceDir, { recursive: true })

    // 主目录文件
    await fs.writeFile(path.join(testDir, 'main1.doc'), 'doc')
    await fs.writeFile(path.join(testDir, 'main2.pdf'), 'pdf')

    // 工作空间目录文件 - 包含额外的后缀
    await fs.writeFile(path.join(workspaceDir, 'ws1.doc'), 'doc')
    await fs.writeFile(path.join(workspaceDir, 'ws2.xlsx'), 'xlsx')
    await fs.writeFile(path.join(workspaceDir, 'ws3.pptx'), 'pptx')
    await fs.writeFile(path.join(workspaceDir, 'ws4.json'), 'json')

    scanner = new StreamingFileScannerService()
  })

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('collectWorkspaceSuffixes', () => {
    it('should collect all file suffixes from workspace', async () => {
      const stats = await scanner.collectWorkspaceSuffixes(workspaceDir)

      expect(stats.workspacePath).toBe(workspaceDir)
      expect(stats.workspaceFileCount).toBe(4)
      expect(stats.workspaceSuffixes).toContain('.doc')
      expect(stats.workspaceSuffixes).toContain('.xlsx')
      expect(stats.workspaceSuffixes).toContain('.pptx')
      expect(stats.workspaceSuffixes).toContain('.json')
    })

    it('should count files per suffix correctly', async () => {
      const stats = await scanner.collectWorkspaceSuffixes(workspaceDir)

      expect(stats.suffixCounts['.doc']).toBe(1)
      expect(stats.suffixCounts['.xlsx']).toBe(1)
      expect(stats.suffixCounts['.pptx']).toBe(1)
      expect(stats.suffixCounts['.json']).toBe(1)
    })
  })

  describe('scanWithCallback with workspace', () => {
    it('should merge workspace suffixes with extensions', async () => {
      const foundFiles: string[] = []

      const result = await scanner.scanWithCallback(
        {
          directory: testDir,
          extensions: ['.doc'],
          workspace: workspaceDir
        },
        (filePath) => { foundFiles.push(filePath) }
      )

      // 应该包含所有后缀
      expect(result.usedExtensions).toContain('.doc')
      expect(result.usedExtensions).toContain('.xlsx')
      expect(result.usedExtensions).toContain('.pptx')
      expect(result.usedExtensions).toContain('.json')
    })

    it('should return workspace stats', async () => {
      const result = await scanner.scanWithCallback(
        {
          directory: testDir,
          extensions: ['.doc'],
          workspace: workspaceDir
        },
        () => {}
      )

      expect(result.workspaceStats).toBeDefined()
      expect(result.workspaceStats!.workspacePath).toBe(workspaceDir)
      expect(result.workspaceStats!.workspaceFileCount).toBe(4)
    })

    it('should not duplicate files when workspace is within directory', async () => {
      const foundFiles: string[] = []

      const result = await scanner.scanWithCallback(
        {
          directory: testDir,
          extensions: ['.doc', '.xlsx', '.pptx', '.json', '.pdf'],
          workspace: workspaceDir  // workspace 在 testDir 内
        },
        (filePath) => { foundFiles.push(filePath) }
      )

      // 去重后的文件数
      const uniqueFiles = new Set(foundFiles)
      expect(uniqueFiles.size).toBe(foundFiles.length)
      // 总共 6 个文件：main1.doc, main2.pdf, ws1.doc, ws2.xlsx, ws3.pptx, ws4.json
      expect(result.scannedCount).toBe(6)
    })
  })

  describe('countFilesWithExtensions with workspace', () => {
    it('should count files with merged extensions', async () => {
      const result = await scanner.countFilesWithExtensions({
        directory: testDir,
        extensions: ['.doc'],
        workspace: workspaceDir
      })

      // 应该包含所有后缀文件：main1.doc, main2.pdf(不在extensions中但ws没有)
      // workspace 合并后: .doc, .xlsx, .pptx, .json
      expect(result.count).toBeGreaterThan(0)
      expect(result.usedExtensions).toContain('.doc')
      expect(result.usedExtensions).toContain('.xlsx')
      expect(result.workspaceStats).toBeDefined()
    })
  })
})

describe('Workspace outside directory', () => {
  let mainDir: string
  let separateWorkspace: string
  let scanner: StreamingFileScannerService

  beforeAll(async () => {
    // 创建两个独立的目录
    mainDir = path.join(os.tmpdir(), `scan-main-${Date.now()}`)
    separateWorkspace = path.join(os.tmpdir(), `scan-separate-ws-${Date.now()}`)

    await fs.mkdir(mainDir, { recursive: true })
    await fs.mkdir(separateWorkspace, { recursive: true })

    // 主目录文件
    await fs.writeFile(path.join(mainDir, 'main.doc'), 'doc')
    await fs.writeFile(path.join(mainDir, 'main.pdf'), 'pdf')

    // 独立工作空间目录
    await fs.writeFile(path.join(separateWorkspace, 'ws.txt'), 'txt')
    await fs.writeFile(path.join(separateWorkspace, 'ws.csv'), 'csv')

    scanner = new StreamingFileScannerService()
  })

  afterAll(async () => {
    await fs.rm(mainDir, { recursive: true, force: true })
    await fs.rm(separateWorkspace, { recursive: true, force: true })
  })

  it('should scan both directories when workspace is outside directory', async () => {
    const foundFiles: string[] = []

    const result = await scanner.scanWithCallback(
      {
        directory: mainDir,
        extensions: ['.doc'],
        workspace: separateWorkspace
      },
      (filePath) => { foundFiles.push(filePath) }
    )

    // 应该找到所有 4 个文件 (.doc + .txt + .csv + .pdf 被 workspace 后缀合并)
    // workspace 后缀: .txt, .csv
    // 合并后: .doc, .txt, .csv
    // mainDir: main.doc (匹配)
    // separateWorkspace: ws.txt (匹配), ws.csv (匹配)
    expect(result.scannedCount).toBe(3)
    expect(foundFiles.some(f => f.includes('main.doc'))).toBe(true)
    expect(foundFiles.some(f => f.includes('ws.txt'))).toBe(true)
    expect(foundFiles.some(f => f.includes('ws.csv'))).toBe(true)
  })
})
