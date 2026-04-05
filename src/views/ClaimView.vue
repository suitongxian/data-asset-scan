<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { api, type DataResource, type SystemConfig, type ResourcesStatistics, type FileItem } from '@/services/api'
import { userInfoManager } from '@/services/UserInfoManager'
import { saveTabState, loadTabState } from '@/services/TabStateManager'

// 选项卡类型
type TabType = 'workspace' | 'new_access' | 'history_inventory'

// 当前选中的选项卡
const activeTab = ref<TabType>('workspace')

// 系统配置
const config = ref<SystemConfig | null>(null)

// 统计数据
const statistics = ref<ResourcesStatistics | null>(null)

// 状态
const loading = ref(false)
const resources = ref<DataResource[]>([])
const search = ref('')
const page = ref(1)
const pageSize = ref(50)
const total = ref(0)
const claimStatusFilter = ref(0) // -1 表示全部

// 选中项
const selectedIds = ref<number[]>([])

// 提交状态
const submitting = ref(false)

// 打开文件状态
const openingFile = ref(false)

// 副本列表对话框状态
const showCopiesDialog = ref(false)
const currentCopies = ref<FileItem[]>([])
const copiesLoading = ref(false)
const currentResourceName = ref('')

// 认领分类选项
const claimStatusOptions = [
  { value: 0, text: '未分类', color: 'grey' },
  { value: 1, text: '个人隐私', color: 'error' },
  { value: 2, text: '个人工作', color: 'primary' },
  { value: 3, text: '非责任类', color: 'warning' }
]

// 过滤选项（含全部）
const filterOptions = [
  { value: -1, text: '全部' },
  ...claimStatusOptions
]

// Snackbar状态
const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref('success')

// 表格列配置
const headers = [
  { title: '资源名称', key: 'resources_name', sortable: true },
  { title: '最早创建时间', key: 'first_create_time', sortable: true, width: '180px' },
  { title: '分布数量', key: 'source_count', sortable: true, width: '100px' },
  { title: '认领状态', key: 'claim_status', sortable: false, width: '120px' },
]

// 副本列表表格列配置
const copiesHeaders = [
  { title: '文件路径', key: 'path', sortable: false },
  { title: '文件大小', key: 'file_size', sortable: false, width: '100px' },
]

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

// 格式化文件大小
const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 获取认领状态文本
const getClaimStatusText = (status: number) => {
  const option = claimStatusOptions.find(o => o.value === status)
  return option?.text || '未知'
}

// 获取认领状态颜色
const getClaimStatusColor = (status: number) => {
  const option = claimStatusOptions.find(o => o.value === status)
  return option?.color || 'grey'
}

// 计算总页数
const totalPages = computed(() => {
  return Math.ceil(total.value / pageSize.value)
})

// 是否可以执行认领操作
const canClaim = computed(() => {
  return selectedIds.value.length > 0
})

// 计算各tab的统计数据
const workspacePendingCount = computed(() => {
  if (!statistics.value) return 0
  return statistics.value.workspaceTotalCount - statistics.value.workspaceClaimedCount
})

const newAccessPendingCount = computed(() => {
  if (!statistics.value) return 0
  if (statistics.value.nonHistoryFileCount < 0) return 0
  return statistics.value.nonHistoryFileCount - statistics.value.nonHistoryClaimedCount
})

const historyProcessRate = computed(() => {
  if (!statistics.value) return null
  if (statistics.value.historyFileCount <= 0) return null
  return (statistics.value.workspaceClaimedCount / statistics.value.historyFileCount * 100).toFixed(1)
})

// 加载配置
const loadConfig = async () => {
  try {
    config.value = await api.getConfig()
  } catch (error) {
    console.error('Failed to load config:', error)
  }
}

// 加载统计数据
const loadStatistics = async () => {
  try {
    statistics.value = await api.getResourcesStatistics()
  } catch (error) {
    console.error('Failed to load statistics:', error)
  }
}

