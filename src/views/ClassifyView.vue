<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { api, type DataResource, type SystemConfig, type SingleClassifyParams, type ResourcesStatistics, type FileItem } from '@/services/api'
import { saveTabState, loadTabState } from '@/services/TabStateManager'

// 选项卡类型
type TabType = 'workspace' | 'new_access' | 'history_inventory'

// 当前选中的选项卡
const activeTab = ref<TabType>('workspace')

// 系统配置
const config = ref<SystemConfig | null>(null)

// 归类保护统计数据
const classifyStats = ref<ResourcesStatistics | null>(null)

// 状态
const loading = ref(false)
const resources = ref<DataResource[]>([])
const search = ref('')
const page = ref(1)
const pageSize = ref(50)
const total = ref(0)
const importanceLevelFilter = ref(0) // -1 表示全部

// 提交状态
const submitting = ref(false)

// 归类保护弹窗状态
const classifyDialog = ref(false)
const classifyData = ref<SingleClassifyParams | null>(null)
const classifyLoading = ref(false)
const contentSignForOpenFile = ref<string | null>(null)

// 副本列表对话框状态
const showCopiesDialog = ref(false)
const currentCopies = ref<FileItem[]>([])
const copiesLoading = ref(false)
const currentResourceName = ref('')

// 认领分类选项（用于显示）
const claimStatusOptions = [
  { value: 0, text: '未认领', color: 'grey' },
  { value: 1, text: '个人隐私', color: 'error' },
  { value: 2, text: '个人工作', color: 'primary' },
  { value: 3, text: '非责任类', color: 'warning' }
]

// 档案夹历史记录相关
const HISTORY_STORAGE_KEY = 'classify_folder_history'
const folderHistory = ref<string[]>([])

// 读取历史记录
const loadFolderHistory = () => {
  try {
    const saved = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (saved) {
      folderHistory.value = JSON.parse(saved)
    }
  } catch (error) {
    console.error('Failed to load folder history:', error)
    folderHistory.value = []
  }
}

// 保存历史记录
const saveFolderHistory = (folder: string) => {
  if (!folder || folder.trim() === '') return

  const trimmedFolder = folder.trim()
  // 移除重复项并添加到开头
  const newHistory = [trimmedFolder, ...folderHistory.value.filter(f => f !== trimmedFolder)]
  // 只保留最近10条
  folderHistory.value = newHistory.slice(0, 10)

  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(folderHistory.value))
  } catch (error) {
    console.error('Failed to save folder history:', error)
  }
}

// 重要程度选项
const importanceLevelOptions = [
  { value: 0, text: '未保护', color: 'grey' },
  { value: 1, text: '核心要件-保密柜', color: 'error' },
  { value: 2, text: '重要文件-档案柜', color: 'warning' },
  { value: 3, text: '一般文件-资料柜', color: 'success' },
  { value: 5, text: '不予归档', color: 'grey' },
]

// 归类保护方式选项（用于弹窗选择）
const protectionMethodOptions = [
  { value: 1, label: '保密柜', subtitle: '核心要件', color: '#e53935' },
  { value: 2, label: '档案柜', subtitle: '重要文件', color: '#f57c00' },
  { value: 3, label: '资料柜', subtitle: '一般文件', color: '#43a047' },
  { value: 5, label: '不予归档', subtitle: '不进行归档保护', color: '#757575' },
]

