<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type FileItem, type SystemConfig, type ScanProgressEvent, type FileStatisticsComparison, type StatisticsGrowth } from '@/services/api'
import { saveTabState, loadTabState } from '@/services/TabStateManager'

const route = useRoute()
const router = useRouter()

// 选项卡类型
type TabType = 'workspace' | 'new_access' | 'history_inventory'

// 状态
const loading = ref(false)
const files = ref<FileItem[]>([])
const config = ref<SystemConfig | null>(null)
const search = ref('')
const survivalFilter = ref<'all' | 'new' | 'deleted' | 'normal'>('all')
const activeTab = ref<TabType>('workspace')

// 分页状态
const page = ref(1)
const pageSize = ref(20)
const totalItems = ref(0)

// 计算总页数
const totalPages = computed(() => {
  return Math.ceil(totalItems.value / pageSize.value)
})

// 扫描相关状态
const isScanning = ref(false)
const scanProgress = ref<ScanProgressEvent | null>(null)
const scanError = ref<string | null>(null)
let eventSource: EventSource | null = null

// 对话框状态
const showFirstScanDialog = ref(false)
const showCopiesDialog = ref(false)
const workspaceInput = ref('')
const selectedCopies = ref<FileItem[]>([])

// 详情侧边栏状态
const showDetailDrawer = ref(false)
const selectedFile = ref<FileItem | null>(null)

// 文件统计对比数据
const statisticsComparison = ref<FileStatisticsComparison | null>(null)

// 表格列配置
const headers = [
  { title: '文件名', key: 'path', sortable: true },
  { title: '标签', key: 'status', sortable: false, width: '80px' },
  { title: '创建时间', key: 'file_create_time', sortable: true, width: '180px' },
  { title: '最后修改时间', key: 'file_update_time', sortable: true, width: '180px' },
]

// 从文件路径中提取文件名
const getFileName = (path: string) => {
  return path.split('/').pop() || path
}

// 格式化时间
const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 格式化时间为 yyyy-MM-dd HH:mm:ss 格式
const formatDateTime = (dateStr: string | null) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

// 计算进度百分比
const progressPercent = computed(() => {
  if (!scanProgress.value || !scanProgress.value.totalCount) return 0
  return Math.round((scanProgress.value.scannedCount / scanProgress.value.totalCount) * 100)
})

// 根据选项卡过滤文件（前端过滤，用于表格显示）
const filteredFiles = computed(() => {
  const fullInventoryTime = config.value?.full_inventory_time
  // TODO 历吏数据与新准入数据如何计算？
  switch (activeTab.value) {
    case 'workspace':
      // 可信空间管控：展示工作空间内的数据（前端已通过 workspaceFilter 过滤）
      return files.value
    case 'new_access':
      // 工作数据准入：展示首次普查后创建的数据
      if (!fullInventoryTime) return files.value
      return files.value.filter(file => {
        if (!file.file_create_time) return false
        return new Date(file.file_create_time) >= new Date(fullInventoryTime)
      })
    case 'history_inventory':
      // 历史数据专项治理：展示首次普查前创建的数据
      if (!fullInventoryTime) return []
      return files.value.filter(file => {
        if (!file.file_create_time) return true // 无创建时间的视为历史数据
        return new Date(file.file_create_time) < new Date(fullInventoryTime)
      })
    default:
      return files.value
  }
})

// 获取阶段文本
const phaseText = computed(() => {
  const phase = scanProgress.value?.phase
  switch (phase) {
    case 'counting': return '正在统计文件数量...'
    case 'scanning': return '正在扫描文件...'
    case 'aggregating': return '正在聚合数据...'
    case 'completed': return '扫描完成'
    default: return '准备中...'
  }
})

// 获取当前选项卡对应的统计数据
const currentStatistics = computed((): StatisticsGrowth | null => {
  if (!statisticsComparison.value) return null

  switch (activeTab.value) {
    case 'workspace':
      return statisticsComparison.value.workspaceStatistics
    case 'new_access':
      return statisticsComparison.value.nonHistoryStatistics
    case 'history_inventory':
      return statisticsComparison.value.historyStatistics
    default:
      return null
  }
})

