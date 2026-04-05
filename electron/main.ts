import { app, BrowserWindow, ipcMain, shell, Menu, MenuItem } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { HttpScanService } from './services/HttpScanService'
import { ConfigService } from './services/ConfigService'
import { DatabaseService } from './services/DatabaseService'
import { SystemConfigRepository } from './services/SystemConfigRepository'
import { WorkspaceService } from './services/WorkspaceService'
import { getLogger } from './services/LoggerService'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// 检查是否为服务模式
const isServiceMode = process.argv.includes('--service')

let win: BrowserWindow | null
let httpService: HttpScanService | null = null
let configService: ConfigService | null = null
let databaseService: DatabaseService | null = null

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = []

  // macOS 应用菜单
  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        {
          label: `关于 ${app.name}`,
          role: 'about'
        },
        { type: 'separator' },
        {
          label: '隐藏',
          accelerator: 'Command+H',
          role: 'hide'
        },
        {
          label: '隐藏其他',
          accelerator: 'Command+Shift+H',
          role: 'hideOthers'
        },
        {
          label: '显示全部',
          role: 'unhide'
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'Command+Q',
          click: () => { app.quit() }
        }
      ]
    })
  }

  // 文件菜单
  template.push({
    label: '文件',
    submenu: [
      process.platform === 'darwin'
        ? {
            label: '关闭',
            accelerator: 'Command+W',
            role: 'close'
          }
        : {
            label: '退出',
            accelerator: 'Ctrl+Q',
            click: () => { app.quit() }
          }
    ]
  })

  // 编辑菜单
  template.push({
    label: '编辑',
    submenu: [
      { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
      { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
      { type: 'separator' },
      { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
      { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
      { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
      ...(process.platform === 'darwin'
        ? [
            { label: '粘贴并匹配样式', accelerator: 'CmdOrCtrl+Shift+V', role: 'pasteAndMatchStyle' },
            { label: '删除', role: 'delete' },
            { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
          ]
        : [
            { label: '删除', role: 'delete' },
            { type: 'separator' },
            { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
          ])
    ]
  })

  // 视图菜单
  template.push({
    label: '视图',
    submenu: [
      { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
      { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
      { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
      { type: 'separator' },
      { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
      { label: '放大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
      { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
      { type: 'separator' },
      { label: '全屏', accelerator: 'CmdOrCtrl+F', role: 'togglefullscreen' }
    ]
  })

  // 窗口菜单
  if (process.platform === 'darwin') {
    template.push({
      label: '窗口',
      submenu: [
        { label: '最小化', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: '关闭', accelerator: 'CmdOrCtrl+W', role: 'close' },
        { type: 'separator' },
        { label: '全部置于顶层', role: 'front' }
      ]
    })
  }

  // 帮助菜单
  template.push({
    label: '帮助',
    role: 'help',
    submenu: [
      {
        label: '了解更多',
        click: async () => {
          await shell.openExternal('https://github.com')
        }
      }
    ]
  })

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

async function startHttpService() {
  httpService = new HttpScanService({
    port: 3001,
    host: '127.0.0.1',
    db: databaseService?.getDb(),
    configService: configService ?? undefined
  })
  await httpService.start()
}

async function initializeApp(): Promise<void> {
  console.log('开始初始化应用...')

  // 1. 初始化配置文件（只从 config.yaml 读取）
  configService = new ConfigService({
    configPath: path.join(__dirname, 'config.yaml')
  })

  // 2. 初始化数据库
  databaseService = new DatabaseService()
  databaseService.init()

  // 3. 初始化工作空间
  const logger = getLogger()
  const systemConfigRepo = new SystemConfigRepository(databaseService.getDb(), configService)
  const workspaceService = new WorkspaceService({
    systemConfigRepo,
    logger,
    shell // 传入 Electron shell 用于创建桌面快捷方式
  })
  const workspaceResult = await workspaceService.initializeWorkspace()
  if (workspaceResult.success) {
    console.log(`工作空间初始化完成: ${workspaceResult.workspacePath}`)
    if (workspaceResult.createdNew) {
      console.log('新建了工作空间目录')
    }
  } else {
    console.error(`工作空间初始化失败: ${workspaceResult.message}`)
  }

  // 4. 注册IPC处理器
  registerIpcHandlers()

  console.log('应用初始化完成')
}

// 注册IPC处理器
function registerIpcHandlers(): void {
  // 获取上传服务器地址
  ipcMain.handle('get-upload-server-url', () => {
    if (!databaseService) {
      return null
    }
    const systemConfigRepo = new SystemConfigRepository(databaseService.getDb(), configService ?? undefined)
    return systemConfigRepo.getUploadServerUrl()
  })
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (isServiceMode) {
    // 服务模式下不退出
    return
  }
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0 && !isServiceMode) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  // 初始化应用（加载配置、初始化数据库、初始化工作空间）
  await initializeApp()

  // 启动 HTTP 服务（两种模式都启动）
  await startHttpService()

  if (isServiceMode) {
    // 纯服务模式：不创建窗口
    console.log('运行模式: 纯服务模式 (无界面)')
    console.log('按 Ctrl+C 停止服务')
  } else {
    // 界面模式：创建窗口 + HTTP 服务
    console.log('运行模式: 界面模式')
    createMenu()
    createWindow()
  }
})

// 优雅退出
app.on('before-quit', async () => {
  if (httpService) {
    await httpService.stop()
  }
  if (databaseService) {
    databaseService.close()
  }
})
