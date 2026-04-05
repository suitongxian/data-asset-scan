<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useTheme } from 'vuetify'
import { useRouter, useRoute } from 'vue-router'
import { api, type SystemConfig } from '@/services/api'
import { userInfoManager, type UserInfo } from '@/services/UserInfoManager'

const theme = useTheme()
const router = useRouter()
const route = useRoute()
const drawer = ref(true)
const config = ref<SystemConfig | null>(null)
const currentUserInfo = ref<UserInfo | null>(null)

// 检测是否为 PDF 查看器页面
const isPdfViewer = computed(() => {
  return route.name === 'PdfViewer'
})

// 用户信息弹窗相关
const showUserInfoDialog = ref(false)
const savingUserInfo = ref(false)
const userInfoForm = ref({
  name: '',
  companyName: '',
  departmentName: '',
  phone: '',
  workAddress: ''
})
const formValid = ref(false)
const formRules = {
  required: (v: string) => !!v?.trim() || '此项为必填项'
}

const toggleTheme = () => {
  theme.global.name.value = theme.global.current.value.dark ? 'light' : 'dark'
}

// 检查用户信息
const checkUserInfo = async () => {
  const userInfo = await userInfoManager.getUserInfo()
  currentUserInfo.value = userInfo
  if (!userInfo) {
    showUserInfoDialog.value = true
  }
}

// 打开用户信息编辑弹窗
const openUserInfoDialog = () => {
  if (currentUserInfo.value) {
    userInfoForm.value = {
      name: currentUserInfo.value.user_name,
      companyName: currentUserInfo.value.company_name,
      departmentName: currentUserInfo.value.department,
      phone: currentUserInfo.value.phone || '',
      workAddress: currentUserInfo.value.work_address || ''
    }
  }
  showUserInfoDialog.value = true
}