// 加载资源列表
const loadResources = async () => {
  loading.value = true
  try {
    const result = await api.getResources({
      search: search.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
      claimStatusFilter: claimStatusFilter.value,
      businessTypeFilter: activeTab.value
    })
    resources.value = result.resources
    total.value = result.total
    // 清空选中项
    selectedIds.value = []
  } catch (error) {
    console.error('Failed to load resources:', error)
    resources.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

// 直接认领（选择分类后立即提交）
const handleClaim = async (claimStatus: number) => {
  if (!canClaim.value) {
    showSnackbar('请先选择要认领的资源', 'warning')
    return
  }

  // 从 UserInfoManager 获取用户信息
  const userInfo = await userInfoManager.getUserInfo()
  if (!userInfo) {
    showSnackbar('请先登录', 'warning')
    return
  }

  submitting.value = true
  try {
    const result = await api.batchClaim({
      ids: selectedIds.value,
      is_claimed: 1,
      claim_status: claimStatus,
      claimant_name: userInfo.user_name,
      claimant_unit: userInfo.company_name
    })

    showSnackbar(`成功认领 ${result.updatedCount} 条资源`, 'success')
    // 刷新列表和统计数据
    await loadResources()
    loadStatistics()
  } catch (error) {
    const message = error instanceof Error ? error.message : '认领失败'
    showSnackbar(message, 'error')
  } finally {
    submitting.value = false
  }
}

// 打开文件
const handleOpenFile = async (item: DataResource) => {
  if (!item.content_sign) {
    showSnackbar('文件内容签名不存在', 'warning')
    return
  }

  openingFile.value = true
  try {
    const result = await api.openFile(item.content_sign)
    if (result.success) {
      showSnackbar(result.message, 'success')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '打开文件失败'
    showSnackbar(message, 'error')
  } finally {
    openingFile.value = false
  }
}

// 查看副本列表
const handleViewCopies = async (item: DataResource) => {
  if (!item.content_sign) {
    showSnackbar('文件内容签名不存在', 'warning')
    return
  }

  copiesLoading.value = true
  currentResourceName.value = item.resources_name || '未命名资源'
  showCopiesDialog.value = true

  try {
    const result = await api.getCopies(item.content_sign)
    currentCopies.value = result.copies
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取副本列表失败'
    showSnackbar(message, 'error')
    currentCopies.value = []
  } finally {
    copiesLoading.value = false
  }
}

// 显示提示
const showSnackbar = (text: string, color: string) => {
  snackbarText.value = text
  snackbarColor.value = color
  snackbar.value = true
}

// 监听选项卡变化，保存状态
watch(activeTab, (newTab) => {
  saveTabState(newTab)
})

// 监听搜索和过滤条件变化
watch([search, claimStatusFilter, activeTab], () => {
  page.value = 1
  loadResources()
})

// 监听分页变化
watch([page, pageSize], () => {
  loadResources()
})

// 组件挂载时加载数据
onMounted(async () => {
  // 加载选项卡状态
  const savedTab = loadTabState()
  if (savedTab && ['workspace', 'new_access', 'history_inventory'].includes(savedTab)) {
    activeTab.value = savedTab as TabType
  }
  loadConfig()
  loadStatistics()
  await loadResources()
})
</script>

<template>
  <div>
    <!-- 标题和提示 -->
    <v-card class="mb-4" elevation="1">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-account-check</v-icon>
        责任认领
      </v-card-title>
      <v-card-text>
        <div class="text-body-2 text-grey">
          对信息资源进行责任认领分类，批量选中后点击"认领"按钮进行认领操作
        </div>
      </v-card-text>
    </v-card>

    <!-- 选项卡 -->
    <div class="d-flex align-center mb-4">
      <v-tabs v-model="activeTab" color="primary">
        <v-tab value="workspace">
          工作文件档案管理
          <v-tooltip location="bottom" v-if="statistics && workspacePendingCount > 0">
            <template v-slot:activator="{ props }">
              <v-chip v-bind="props" size="x-small" color="error" class="ml-2">
                {{ workspacePendingCount }}
              </v-chip>
            </template>
            <span>待认领数：{{ workspacePendingCount }}</span>
          </v-tooltip>
        </v-tab>
        <v-tab value="new_access">
          新数据登记管理
          <v-tooltip location="bottom" v-if="statistics && newAccessPendingCount > 0">
            <template v-slot:activator="{ props }">
              <v-chip v-bind="props" size="x-small" color="error" class="ml-2">
                {{ newAccessPendingCount }}
              </v-chip>
            </template>
            <span>待认领数：{{ newAccessPendingCount }}</span>
          </v-tooltip>
        </v-tab>
        <v-tab value="history_inventory">
          数据资源专项治理
          <v-tooltip location="bottom" v-if="historyProcessRate !== null">
            <template v-slot:activator="{ props }">
              <v-chip v-bind="props" size="x-small" color="success" class="ml-2">
                {{ historyProcessRate }}%
              </v-chip>
            </template>
            <span>处理率：{{ historyProcessRate }}%</span>
          </v-tooltip>
        </v-tab>
      </v-tabs>
      <v-spacer />
      <v-chip
        v-if="activeTab !== 'workspace' && config?.full_inventory_time"
        color="info"
        variant="tonal"
        size="small"
      >
        历吏封帐时间：{{ formatDateTime(config.full_inventory_time) }}
      </v-chip>
    </div>

    <!-- 搜索和过滤栏 -->
    <v-card class="mb-4" elevation="1">
      <v-card-text>
        <v-row align="center">
          <v-col cols="12" md="4">
            <v-text-field
              v-model="search"
              prepend-inner-icon="mdi-magnify"
              label="搜索资源名称"
              variant="outlined"
              density="compact"
              hide-details
              clearable
            />
          </v-col>
          <v-col cols="12" md="3">
            <v-select
              v-model="claimStatusFilter"
              :items="filterOptions"
              item-value="value"
              item-title="text"
              label="认领状态过滤"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="5" class="d-flex align-center justify-end">
            <span class="text-body-2 text-grey mr-4">
              已选 {{ selectedIds.length }} 条，共 {{ total }} 条记录
            </span>
            <v-menu>
              <template v-slot:activator="{ props }">
                <v-btn
                  color="primary"
                  variant="tonal"
                  :disabled="!canClaim || submitting"
                  :loading="submitting"
                  v-bind="props"
                >
                  <v-icon start>mdi-account-check</v-icon>
                  认领
                  <v-icon end>mdi-menu-down</v-icon>
                </v-btn>
              </template>
              <v-list density="compact">
                <v-list-item
                  v-for="option in claimStatusOptions.filter(o => o.value !== 0)"
                  :key="option.value"
                  @click="handleClaim(option.value)"
                >
                  <template v-slot:prepend>
                    <v-icon :color="option.color" size="small">mdi-circle</v-icon>
                  </template>
                  <v-list-item-title>{{ option.text }}</v-list-item-title>
                </v-list-item>
              </v-list>
            </v-menu>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- 资源表格 -->
    <v-card elevation="1">
      <v-data-table
        v-model="selectedIds"
        :headers="headers"
        :items="resources"
        :loading="loading"
        item-value="data_resources_id"
        :items-per-page="pageSize"
        show-select
        hide-default-footer
      >
        <template v-slot:item.resources_name="{ item }">
          <div class="d-flex align-center">
            <v-icon size="small" class="mr-2" color="grey">
              mdi-file-document-outline
            </v-icon>
            <div
              class="text-truncate resource-name-link"
              style="max-width: 350px"
              :title="item.resources_name || '-'"
              @click="handleOpenFile(item)"
            >
              {{ item.resources_name || '-' }}
            </div>
          </div>
        </template>

        <template v-slot:item.first_create_time="{ item }">
          {{ formatDate(item.first_create_time) }}
        </template>

        <template v-slot:item.source_count="{ item }">
          <v-chip
            size="small"
            variant="tonal"
            color="info"
            class="cursor-pointer"
            @click="handleViewCopies(item)"
          >
            {{ item.source_count }}
          </v-chip>
        </template>

        <template v-slot:item.claim_status="{ item }">
          <v-chip
            size="small"
            variant="tonal"
            :color="getClaimStatusColor(item.claim_status)"
          >
            {{ getClaimStatusText(item.claim_status) }}
          </v-chip>
        </template>

        <template v-slot:no-data>
          <div class="text-center py-8">
            <v-icon size="64" color="grey-lighten-1">mdi-folder-open-outline</v-icon>
            <div class="mt-4 text-grey">暂无资源数据</div>
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

    <!-- 提示消息 -->
    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">
      {{ snackbarText }}
    </v-snackbar>

    <!-- 副本列表对话框 -->
    <v-dialog v-model="showCopiesDialog" max-width="800px">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon class="mr-2">mdi-content-copy</v-icon>
          副本列表
        </v-card-title>
        <v-card-subtitle>资源：{{ currentResourceName }}</v-card-subtitle>
        <v-divider />
        <v-card-text class="pa-0">
          <v-data-table
            :headers="copiesHeaders"
            :items="currentCopies"
            :loading="copiesLoading"
            item-value="data_distribution_id"
            hide-default-footer
            density="compact"
          >
            <template v-slot:item.path="{ item }">
              {{ item.path }}
            </template>

            <template v-slot:item.file_size="{ item }">
              {{ formatFileSize(item.file_size) }}
            </template>

            <template v-slot:no-data>
              <div class="text-center py-4 text-grey">
                暂无副本数据
              </div>
            </template>
          </v-data-table>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="text" @click="showCopiesDialog = false">
            关闭
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.resource-name-link {
  cursor: pointer;
  color: #1976d2;
  text-decoration: none;
  transition: color 0.2s;
}

.resource-name-link:hover {
  color: #1565c0;
  text-decoration: underline;
}

.cursor-pointer {
  cursor: pointer;
}

.cursor-pointer:hover {
  opacity: 0.8;
}
</style>
