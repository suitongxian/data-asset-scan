<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { api, type DataResource } from '@/services/api'

// 状态
const loading = ref(false)
const resources = ref<DataResource[]>([])
const search = ref('')
const page = ref(1)
const pageSize = ref(50)
const total = ref(0)

// 打开文件状态
const openingFile = ref(false)

// 重要程度选项
const importanceLevelOptions = [
  { value: 0, text: '未分类', color: 'grey' },
  { value: 1, text: '核心', color: 'error' },
  { value: 2, text: '重要', color: 'warning' },
  { value: 3, text: '开放', color: 'success' },
  { value: 4, text: '隐私', color: 'info' }
]

// Snackbar状态
const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref('success')

// 表格列配置
const headers = [
  { title: '资源名称', key: 'resources_name', sortable: false },
  { title: '最早创建时间', key: 'first_create_time', sortable: false, width: '180px' },
  { title: '分布数量', key: 'source_count', sortable: false, width: '100px' },
  { title: '重要程度', key: 'importance_level', sortable: false, width: '120px' },
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

// 加载资源列表
const loadResources = async () => {
  loading.value = true
  try {
    const result = await api.getResources({
      search: search.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
      claimStatusFilter: 1 // 1=个人隐私
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

// 显示提示
const showSnackbar = (text: string, color: string) => {
  snackbarText.value = text
  snackbarColor.value = color
  snackbar.value = true
}

// 监听搜索条件变化
watch(search, () => {
  page.value = 1
  loadResources()
})

// 监听分页变化
watch([page, pageSize], () => {
  loadResources()
})

// 组件挂载时加载数据
onMounted(async () => {
  await loadResources()
})
</script>

<template>
  <div>
    <!-- 标题和提示 -->
    <v-card class="mb-4" elevation="1">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-shield-account</v-icon>
        个人文本隐私保护
      </v-card-title>
      <v-card-text>
        <div class="text-body-2 text-grey">
          查看和管理个人隐私类资源，点击资源名称可在本机打开文件
        </div>
      </v-card-text>
    </v-card>

    <!-- 搜索栏 -->
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
          <v-col cols="12" md="8" class="d-flex align-center justify-end">
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
          <v-chip size="small" variant="tonal" color="info">
            {{ item.source_count }}
          </v-chip>
        </template>

        <template v-slot:item.importance_level="{ item }">
          <v-chip
            size="small"
            variant="tonal"
            :color="getImportanceLevelColor(item.importance_level)"
          >
            {{ getImportanceLevelText(item.importance_level) }}
          </v-chip>
        </template>

        <template v-slot:no-data>
          <div class="text-center py-8">
            <v-icon size="64" color="grey-lighten-1">mdi-shield-off-outline</v-icon>
            <div class="mt-4 text-grey">暂无隐私资源数据</div>
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
</style>
