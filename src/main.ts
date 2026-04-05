import { createApp } from 'vue'
import App from './App.vue'
import vuetify from './plugins/vuetify'
import router from './plugins/router'

const app = createApp(App)

app.use(vuetify)
app.use(router)

app.mount('#app')

// 仅在 Electron 环境下监听 IPC 消息
if (window.ipcRenderer) {
  window.ipcRenderer.on('main-process-message', (_event, message) => {
    console.log(message)
  })
}