// 加载配置
const loadConfig = async () => {
  try {
    config.value = await api.getConfig()
  } catch (error) {
    console.error('Failed to load config:', error)
  }
}

// 加载文件统计数据
const loadStatistics = async () => {
  try {
    statisticsComparison.value = await api.getStatistics()
  } catch (error) {
    console.error('Failed to load statistics:', error)
  }
}

// 加载文件列表
const loadFiles = async () => {
  if (isScanning.value) return

  loading.value = true
  try {
    // 根据选项卡设置工作空间过滤条件：workspace=工作空间内，其他=全部
    const wsFilter = activeTab.value === 'workspace' ? 'inside' : 'all'

    const result = await api.getFiles({
      search: search.value || undefined,
      workspaceFilter: wsFilter,
      survivalFilter: survivalFilter.value,
      page: page.value,
      pageSize: pageSize.value,
    })
    files.value = result.files
    totalItems.value = result.total
    // 同时加载统计数据
    await loadStatistics()
  } catch (error) {
    console.error('Failed to load files:', error)
    files.value = []
    totalItems.value = 0
  } finally {
    loading.value = false
  }
}

// 检查并触发首次普查
const checkFirstScan = async () => {
  await loadConfig()

  if (!config.value?.full_inventory_time) {
    // 未完成首次普查，不自动弹窗，只加载空列表
    loadFiles()
  } else {
    // todo 关闭自动日常盘点
    // 检查是否需要自动日常盘点
    // const shouldScan = await api.shouldAutoScan()
    // if (shouldScan) {
    //   startDailyScan()
    // } else {
    //   loadFiles()
    // }
    loadFiles()
  }
}

// 开始首次普查
const startFirstScan = async () => {
  if (!workspaceInput.value) return

  // 保存工作空间配置
  await api.saveConfig({ workspace: workspaceInput.value })
  await loadConfig()

  showFirstScanDialog.value = false
  startScan('FULL_INVENTORY')
}

// 开始日常盘点
const startDailyScan = () => {
  startScan('DAILY_CHECK')
}

// 手动刷新（触发日常盘点）
const handleRefresh = () => {
  if (isScanning.value) return
  startDailyScan()
}

// 开始扫描
const startScan = async (mode: 'FULL_INVENTORY' | 'DAILY_CHECK' | 'TARGETED_SCAN') => {
  if (isScanning.value) return

  isScanning.value = true
  scanError.value = null
  scanProgress.value = {
    type: 'progress',
    scannedCount: 0,
    totalCount: 0,
    elapsedMs: 0,
    phase: 'initializing',
  }

  // 清空当前文件列表
  files.value = []

  try {
    // 扫描参数由后端从配置中获取，前端只需传递扫描模式
    eventSource = api.triggerScan({
      scanMode: mode,
    })

    const es = eventSource
    es.onmessage = (event) => {
      const data = JSON.parse(event.data) as ScanProgressEvent
      scanProgress.value = data

      if (data.type === 'complete') {
        closeScan()
        loadFiles()
      } else if (data.type === 'error') {
        scanError.value = data.errorMessage || '扫描失败'
        closeScan()
      }
    }

    es.onerror = () => {
      // todo 应弹出实际错误提示
      scanError.value = '扫描连接中断'
      closeScan()
    }
  } catch (error) {
    scanError.value = error instanceof Error ? error.message : '扫描失败'
    closeScan()
  }
}

// 关闭扫描
const closeScan = () => {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
  isScanning.value = false
}

// 显示副本
const showCopies = async (file: FileItem) => {
  try {
    const result = await api.getCopies(file.content_sign)
    selectedCopies.value = result.copies
    showCopiesDialog.value = true
  } catch (error) {
    console.error('Failed to load copies:', error)
  }
}

// 点击行显示详情
const handleRowClick = (_event: Event, row: { item: FileItem }) => {
  selectedFile.value = row.item
  showDetailDrawer.value = true
}

// 关闭详情侧边栏
const closeDetailDrawer = () => {
  showDetailDrawer.value = false
  selectedFile.value = null
}

// 格式化文件大小
const formatFileSize = (bytes: number | null | undefined) => {
  if (bytes === null || bytes === undefined) return '-'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i]
}

