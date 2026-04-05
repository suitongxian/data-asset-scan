<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api, type UserInfo } from '@/services/api'
import { userInfoManager } from '@/services/UserInfoManager'

const router = useRouter()

// 状态
const loading = ref(false)
const saving = ref(false)
const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref('success')

// 表单数据
const workspace = ref('')

// 用户信息相关
const userInfo = ref<UserInfo | null>(null)
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

// 加载配置
const loadConfig = async () => {
  loading.value = true
  try {
    const config = await api.getConfig()
    workspace.value = config.workspace || ''
    // 同时加载用户信息
    userInfo.value = await userInfoManager.getUserInfo()
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
    })
    showSnackbar('配置已保存', 'success')
  } catch (error) {
    showSnackbar('保存配置失败', 'error')
    console.error('Failed to save config:', error)
  } finally {
    saving.value = false
  }
}

// 打开用户信息编辑弹窗
const openUserInfoDialog = () => {
  if (userInfo.value) {
    userInfoForm.value = {
      name: userInfo.value.user_name,
      companyName: userInfo.value.company_name,
      departmentName: userInfo.value.department,
      phone: userInfo.value.phone || '',
      workAddress: userInfo.value.work_address || ''
    }
  } else {
    userInfoForm.value = {
      name: '',
      companyName: '',
      departmentName: '',
      phone: '',
      workAddress: ''
    }
  }
  showUserInfoDialog.value = true
}

// 保存用户信息
const saveUserInfoHandler = async () => {
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
    userInfo.value = savedInfo
    showUserInfoDialog.value = false
    showSnackbar('机主信息已保存', 'success')
  } catch (error) {
    showSnackbar('保存机主信息失败', 'error')
    console.error('Failed to save user info:', error)
  } finally {
    savingUserInfo.value = false
  }
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
          </v-row>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-btn
          variant="text"
          size="small"
          @click="router.push('/admin')"
          class="text-caption"
        >
          其它设置
        </v-btn>
        <v-btn
          variant="outlined"
          size="small"
          prepend-icon="mdi-account-edit"
          @click="openUserInfoDialog"
          :disabled="loading"
        >
          机主信息
        </v-btn>
        <v-spacer />
        <v-btn
          variant="outlined"
          @click="loadConfig"
          :disabled="loading || saving"
        >
          重置
        </v-btn>
        <v-btn
          color="primary"
          @click="saveConfig"
          :loading="saving"
          :disabled="loading"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- 机主信息编辑弹窗 -->
    <v-dialog
      v-model="showUserInfoDialog"
      max-width="500"
    >
      <v-card>
        <v-card-title class="text-h5">
          <v-icon class="mr-2">mdi-account-edit</v-icon>
          {{ userInfo ? '修改机主信息' : '填写机主信息' }}
        </v-card-title>
        <v-card-subtitle class="mt-1">
          {{ userInfo ? '更新您的基本信息' : '请填写您的基本信息' }}
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
            @click="saveUserInfoHandler"
          >
            确认保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 提示消息 -->
    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>
