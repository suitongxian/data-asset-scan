<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api, type ArchiveFile } from '@/services/api'
import { userInfoManager } from '@/services/UserInfoManager'

const router = useRouter()

// 状态
const loading = ref(false)
const archiveFiles = ref<ArchiveFile[]>([])
const search = ref('')
const activeTab = ref('core') // 当前激活的tab: core, important, general

// 对话框状态
const reasonDialog = ref(false)
const reasonText = ref('')
const currentAction = ref<{ type: 'view' | 'download', file: ArchiveFile | null }>({ type: 'view', file: null })

// Snackbar状态
const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref('success')

// 表格列配置
const headers = [
  { title: '内容标题', key: 'content_title', sortable: true },
  { title: '摘要', key: 'content_summary', sortable: true, width: '300px' },
  { title: '文件类型', key: 'file_extension', sortable: true, width: '100px' },
  { title: '文件分类', key: 'archive_file_category', sortable: true, width: '120px' },
  { title: '操作', key: 'actions', sortable: false, width: '200px' },
]

// 获取文件后缀
const getFileExtension = (filename: string) => {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return ext ? `.${ext}` : '-'
}

// Tab配置
const tabs = [
  { key: 'core', label: '保密室', classification: '核心', icon: 'mdi-safe' },
  { key: 'important', label: '档案室', classification: '重要', icon: 'mdi-archive' },
  { key: 'general', label: '资料室', classification: '一般', icon: 'mdi-folder-multiple' },
]

// 根据搜索条件过滤的数据
const filteredBySearch = computed(() => {
  if (!search.value.trim()) {
    return archiveFiles.value
  }
  const keyword = search.value.toLowerCase()
  return archiveFiles.value.filter(file => {
    const title = (file.content_title || '').toLowerCase()
    const summary = (file.content_summary || '').toLowerCase()
    return title.includes(keyword) || summary.includes(keyword)
  })
})

// 核心数据（保密柜）
const coreFiles = computed(() => {
  return filteredBySearch.value.filter(f => f.data_classification === '核心')
})

// 重要数据（档案室）
const importantFiles = computed(() => {
  return filteredBySearch.value.filter(f => f.data_classification === '重要')
})

// 一般数据（资料室）
const generalFiles = computed(() => {
  return filteredBySearch.value.filter(f => f.data_classification === '一般')
})

// 当前tab显示的数据
const currentTabFiles = computed(() => {
  switch (activeTab.value) {
    case 'core': return coreFiles.value
    case 'important': return importantFiles.value
    case 'general': return generalFiles.value
    default: return []
  }
})

// 判断是否可以在线查看
const canView = (file: ArchiveFile) => {
  // 只有核心数据且是PDF文件才能在线查看
  const isPdf = file.archive_file_name.toLowerCase().endsWith('.pdf')
  const isCore = file.data_classification === '核心'
  return isPdf && isCore
}

// 判断是否可以下载
const canDownload = (file: ArchiveFile) => {
  // 核心文件不能下载
  // 重要、一般、公开数据都可以下载
  return file.data_classification !== '核心'
}

// 判断是否需要填写理由
const needReason = (file: ArchiveFile, action: 'view' | 'download') => {
  if (action === 'view') {
    // 在线查看需强制填写申请理由
    return true
  } else {
    // 下载时，重要数据需填写申请理由
    return file.data_classification === '重要'
  }
}

// 加载归档文件列表
const loadArchiveFiles = async () => {
  loading.value = true
  try {
    const result = await api.getArchiveFiles({
      page: 1,
      pageSize: 1000
    })
    archiveFiles.value = result.list
  } catch (error) {
    console.error('Failed to load archive files:', error)
    const message = error instanceof Error ? error.message : '加载归档文件失败'
    showSnackbar(message, 'error')
    archiveFiles.value = []
  } finally {
    loading.value = false
  }
}

// 处理在线查看
const handleView = (file: ArchiveFile) => {
  if (!canView(file)) {
    showSnackbar('该文件不支持在线查看', 'warning')
    return
  }

  if (needReason(file, 'view')) {
    // 需要填写理由
    currentAction.value = { type: 'view', file }
    reasonText.value = ''
    reasonDialog.value = true
  } else {
    // 不需要理由，直接查看
    executeView(file, '')
  }
}

// 执行在线查看
const executeView = async (file: ArchiveFile, reason: string) => {
  const userInfo = await userInfoManager.getUserInfo()
  if (!userInfo) {
    showSnackbar('请先登录', 'warning')
    return
  }

  loading.value = true
  try {
    const blob = await api.borrowDownload({
      archive_id: file.id,
      borrower_name: userInfo.user_name,
      borrower_department: userInfo.company_name,
      borrow_reason: reason || undefined,
      borrow_method: 1  // 1=在线查看
    })

    // 将 blob 转换为 base64
    const arrayBuffer = await blob.arrayBuffer()
    const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => {
      return data + String.fromCharCode(byte)
    }, ''))

    // 在新窗口打开 PDF 查看器
    const url = router.resolve({
      name: 'PdfViewer',
      query: { data: base64 }
    }).href
    window.open(url, '_blank')

    showSnackbar('文件已在新窗口打开', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : '在线查看失败'
    showSnackbar(message, 'error')
  } finally {
    loading.value = false
  }
}