// 获取数据类型文本
const getDataTypeText = (type: number) => {
  switch (type) {
    case 1: return '文件'
    case 2: return '数据库'
    default: return '未知'
  }
}

// 获取存续状态文本和颜色
const getSurvivalStatus = (count: number) => {
  if (count === 0) return { text: '已删除', color: 'error' }
  if (count === 1) return { text: '新文件', color: 'success' }
  return { text: '正常', color: 'info' }
}

// 监听选项卡变化，保存状态
watch(activeTab, (newTab) => {
  saveTabState(newTab)
})

// 监听过滤条件变化
watch([search, survivalFilter, activeTab], () => {
  if (!isScanning.value) {
    page.value = 1 // 过滤条件变化时重置到第一页
    loadFiles()
  }
})

// 监听分页变化
watch([page, pageSize], () => {
  loadFiles()
})

// 监听路由参数变化
watch(() => route.query.action, (newAction) => {
  if (newAction) {
    handleRouteAction()
  }
})

// 处理路由参数
const handleRouteAction = async () => {
  const action = route.query.action as string
  if (!action) return

  // 清除 query 参数，避免重复触发
  router.replace({ path: route.path, query: {} })

  if (action === 'firstScan') {
    // 触发首次普查对话框
    await loadConfig()
    workspaceInput.value = config.value?.workspace || ''
    showFirstScanDialog.value = true
  } else if (action === 'dailyScan') {
    // 触发日常盘点
    handleRefresh()
  }
}

// 组件挂载时检查首次普查
onMounted(() => {
  // 加载选项卡状态
  const savedTab = loadTabState()
  console.log("加载选项卡:"+savedTab)
  if (savedTab && ['workspace', 'new_access', 'history_inventory'].includes(savedTab)) {
    activeTab.value = savedTab as TabType
  }
  // 先检查路由参数
  if (route.query.action) {
    handleRouteAction()
  } else {
    checkFirstScan()
  }
})
</script>

<template>
  <div>
    <!-- 选项卡 -->
    <div class="d-flex align-center mb-4">
      <v-tabs v-model="activeTab" color="primary">
        <v-tab value="workspace">工作文件档案管理</v-tab>
        <v-tab value="new_access">新数据登记管理</v-tab>
        <v-tab value="history_inventory">历史数据专项治理</v-tab>
      </v-tabs>
      <v-spacer />
      <v-chip
        v-if="activeTab !== 'workspace' && config?.full_inventory_time"
        color="info"
        variant="tonal"
        size="small"
      >
        历史封帐时间：{{ formatDateTime(config.full_inventory_time) }}
      </v-chip>
    </div>

    <!-- 操作栏 -->
    <v-card class="mb-4" elevation="1">
      <v-card-text>
        <v-row align="center">
          <v-col cols="12" md="4">
            <v-text-field
              v-model="search"
              prepend-inner-icon="mdi-magnify"
              label="搜索文件"
              variant="outlined"
              density="compact"
              hide-details
              clearable
              :disabled="isScanning"
            />
          </v-col>
          <v-col cols="6" md="2">
            <v-select
              v-model="survivalFilter"
              :items="[
                { title: '全部', value: 'all' },
                { title: '新文件', value: 'new' },
                { title: '已删除', value: 'deleted' },
                { title: '正常', value: 'normal' },
              ]"
              label="存续状态"
              variant="outlined"
              density="compact"
              hide-details
              :disabled="isScanning"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-row v-if="currentStatistics" align="center" justify="end" no-gutters>
              <v-col cols="auto" class="px-3 text-center">
                <div class="text-caption text-grey">上次数量</div>
                <div class="text-subtitle-1 font-weight-medium">{{ currentStatistics.lastCount }}</div>
              </v-col>
              <v-col cols="auto" class="px-3 text-center">
                <div class="text-caption text-grey">本次数量</div>
                <div class="text-subtitle-1 font-weight-medium">{{ currentStatistics.currentCount }}</div>
              </v-col>
              <v-col cols="auto" class="px-3 text-center">
                <div class="text-caption text-grey">增涨数量</div>
                <div class="text-subtitle-1 font-weight-medium" :class="currentStatistics.growthCount > 0 ? 'text-success' : (currentStatistics.growthCount < 0 ? 'text-error' : '')">
                  {{ currentStatistics.growthCount > 0 ? '+' : '' }}{{ currentStatistics.growthCount }}
                </div>
              </v-col>
              <v-col cols="auto" class="px-3 text-center">
                <div class="text-caption text-grey">增涨率</div>
                <div class="text-subtitle-1 font-weight-medium" :class="currentStatistics.growthRate > 0 ? 'text-success' : (currentStatistics.growthRate < 0 ? 'text-error' : '')">
                  {{ currentStatistics.growthRate > 0 ? '+' : '' }}{{ currentStatistics.growthRate }}%
                </div>
              </v-col>
            </v-row>
          </v-col>
        </v-row>
