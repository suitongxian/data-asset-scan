import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { createRouter, createMemoryHistory, type RouteRecordRaw } from 'vue-router'
import App from '../App.vue'

// 创建测试用的 Vuetify 实例（包含所有组件）
const vuetify = createVuetify({
  components,
  directives,
})

// 创建测试用的路由（模拟新的路由结构）
const routes: RouteRecordRaw[] = [
  { path: '/', name: 'Files', component: { template: '<div>Files Page</div>' } },
  { path: '/classify', name: 'Classify', component: { template: '<div>Classify Page</div>' } },
  { path: '/settings', name: 'Settings', component: { template: '<div>Settings Page</div>' } },
]

describe('前端集成测试', () => {
  let router: ReturnType<typeof createRouter>

  beforeEach(() => {
    router = createRouter({
      history: createMemoryHistory(),
      routes,
    })
  })

  describe('Vue Router 集成', () => {
    it('应该正确挂载 App 组件并包含路由视图', async () => {
      router.push('/')
      await router.isReady()

      const wrapper = mount(App, {
        global: {
          plugins: [vuetify, router],
        },
      })

      // 验证 App 组件包含导航元素
      expect(wrapper.text()).toContain('数据可信终端')
    })

    it('应该包含正确的导航项', async () => {
      router.push('/')
      await router.isReady()

      const wrapper = mount(App, {
        global: {
          plugins: [vuetify, router],
        },
      })

      // 验证导航项存在（新的导航结构）
      expect(wrapper.text()).toContain('工作文件')
      expect(wrapper.text()).toContain('认领文件归档保护')
      expect(wrapper.text()).toContain('设置')
    })
  })

  describe('主题切换', () => {
    it.skip('应该包含主题切换按钮', async () => {
      // 主题切换按钮已在 App.vue 中注释掉，测试跳过
    })
  })
})