// 保存用户信息并关闭弹窗
const saveUserInfo = async () => {
  if (!formValid.value) {
    return
  }

  savingUserInfo.value = true
  try {
    const savedInfo = await userInfoManager.saveUserInfo({
      user_name: userInfoForm.value.name.trim(),
      company_name: userInfoForm.value.companyName.trim(),
      department: userInfoForm.value.departmentName.trim(),
      phone: userInfoForm.value.phone.trim() || null,
      work_address: userInfoForm.value.workAddress.trim() || null
    })
    currentUserInfo.value = savedInfo
    showUserInfoDialog.value = false
  } catch (error) {
    console.error('Failed to save user info:', error)
  } finally {
    savingUserInfo.value = false
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

// 是否已完成首次普查
const hasCompletedFirstScan = () => {
  return config.value?.full_inventory_time != null && config.value.full_inventory_time !== ''
}

// 点击首次普查按钮
const handleFirstScan = () => {
  router.push({ path: '/', query: { action: 'firstScan' } })
}

// 点击日常盘点按钮
const handleDailyScan = () => {
  router.push({ path: '/', query: { action: 'dailyScan' } })
}

onMounted(() => {
  loadConfig()
  checkUserInfo()
})

// 主导航菜单
const navItems = [
  // { title: '本机数据资源图谱', icon: 'mdi-chart-bar', to: '/stats', hint: '数据治理与归档统计图表', disabled: false },
  { title: '本机数据资源图谱', icon: 'mdi-file', to: '/' ,hint: "个人工作文件管理",disabled:false },
  { title: '管控文件扫描盘点', icon: 'mdi-file-search', to: '/scan', hint: '本机文件目录资源普查与盘点',disabled:false },
  { title: '扫描结果责任认领', icon: 'mdi-account-check', to: '/claim', hint: '本人私有与工作责任文件认领',disabled:false},
  { title: '认领文件归档保护', icon: 'mdi-folder-lock', to: '/classify', hint: '按文件级别实施分类分区存储',disabled:false},
  { title: '本机归档文件浏览', icon: 'mdi-folder-eye', to: '/classifySearch', hint: '工作文件的归档与查询',disabled:false},
  { title: '工作档案上报移交', icon: 'mdi-file-upload', to: '/report', hint: '自起草文件的上报移交',disabled:false},
  { title: '单位档案在线阅卷', icon: 'mdi-book-open-page-variant', to: '/borrow', hint: '核心重要文件借阅与安全管控',disabled:false},
  // { title: '个人文本隐私保护', icon: 'mdi-shield-account', to: '/privacy', hint: '个人隐私资源管理', disabled: false },
]

// 底部菜单
const bottomNavItems = [
  { title: '设置', icon: 'mdi-cog', to: '/settings' },
]
</script>

<template>
  <v-app>
    <v-navigation-drawer v-if="!isPdfViewer" v-model="drawer" permanent>
      <v-list-item
        title="数据可信终端"
        subtitle="电子文件帐目管理系统"
        prepend-icon="mdi-shield-lock"
      />

      <v-divider />

      <!-- 首次普查/日常盘点按钮 -->
<!--      <div class="pa-2">-->
<!--        <v-btn-->
<!--          v-if="!hasCompletedFirstScan()"-->
<!--          color="primary"-->
<!--          block-->
<!--          prepend-icon="mdi-clipboard-search"-->
<!--          @click="handleFirstScan"-->
<!--        >-->
<!--          首次普查-->
<!--        </v-btn>-->
<!--        <v-btn-->
<!--          v-else-->
<!--          color="primary"-->
<!--          variant="tonal"-->
<!--          block-->
<!--          prepend-icon="mdi-refresh"-->
<!--          @click="handleDailyScan"-->
<!--        >-->
<!--          日常盘点-->
<!--        </v-btn>-->
<!--      </div>-->

      <v-divider />

      <v-list density="compact" nav>
        <v-tooltip
          v-for="item in navItems"
          :key="item.title"
          :text="item.hint"
          location="end"
        >
          <template v-slot:activator="{ props }">
            <v-list-item
              v-bind="props"
              :disabled="item.disabled"
              :title="item.title"
              :prepend-icon="item.icon"
              :to="item.to"
            />
          </template>
        </v-tooltip>
      </v-list>

      <template v-slot:append>
        <v-divider />
        <v-list density="compact" nav>
          <v-list-item
            v-for="item in bottomNavItems"
            :key="item.title"
            :title="item.title"
            :prepend-icon="item.icon"
            :to="item.to"
          />
        </v-list>
      </template>
    </v-navigation-drawer>

    <!-- 右上角用户信息显示 -->
    <v-app-bar  v-if="!isPdfViewer" density="compact" flat color="transparent">
      <v-spacer />
      <v-chip
        v-if="currentUserInfo"
        variant="text"
        class="mr-2"
        @click="openUserInfoDialog"
        style="cursor: pointer;"
      >
        <v-icon start size="small">mdi-account</v-icon>
        <span class="text-body-2">
          {{ currentUserInfo.user_name }} | {{ currentUserInfo.company_name }} | {{ currentUserInfo.department }}
        </span>
        <v-icon end size="small">mdi-pencil</v-icon>
      </v-chip>
    </v-app-bar>

<!--    <v-app-bar>-->
<!--      <v-app-bar-nav-icon @click="drawer = !drawer" />-->
<!--      <v-toolbar-title>数据资产保护系统</v-toolbar-title>-->
<!--      <v-spacer />-->
<!--      <v-btn-->
<!--        :icon="theme.global.current.value.dark ? 'mdi-weather-sunny' : 'mdi-weather-night'"-->
<!--        @click="toggleTheme"-->
<!--      />-->
<!--    </v-app-bar>-->

    <v-main>
      <v-container fluid>
        <router-view />
      </v-container>
    </v-main>

    <!-- 用户信息填写弹窗 -->
    <v-dialog
      v-model="showUserInfoDialog"
      persistent
      max-width="500"
    >
      <v-card>
        <v-card-title class="text-h5">
          <v-icon class="mr-2">mdi-account-edit</v-icon>
          {{ currentUserInfo ? '修改机主信息' : '请填写机主信息' }}
        </v-card-title>
        <v-card-subtitle class="mt-1">
          {{ currentUserInfo ? '更新您的基本信息' : '首次使用，请填写您的基本信息' }}
        </v-card-subtitle>

        <v-card-text>
          <v-form v-model="formValid">
            <v-text-field
              v-model="userInfoForm.name"
              label="姓名 *"
              placeholder="请输入您的姓名"
              variant="outlined"
              :rules="[formRules.required]"
              class="mb-2"
            />
            <v-text-field
              v-model="userInfoForm.companyName"
              label="单位名称 *"
              placeholder="请输入单位名称"
              variant="outlined"
              :rules="[formRules.required]"
              class="mb-2"
            />
            <v-text-field
              v-model="userInfoForm.departmentName"
              label="部门名称 *"
              placeholder="请输入部门名称"
              variant="outlined"
              :rules="[formRules.required]"
              class="mb-2"
            />
            <v-text-field
              v-model="userInfoForm.phone"
              label="联系方式"
              placeholder="请输入联系方式（选填）"
              variant="outlined"
              class="mb-2"
            />
            <v-text-field
              v-model="userInfoForm.workAddress"
              label="工作地点"
              placeholder="请输入工作地点（选填）"
              variant="outlined"
            />
          </v-form>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn
            v-if="currentUserInfo"
            variant="text"
            @click="showUserInfoDialog = false"
            :disabled="savingUserInfo"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            variant="elevated"
            :disabled="!formValid"
            :loading="savingUserInfo"
            @click="saveUserInfo"
          >
            确认保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-app>
</template>

<style scoped>
</style>