<!--        <div v-if="statisticsComparison && !statisticsComparison.hasComparison" class="text-caption text-grey mt-2 text-right">-->
<!--          提示：需要至少进行两次扫描才能获得完整的对比数据-->
<!--        </div>-->
      </v-card-text>
    </v-card>

    <!-- 扫描进度 -->
    <v-card v-if="isScanning || scanError" class="mb-4" elevation="1">
      <v-card-text>
        <div v-if="isScanning">
          <div class="text-center mb-2">{{ phaseText }}</div>
          <v-progress-linear
            :model-value="progressPercent"
            height="24"
            color="primary"
            rounded
          >
            <template v-slot:default>
              <strong>{{ progressPercent }}%</strong>
            </template>
          </v-progress-linear>
          <div class="mt-2 text-caption text-center">
            已扫描: {{ scanProgress?.scannedCount || 0 }} / {{ scanProgress?.totalCount || 0 }}
          </div>
          <div
            v-if="scanProgress?.currentFile"
            class="mt-1 text-caption text-truncate text-center text-grey"
          >
            {{ scanProgress.currentFile }}
          </div>
        </div>
        <v-alert v-if="scanError" type="error" variant="tonal" closable @click:close="scanError = null">
          {{ scanError }}
        </v-alert>
      </v-card-text>
    </v-card>

    <!-- 文件表格 -->
    <v-card elevation="1">
      <v-data-table
        :headers="headers"
        :items="filteredFiles"
        :items-per-page="-1"
        :loading="loading"
        item-value="data_distribution_id"
        fixed-header
        hover
        hide-default-footer
        @click:row="handleRowClick"
      >
        <template v-slot:item.path="{ item }">
          <div class="d-flex align-center">
            <v-icon size="small" class="mr-2" color="grey">
              mdi-file-document-outline
            </v-icon>
            <span class="text-truncate" style="max-width: 400px" :title="item.path">
              {{ getFileName(item.path) }}
            </span>
            <v-chip
              v-if="item.copy_count > 1"
              size="small"
              color="info"
              variant="tonal"
              class="ml-2"
              @click="showCopies(item)"
            >
              {{ item.copy_count }} 副本
            </v-chip>
          </div>
        </template>

        <template v-slot:item.status="{ item }">
          <v-tooltip v-if="item.scan_found_count === 1" text="新文件">
            <template v-slot:activator="{ props }">
              <v-icon v-bind="props" color="success" size="small">mdi-file-plus</v-icon>
            </template>
          </v-tooltip>
          <v-tooltip v-else-if="item.scan_found_count === 0" text="已删除">
            <template v-slot:activator="{ props }">
              <v-icon v-bind="props" color="error" size="small">mdi-file-remove</v-icon>
            </template>
          </v-tooltip>
        </template>

        <template v-slot:item.file_create_time="{ item }">
          {{ formatDate(item.file_create_time) }}
        </template>

        <template v-slot:item.file_update_time="{ item }">
          {{ formatDate(item.file_update_time) }}
        </template>

        <template v-slot:no-data>
          <div class="text-center py-8">
            <v-icon size="64" color="grey-lighten-1">mdi-folder-open-outline</v-icon>
            <div class="mt-4 text-grey">暂无文件数据</div>
            <div class="mt-2 text-caption text-grey">请先进行首次普查或日常盘点</div>
          </div>
        </template>
      </v-data-table>

      <!-- 分页控件 -->
      <v-divider />
      <v-card-text class="py-2 d-flex align-center justify-space-between">
        <div class="d-flex align-center">
          <span class="text-body-2 text-grey mr-4">每页显示</span>
          <v-select
            v-model="pageSize"
            :items="[10, 20, 50, 100]"
            variant="outlined"
            density="compact"
            hide-details
            style="width: 100px"
          />
        </div>
        <v-pagination
          v-model="page"
          :length="totalPages"
          :total-visible="5"
          density="compact"
        />
      </v-card-text>
    </v-card>

    <!-- 首次普查对话框 -->
    <v-dialog v-model="showFirstScanDialog" persistent max-width="500">
      <v-card>
        <v-card-title>首次普查</v-card-title>
        <v-card-text>
          <p class="mb-4">系统检测到您尚未进行首次普查，请配置工作空间目录后开始扫描。</p>
          <v-text-field
            v-model="workspaceInput"
            label="工作空间目录"
            placeholder="/Users/xxx/workspace"
            variant="outlined"
            hint="请输入需要监控的工作目录路径"
            persistent-hint
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="showFirstScanDialog = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            :disabled="!workspaceInput"
            @click="startFirstScan"
          >
            立即开始
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 副本详情对话框 -->
    <v-dialog v-model="showCopiesDialog" max-width="700">
      <v-card>
        <v-card-title>副本列表</v-card-title>
        <v-card-text>
          <v-list lines="two">
            <v-list-item
              v-for="copy in selectedCopies"
              :key="copy.data_distribution_id"
            >
              <v-list-item-title class="text-truncate">
                {{ copy.path }}
              </v-list-item-title>
              <v-list-item-subtitle>
                创建时间: {{ formatDate(copy.file_create_time) }}
                | 修改时间: {{ formatDate(copy.file_update_time) }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showCopiesDialog = false">关闭</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 文件详情侧边栏 -->
    <v-navigation-drawer
      v-model="showDetailDrawer"
      location="right"
      width="400"
    >
      <template v-if="selectedFile">
        <v-toolbar color="primary" density="compact">
          <v-toolbar-title class="text-body-1">文件详情</v-toolbar-title>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" @click="closeDetailDrawer" />
        </v-toolbar>

        <v-list density="compact">
          <!-- 文件路径 -->
          <v-list-item>
            <v-list-item-subtitle>完整路径</v-list-item-subtitle>
            <v-list-item-title class="text-wrap text-body-2">
              {{ selectedFile.path }}
            </v-list-item-title>
          </v-list-item>

          <v-divider />

          <!-- 基本信息 -->
          <v-list-subheader>基本信息</v-list-subheader>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-identifier</v-icon>
            </template>
            <v-list-item-subtitle>数据分布ID</v-list-item-subtitle>
            <v-list-item-title>{{ selectedFile.data_distribution_id }}</v-list-item-title>
          </v-list-item>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-file-outline</v-icon>
            </template>
            <v-list-item-subtitle>数据类型</v-list-item-subtitle>
            <v-list-item-title>{{ getDataTypeText(selectedFile.data_type) }}</v-list-item-title>
          </v-list-item>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-tag-outline</v-icon>
            </template>
            <v-list-item-subtitle>存续状态</v-list-item-subtitle>
            <v-list-item-title>
              <v-chip
                :color="getSurvivalStatus(selectedFile.scan_found_count).color"
                size="small"
                variant="tonal"
              >
                {{ getSurvivalStatus(selectedFile.scan_found_count).text }}
              </v-chip>
            </v-list-item-title>
          </v-list-item>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-content-copy</v-icon>
            </template>
            <v-list-item-subtitle>副本数量</v-list-item-subtitle>
            <v-list-item-title>
              <v-chip
                v-if="selectedFile.copy_count > 1"
                color="info"
                size="small"
                variant="tonal"
                @click="showCopies(selectedFile)"
              >
                {{ selectedFile.copy_count }} 副本
              </v-chip>
              <span v-else>1</span>
            </v-list-item-title>
          </v-list-item>

          <v-divider />

          <!-- 文件属性 -->
          <v-list-subheader>文件属性</v-list-subheader>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-file-code-outline</v-icon>
            </template>
            <v-list-item-subtitle>文件后缀</v-list-item-subtitle>
            <v-list-item-title>{{ selectedFile.file_suffix || '-' }}</v-list-item-title>
          </v-list-item>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-database-outline</v-icon>
            </template>
            <v-list-item-subtitle>文件大小</v-list-item-subtitle>
            <v-list-item-title>{{ formatFileSize(selectedFile.file_size) }}</v-list-item-title>
          </v-list-item>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-magic-staff</v-icon>
            </template>
            <v-list-item-subtitle>文件魔数</v-list-item-subtitle>
            <v-list-item-title class="text-truncate">{{ selectedFile.file_magic || '-' }}</v-list-item-title>
          </v-list-item>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-eye-off-outline</v-icon>
            </template>
            <v-list-item-subtitle>是否隐藏</v-list-item-subtitle>
            <v-list-item-title>{{ selectedFile.file_hide ? '是' : '否' }}</v-list-item-title>
          </v-list-item>

          <v-divider />

          <!-- 签名信息 -->
          <v-list-subheader>签名信息</v-list-subheader>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-fingerprint</v-icon>
            </template>
            <v-list-item-subtitle>内容签名 (MD5)</v-list-item-subtitle>
            <v-list-item-title class="text-body-2" style="font-family: monospace;">
              {{ selectedFile.content_sign }}
            </v-list-item-title>
          </v-list-item>

          <v-divider />

          <!-- 时间信息 -->
          <v-list-subheader>时间信息</v-list-subheader>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-calendar-plus</v-icon>
            </template>
            <v-list-item-subtitle>文件创建时间</v-list-item-subtitle>
            <v-list-item-title>{{ formatDateTime(selectedFile.file_create_time) }}</v-list-item-title>
          </v-list-item>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-calendar-edit</v-icon>
            </template>
            <v-list-item-subtitle>文件修改时间</v-list-item-subtitle>
            <v-list-item-title>{{ formatDateTime(selectedFile.file_update_time) }}</v-list-item-title>
          </v-list-item>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-calendar-clock</v-icon>
            </template>
            <v-list-item-subtitle>文件读取时间</v-list-item-subtitle>
            <v-list-item-title>{{ formatDateTime(selectedFile.file_read_time) }}</v-list-item-title>
          </v-list-item>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-radar</v-icon>
            </template>
            <v-list-item-subtitle>扫描发现时间</v-list-item-subtitle>
            <v-list-item-title>{{ formatDateTime(selectedFile.scan_time) }}</v-list-item-title>
          </v-list-item>

          <v-divider />

          <!-- 设备信息 -->
          <v-list-subheader>设备信息</v-list-subheader>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-ip-network</v-icon>
            </template>
            <v-list-item-subtitle>IP 地址</v-list-item-subtitle>
            <v-list-item-title>{{ selectedFile.ip || '-' }}</v-list-item-title>
          </v-list-item>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-ethernet</v-icon>
            </template>
            <v-list-item-subtitle>MAC 地址</v-list-item-subtitle>
            <v-list-item-title style="font-family: monospace;">{{ selectedFile.mac_address || '-' }}</v-list-item-title>
          </v-list-item>

          <v-divider />

          <!-- 记录信息 -->
          <v-list-subheader>记录信息</v-list-subheader>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-counter</v-icon>
            </template>
            <v-list-item-subtitle>扫描发现次数</v-list-item-subtitle>
            <v-list-item-title>{{ selectedFile.scan_found_count }}</v-list-item-title>
          </v-list-item>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-clock-plus-outline</v-icon>
            </template>
            <v-list-item-subtitle>记录创建时间</v-list-item-subtitle>
            <v-list-item-title>{{ formatDateTime(selectedFile.create_time) }}</v-list-item-title>
          </v-list-item>

          <v-list-item>
            <template v-slot:prepend>
              <v-icon size="small" color="grey">mdi-clock-edit-outline</v-icon>
            </template>
            <v-list-item-subtitle>记录更新时间</v-list-item-subtitle>
            <v-list-item-title>{{ formatDateTime(selectedFile.update_time) }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </template>
    </v-navigation-drawer>
  </div>
</template>
