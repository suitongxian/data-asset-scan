<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, type SystemConfig } from '@/services/api'

// 状态
const loading = ref(false)
const saving = ref(false)
const syncing = ref(false)
const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref('success')

// 表单数据
const workspace = ref('')
const dailyScanInterval = ref(15)
const controlType = ref('')
const scanAreaPath = ref('')
const scanExcludeDir = ref('')
const uploadServerUrl = ref('')
const homeDir = ref('')

// 同步状态
const lastSyncTime = ref<string | null>(null)

// 加载配置
const loadConfig = async () => {
  loading.value = true
  try {
    const config = await api.getConfig()
    workspace.value = config.workspace || ''
    dailyScanInterval.value = config.daily_scan_interval || 15
    controlType.value = config.control_type || '.doc,.docx,.ppt,.pptx,.xls,.xlsx,.pdf'
    scanAreaPath.value = config.scan_area_path || config.home_dir || ''
    scanExcludeDir.value = config.scan_exclude_dir || ''
    uploadServerUrl.value = config.upload_server_url || ''
    homeDir.value = config.home_dir || ''
    lastSyncTime.value = config.last_sync_time
  } catch (error) {
    showSnackbar('加载配置失败', 'error')
    console.error('Failed to load config:', error)
  } finally {
    loading.value = false
  }
}

// 保存配置
const saveConfig = async () => {
  saving.value = true
  try {
    await api.saveConfig({
      workspace: workspace.value,
      daily_scan_interval: dailyScanInterval.value,
      control_type: controlType.value,
      scan_area_path: scanAreaPath.value,
      scan_exclude_dir: scanExcludeDir.value,
      upload_server_url: uploadServerUrl.value,
    })
    showSnackbar('配置已保存', 'success')
  } catch (error) {
    showSnackbar('保存配置失败', 'error')
    console.error('Failed to save config:', error)
  } finally {
    saving.value = false
  }
}

// 同步数据资源
const syncResources = async () => {
  if (!uploadServerUrl.value) {
    showSnackbar('请先配置上传服务器地址', 'error')
    return
  }

  syncing.value = true
  try {
    const result = await api.syncSource()
    lastSyncTime.value = result.data.lastSyncTime

    if (result.data.errors && result.data.errors.length > 0) {
      showSnackbar(
        `同步完成: 成功 ${result.data.syncedCount} 条，失败 ${result.data.failedCount} 条`,
        'warning'
      )
      console.warn('Sync errors:', result.data.errors)
    } else {
      showSnackbar(result.message, 'success')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '同步失败'
    showSnackbar(message, 'error')
    console.error('Failed to sync resources:', error)
  } finally {
    syncing.value = false
  }
}

// 格式化同步时间
const formatSyncTime = (time: string | null): string => {
  if (!time) return '从未同步'
  const date = new Date(time)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

// 显示提示
const showSnackbar = (text: string, color: string) => {
  snackbarText.value = text
  snackbarColor.value = color
  snackbar.value = true
}

// 组件挂载时加载配置
onMounted(() => {
  loadConfig()
})
</script>

<template>
  <div>
    <v-card elevation="1">
      <v-card-title>
        <v-icon class="mr-2">mdi-cog</v-icon>
        系统设置
      </v-card-title>

      <v-card-text>
        <v-skeleton-loader v-if="loading" type="article" />

        <v-form v-else>
          <v-row>
            <v-col cols="12">
              <v-text-field
                v-model="workspace"
                label="工作空间目录"
                placeholder="/Users/xxx/workspace"
                variant="outlined"
                hint="需要重点监控的工作目录路径"
                persistent-hint
              />
            </v-col>

            <v-col cols="12" md="6">
              <v-text-field
                v-model="scanAreaPath"
                label="扫描区域"
                :placeholder="`留空则扫描 ${homeDir}`"
                variant="outlined"
                :hint="`文件扫描的根目录，留空默认扫描 ${homeDir}`"
                persistent-hint
              />
            </v-col>

            <v-col cols="12" md="6">
              <v-text-field
                v-model.number="dailyScanInterval"
                label="日常盘点间隔（分钟）"
                type="number"
                min="1"
                variant="outlined"
                hint="超过此时间间隔后自动进行日常盘点"
                persistent-hint
              />
            </v-col>

            <v-col cols="12">
              <v-text-field
                v-model="controlType"
                label="管控文件类型"
                placeholder=".doc,.docx,.ppt,.pptx,.xls,.xlsx,.pdf"
                variant="outlined"
                hint="需要扫描的文件后缀，多个后缀用逗号分隔"
                persistent-hint
              />
            </v-col>

            <v-col cols="12">
              <v-text-field
                v-model="scanExcludeDir"
                label="排除目录"
                placeholder="node_modules,.git,__pycache__"
                variant="outlined"
                hint="扫描时排除的目录名称，多个目录用逗号分隔"
                persistent-hint
              />
            </v-col>

            <v-col cols="12">
              <v-text-field
                v-model="uploadServerUrl"
                label="文件上传服务器地址"
                placeholder="http://localhost:3000"
                variant="outlined"
                hint="归类保护功能中文件上传的目标服务器地址"
                persistent-hint
              />
            </v-col>

            <!-- 数据同步区域 -->
            <v-col cols="12">
              <v-divider class="my-4" />
              <div class="text-subtitle-2 mb-3">数据同步</div>

              <v-row align="center">
                <v-col cols="12" sm="8">
                  <div class="text-body-2">
                    <v-icon class="mr-1" size="small">mdi-clock-outline</v-icon>
                    最后同步时间: <span class="ml-1">{{ formatSyncTime(lastSyncTime) }}</span>
                  </div>
                </v-col>
                <v-col cols="12" sm="4" class="text-right">
                  <v-btn
                    color="primary"
                    @click="syncResources"
                    :loading="syncing"
                    :disabled="syncing || saving || loading"
                    variant="outlined"
                    prepend-icon="mdi-sync"
                  >
                    同步数据
                  </v-btn>
                </v-col>
              </v-row>
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="outlined"
          @click="loadConfig"
          :disabled="loading || saving || syncing"
        >
          重置
        </v-btn>
        <v-btn
          color="primary"
          @click="saveConfig"
          :loading="saving"
          :disabled="loading || syncing"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- 提示消息 -->
    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>