// 过滤选项（含全部）
const filterOptions = [
  { value: -1, text: '全部' },
  ...importanceLevelOptions
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
  { title: '认领状态', key: 'claim_status', sortable: true, width: '120px' },
  { title: '保护方式', key: 'importance_level', sortable: true, width: '180px' },
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

// 获取重要程度文本
const getImportanceLevelText = (level: number) => {
  const option = importanceLevelOptions.find(o => o.value === level)
  return option?.text || '未知'
}

// 获取重要程度颜色
const getImportanceLevelColor = (level: number) => {
  const option = importanceLevelOptions.find(o => o.value === level)
  return option?.color || 'grey'
}

// 计算总页数
const totalPages = computed(() => {
  return Math.ceil(total.value / pageSize.value)
})

// 归类保护统计数据
const workspacePendingClassifyCount = computed(() => classifyStats.value?.workspacePendingClassifyCount ?? 0)
const historyPendingClassifyCount = computed(() => classifyStats.value?.historyPendingClassifyCount ?? 0)
const nonHistoryPendingClassifyCount = computed(() => classifyStats.value?.nonHistoryPendingClassifyCount ?? 0)

// 打开归类保护弹窗
const openClassifyDialog = (item: DataResource) => {
  const currentFolder = item.content_subject || ''
  // 如果当前有档案夹值则使用当前值，否则使用最近的历史记录
  const defaultFolder = currentFolder || (folderHistory.value.length > 0 ? folderHistory.value[0] : '')
  classifyData.value = {
    data_resources_id: item.data_resources_id,
    importance_level: item.importance_level || 0,
    resources_name: item.resources_name || '',
    resources_desc: item.resources_desc || '',
    content_subject: defaultFolder
  }
  contentSignForOpenFile.value = item.content_sign
  classifyDialog.value = true
}

// 关闭归类保护弹窗
const closeClassifyDialog = () => {
  classifyDialog.value = false
  classifyData.value = null
  contentSignForOpenFile.value = null
}

// 选择保护方式
const selectProtectionMethod = (value: number) => {
  if (classifyData.value) {
    classifyData.value.importance_level = value
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

// 确认归类保护
const confirmClassify = async () => {
  if (!classifyData.value) return

  // 验证是否已选择保护方式（1,2,3,5 都是有效值）
  if (!classifyData.value.importance_level || classifyData.value.importance_level === 0) {
    showSnackbar('请选择保护方式', 'warning')
    return
  }

  // 不予归档时不需要档案夹
  if (classifyData.value.importance_level === 5) {
    classifyData.value.content_subject = ''
  }

  classifyLoading.value = true
  try {
    const result = await api.singleClassify(classifyData.value)
    showSnackbar(result.message || '归类保护成功', 'success')
    // 保存档案夹历史记录（仅限归档操作）
    if (classifyData.value.content_subject && classifyData.value.importance_level !== 5) {
      saveFolderHistory(classifyData.value.content_subject)
    }
    // 刷新列表
    await loadResources()
    // 刷新统计数据
    await loadClassifyStats()
    // 关闭弹窗
    closeClassifyDialog()
  } catch (error) {
    const message = error instanceof Error ? error.message : '归类失败'
    showSnackbar(message, 'error')
  } finally {
    classifyLoading.value = false
  }
}

// 查看文件
const handleViewFile = async () => {
  if (!contentSignForOpenFile.value) return

  try {
    await api.openFile(contentSignForOpenFile.value)
    showSnackbar('文件已打开', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : '打开文件失败'
    showSnackbar(message, 'error')
  }
}

// 加载配置
const loadConfig = async () => {
  try {
    config.value = await api.getConfig()
  } catch (error) {
    console.error('Failed to load config:', error)
  }
}

// 加载归类保护统计数据
const loadClassifyStats = async () => {
  try {
    classifyStats.value = await api.getResourcesStatistics()
  } catch (error) {
    console.error('Failed to load classify stats:', error)
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
      importanceLevelFilter: importanceLevelFilter.value,
      businessTypeFilter: activeTab.value,
      claimStatusIn: [2]  // 只显示个人工作数据 (claim_status=2)
    })
    resources.value = result.resources
    total.value = result.total
  } catch (error) {
    console.error('Failed to load resources:', error)
    resources.value = []
    total.value = 0
  } finally {
    loading.value = false
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
watch([search, importanceLevelFilter, activeTab], () => {
  page.value = 1
  loadResources()
})

// 监听分页变化
watch([page, pageSize], () => {
  loadResources()
})

// 组件挂载时加载数据
onMounted(async () => {
  // 加载档案夹历史记录
  loadFolderHistory()
  // 加载选项卡状态
  const savedTab = loadTabState()
  if (savedTab && ['workspace', 'new_access', 'history_inventory'].includes(savedTab)) {
    activeTab.value = savedTab as TabType
  }
  loadConfig()
  loadClassifyStats()
  await loadResources()
})
</script>

<template>
  <div>
    <!-- 标题和提示 -->
    <v-card class="mb-4" elevation="1">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-folder-lock</v-icon>
        归类保护
      </v-card-title>
      <v-card-text>
        <div class="text-body-2 text-grey">
          对已认领的个人工作信息资源进行分级保护
        </div>
      </v-card-text>
    </v-card>

    <!-- 选项卡 -->
    <div class="d-flex align-center mb-4">
      <v-tabs v-model="activeTab" color="primary">
        <v-tab value="workspace">
          工作文件档案管理
          <v-chip
            v-if="workspacePendingClassifyCount > 0"
            size="small"
            color="error"
            class="ml-2"
          >
            {{ workspacePendingClassifyCount }}
          </v-chip>
        </v-tab>
        <v-tab value="new_access">
          新数据登记管理
          <v-chip
            v-if="nonHistoryPendingClassifyCount > 0"
            size="small"
            color="error"
            class="ml-2"
          >
            {{ nonHistoryPendingClassifyCount }}
          </v-chip>
        </v-tab>
        <v-tab value="history_inventory">
          历史数据专项治理
          <v-chip
            v-if="historyPendingClassifyCount > 0"
            size="small"
            color="error"
            class="ml-2"
          >
            {{ historyPendingClassifyCount }}
          </v-chip>
        </v-tab>
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
              v-model="importanceLevelFilter"
              :items="filterOptions"
              item-value="value"
              item-title="text"
              label="重要程度过滤"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="5" class="d-flex align-center justify-end">
            <span class="text-body-2 text-grey">
              共 {{ total }} 条记录
            </span>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- 资源表格 -->
    <v-card elevation="1">
      <v-data-table
        :headers="headers"
        :items="resources"
        :loading="loading"
        item-value="data_resources_id"
        :items-per-page="pageSize"
        hide-default-footer
      >
        <template v-slot:item.resources_name="{ item }">
          <div class="d-flex align-center">
            <v-icon size="small" class="mr-2" color="grey">
              mdi-file-document-outline
            </v-icon>
            <div class="text-truncate" style="max-width: 300px" :title="item.resources_name || '-'">
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

        <template v-slot:item.importance_level="{ item }">
          <div class="d-flex align-center gap-2">
            <v-chip
              v-if="item.importance_level === 0"
              size="small"
              variant="tonal"
              color="grey"
            >
              未保护
            </v-chip>
            <v-chip
              v-else
              size="small"
              variant="tonal"
              :color="getImportanceLevelColor(item.importance_level)"
            >
              {{ getImportanceLevelText(item.importance_level) }}
            </v-chip>
            <v-btn
              size="small"
              color="primary"
              variant="text"
              density="compact"
              @click="openClassifyDialog(item)"
            >
              <v-icon size="small" class="mr-1">mdi-shield-check</v-icon>
              归类保护
            </v-btn>
          </div>
        </template>

        <template v-slot:no-data>
          <div class="text-center py-8">
            <v-icon size="64" color="grey-lighten-1">mdi-folder-open-outline</v-icon>
            <div class="mt-4 text-grey">暂无资源数据</div>
            <div class="mt-2 text-caption text-grey">请先进行责任认领</div>
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

    <!-- 归类保护弹窗 -->
    <v-dialog v-model="classifyDialog" max-width="600px" persistent>
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon class="mr-2">mdi-shield-check</v-icon>
          文件归档登记表(本地)
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" @click="closeClassifyDialog" />
        </v-card-title>

        <v-card-text class="pt-4" v-if="classifyData">
          <!-- 保护方式选择 -->
          <div class="mb-6">
            <div class="text-subtitle-2 mb-3">保护方式</div>
            <v-row>
              <v-col v-for="option in protectionMethodOptions" :key="option.value" cols="6">
                <v-card
                  :class="[
                    'pa-3 cursor-pointer border',
                    classifyData?.importance_level === option.value ? 'selected-card' : 'unselected-card'
                  ]"
                  :style="{
                    borderColor: classifyData?.importance_level === option.value ? option.color : '#e0e0e0',
                    backgroundColor: classifyData?.importance_level === option.value ? `${option.color}15` : 'white'
                  }"
                  elevation="2"
                  @click="selectProtectionMethod(option.value)"
                >
                  <div class="d-flex flex-column align-center text-center">
                    <v-icon
                      size="32"
                      :color="classifyData?.importance_level === option.value ? option.color : 'grey'"
                      class="mb-2"
                    >
                      {{ option.value === 1 ? 'mdi-lock' : option.value === 2 ? 'mdi-archive' : option.value === 3 ? 'mdi-folder' : 'mdi-cancel' }}
                    </v-icon>
                    <div class="text-body-1 font-weight-medium">{{ option.label }}</div>
                    <div class="text-caption text-grey mt-1">{{ option.subtitle }}</div>
                  </div>
                </v-card>
              </v-col>
            </v-row>
          </div>

          <!-- 资源信息表单 -->
          <v-form>
            <v-text-field
              v-model="classifyData!.resources_name"
              label="资源标题"
              variant="outlined"
              density="compact"
              prepend-inner-icon="mdi-file-document"
              class="mb-2"
            />
            <v-textarea
              v-model="classifyData!.resources_desc"
              label="内容摘要"
              variant="outlined"
              density="compact"
              rows="3"
              prepend-inner-icon="mdi-text"
              class="mb-2"
            />
            <v-combobox
              v-model="classifyData!.content_subject"
              :items="folderHistory"
              label="档案夹"
              chips
              variant="outlined"
              density="compact"
              prepend-inner-icon="mdi-tag"
              clearable
              hide-no-data
              :menu-props="{ maxHeight: 300 }"
            />
          </v-form>
        </v-card-text>

        <v-card-actions class="pt-0">
          <v-spacer />
          <v-btn
            color="grey"
            variant="text"
            prepend-icon="mdi-eye-outline"
            @click="handleViewFile"
            :disabled="!contentSignForOpenFile"
          >
            查看文件
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-check"
            :loading="classifyLoading"
            :disabled="classifyLoading"
            @click="confirmClassify"
          >
            确认归档
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

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
.cursor-pointer {
  cursor: pointer;
}

.selected-card {
  border: 2px solid !important;
}

.unselected-card {
  border: 1px solid #e0e0e0;
}

.unselected-card:hover {
  border-color: #bdbdbd;
}

.gap-2 {
  gap: 8px;
}

.cursor-pointer {
  cursor: pointer;
}

.cursor-pointer:hover {
  opacity: 0.8;
}
</style>
