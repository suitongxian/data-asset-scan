import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: [
      'electron/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.ts'
    ],
    environmentMatchGlobs: [
      // 前端测试使用 happy-dom
      ['src/**', 'happy-dom'],
      // 后端测试使用 node
      ['electron/**', 'node'],
    ],
    globals: true,
    deps: {
      inline: ['vuetify'],
    },
  }
})