// 处理下载
const handleDownload = (file: ArchiveFile) => {
  if (!canDownload(file)) {
    showSnackbar('核心文件不能下载', 'warning')
    return
  }

  if (needReason(file, 'download')) {
    // 需要填写理由
    currentAction.value = { type: 'download', file }
    reasonText.value = ''
    reasonDialog.value = true
  } else {
    // 不需要理由，直接下载
    executeDownload(file, '')
  }
}

// 执行下载
const executeDownload = async (file: ArchiveFile, reason: string) => {
  const userInfo = await userInfoManager.getUserInfo()
  if (!userInfo) {
    showSnackbar('请先登录', 'warning')
    return
  }

  loading.value = true
  try {
    // 一般文件下载时，如果没有填写理由，使用固定理由
    const finalReason = reason || (file.data_classification === '一般' ? '开放文件下载' : undefined)

    const blob = await api.borrowDownload({
      archive_id: file.id,
      borrower_name: userInfo.user_name,
      borrower_department: userInfo.company_name,
      borrow_reason: finalReason,
      borrow_method: 2  // 2=下载
    })

    // 创建下载链接
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.archive_file_name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    showSnackbar('文件下载成功', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : '文件下载失败'
    showSnackbar(message, 'error')
  } finally {
    loading.value = false
  }
}

// 确认理由对话框
const confirmReason = () => {
  if (!reasonText.value.trim()) {
    showSnackbar('请填写申请理由', 'warning')
    return
  }

  const { type, file } = currentAction.value
  if (!file) return

  reasonDialog.value = false

  if (type === 'view') {
    executeView(file, reasonText.value)
  } else {
    executeDownload(file, reasonText.value)
  }
}

// 显示提示
const showSnackbar = (text: string, color: string) => {
  snackbarText.value = text
  snackbarColor.value = color
  snackbar.value = true
}

// 组件挂载时加载数据
onMounted(async () => {
  await loadArchiveFiles()
})
</script>

<template>
  <div>
    <!-- 标题和提示 -->
    <v-card class="mb-4" elevation="1">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-book-open-variant</v-icon>
        文件借阅
      </v-card-title>
      <v-card-text>
        <div class="text-body-2 text-grey">
          查看和下载归档文件。只有核心PDF文件可在线查看，重要、一般、公开文件可下载
        </div>
      </v-card-text>
    </v-card>

    <!-- 搜索栏 -->
    <v-card class="mb-4" elevation="1">
      <v-card-text>
        <v-text-field
          v-model="search"
          prepend-inner-icon="mdi-magnify"
          label="搜索标题或摘要"
          variant="outlined"
          density="compact"
          hide-details
          clearable
        />
      </v-card-text>
    </v-card>

    <!-- Tab页和文件表格 -->
    <v-card elevation="1">
      <v-tabs v-model="activeTab" color="primary">
        <v-tab
          v-for="tab in tabs"
          :key="tab.key"
          :value="tab.key"
        >
          <v-icon start>{{ tab.icon }}</v-icon>
          {{ tab.label }}
          <v-chip size="x-small" class="ml-2" variant="tonal">
            {{ tab.key === 'core' ? coreFiles.length : tab.key === 'important' ? importantFiles.length : generalFiles.length }}
          </v-chip>
        </v-tab>
      </v-tabs>

      <v-divider />

      <v-data-table
        :headers="headers"
        :items="currentTabFiles"
        :loading="loading"
        item-value="id"
        :items-per-page="-1"
        hide-default-footer
      >
        <template v-slot:item.content_title="{ item }">
          <div class="text-truncate" style="max-width: 300px" :title="item.content_title || '-'">
            {{ item.content_title || '-' }}
          </div>
        </template>

        <template v-slot:item.content_summary="{ item }">
          <div class="text-truncate" style="max-width: 280px" :title="item.content_summary || '-'">
            {{ item.content_summary || '-' }}
          </div>
        </template>

        <template v-slot:item.file_extension="{ item }">
          <v-chip size="small" variant="tonal" color="info">
            {{ getFileExtension(item.archive_file_name) }}
          </v-chip>
        </template>

        <template v-slot:item.actions="{ item }">
          <div class="d-flex gap-2">
            <v-btn
              size="small"
              variant="tonal"
              color="primary"
              :disabled="!canView(item)"
              @click="handleView(item)"
            >
              <v-icon start size="small">mdi-eye</v-icon>
              在线查看
            </v-btn>
            <v-btn
              size="small"
              variant="tonal"
              color="success"
              :disabled="!canDownload(item)"
              @click="handleDownload(item)"
            >
              <v-icon start size="small">mdi-download</v-icon>
              下载
            </v-btn>
          </div>
        </template>

        <template v-slot:no-data>
          <div class="text-center py-8">
            <v-icon size="64" color="grey-lighten-1">mdi-folder-open-outline</v-icon>
            <div class="mt-4 text-grey">暂无归档文件</div>
          </div>
        </template>
      </v-data-table>
    </v-card>

    <!-- 申请理由对话框 -->
    <v-dialog v-model="reasonDialog" max-width="500">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon class="mr-2">mdi-text-box</v-icon>
          填写申请理由
        </v-card-title>
        <v-card-text>
          <v-textarea
            v-model="reasonText"
            label="申请理由"
            placeholder="请填写借阅申请理由"
            variant="outlined"
            rows="4"
            auto-grow
            :rules="[v => !!v || '申请理由不能为空']"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="reasonDialog = false">取消</v-btn>
          <v-btn color="primary" variant="tonal" @click="confirmReason">确认</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 提示消息 -->
    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>
