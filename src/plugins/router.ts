import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Files',
    component: () => import('@/views/FilesView.vue'),
  },
  {
    path: '/scan',
    name: 'Scan',
    component: () => import('@/views/ScanView.vue'),
  },
  {
    path: '/classify',
    name: 'Classify',
    component: () => import('@/views/ClassifyView.vue'),
  },
  {
    path: '/classifySearch',
    name: 'ClassifySearch',
    component: () => import('@/views/ClassifySearchView.vue'),
  },
  {
    path: '/claim',
    name: 'Claim',
    component: () => import('@/views/ClaimView.vue'),
  },
  {
    path: '/user-info',
    name: 'UserInfo',
    component: () => import('@/views/UserInfoView.vue'),
  },
  {
    path: '/report',
    name: 'Report',
    component: () => import('@/views/ReportView.vue'),
  },
  {
    path: '/borrow',
    name: 'Borrow',
    component: () => import('@/views/BorrowView.vue'),
  },
  {
    path: '/pdf-viewer',
    name: 'PdfViewer',
    component: () => import('@/views/PdfViewer.vue'),
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('@/views/SettingsView.vue'),
  },
  {
    path: '/privacy',
    name: 'PrivacyProtection',
    component: () => import('@/views/PrivacyProtectionView.vue'),
  },
  {
    path: '/admin',
    name: 'systemConfig',
    component: () => import('@/views/SystemConfigView.vue'),
  },
  {
    path: '/stats',
    name: 'Stats',
    component: () => import('@/views/StatsView.vue'),
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
