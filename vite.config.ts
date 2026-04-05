import { defineConfig, Plugin } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

// 检查是否为纯 web 开发模式
const isWebOnly = process.env.VITE_WEB_ONLY === 'true'

// 复制 electron 资源文件到 dist-electron
function copyElectronAssetsSync() {
  const distElectron = path.resolve(__dirname, 'dist-electron')

  // 确保目录存在
  if (!fs.existsSync(distElectron)) {
    fs.mkdirSync(distElectron, { recursive: true })
  }

  // 复制 config.yaml
  const configSrc = path.resolve(__dirname, 'electron/config.yaml')
  const configDest = path.resolve(distElectron, 'config.yaml')
  if (fs.existsSync(configSrc)) {
    fs.copyFileSync(configSrc, configDest)
  }

  // 复制 database.sql
  const sqlSrc = path.resolve(__dirname, 'electron/database.sql')
  const sqlDest = path.resolve(distElectron, 'database.sql')
  if (fs.existsSync(sqlSrc)) {
    fs.copyFileSync(sqlSrc, sqlDest)
  }
}

// 自定义插件：复制 electron 资源文件到 dist-electron
function copyElectronAssets(): Plugin {
  return {
    name: 'copy-electron-assets',
    buildStart() {
      copyElectronAssetsSync()
    },
    configureServer() {
      // 开发模式下也复制文件
      copyElectronAssetsSync()
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig(async () => {
  const plugins: Plugin[] = [
    vue(),
    vuetify({ autoImport: true }),
  ]

  // 仅在非 web-only 模式下加载 electron 插件
  if (!isWebOnly) {
    const electron = (await import('vite-plugin-electron/simple')).default
    plugins.push(
      electron({
        main: {
          // Shortcut of `build.lib.entry`.
          entry: 'electron/main.ts',
          // 开启 source map 以支持调试
          vite: {
            build: {
              sourcemap: true
            }
          }
        },
        preload: {
          // Shortcut of `build.rollupOptions.input`.
          // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
          input: path.join(__dirname, 'electron/preload.ts'),
        },
        // Ployfill the Electron and Node.js API for Renderer process.
        // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
        // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
        renderer: process.env.NODE_ENV === 'test'
          // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
          ? undefined
          : {},
      }),
      copyElectronAssets(),
    )
  }

  return {
    plugins,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  }
})
