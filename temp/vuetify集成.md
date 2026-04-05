完成内容

1. 集成 Vuetify

- 安装 vuetify 和 @mdi/font 图标库
- 创建 src/plugins/vuetify.ts 配置文件，包含亮/暗主题
- 自动导入所有 Vuetify 组件

2. 集成 Vue Router

- 安装 vue-router
- 创建 src/plugins/router.ts 配置文件
- 使用 Hash 模式路由（适合 Electron）
- 创建了两个视图页面：
    - src/views/HomeView.vue - 首页
    - src/views/ScanView.vue - 扫描页面

3. Web 开发模式

已添加 web 命令到 package.json：

yarn run web   # 或 npm run web

此命令会启动纯 Web 开发服务器（不启动 Electron），访问 http://localhost:5173 即可调试。

4. 新的布局

- 左侧导航栏带侧边菜单
- 顶部工具栏带主题切换按钮
- 支持亮色/暗色主题切换

项目结构

src/
├── plugins/
│   ├── vuetify.ts    # Vuetify 配置
│   └── router.ts     # 路由配置
├── views/
│   ├── HomeView.vue  # 首页
│   └── ScanView.vue  # 扫描页
├── components/
│   └── FileScanner.vue  # 原有扫描组件
├── App.vue           # 主布局（Vuetify 布局）
└── main.ts           # 入口（集成 Vuetify + Router）

使用方式

# Web 开发模式（推荐日常开发）
yarn run web

# Electron 开发模式
yarn run dev

✻ Worked for 12m 9s

⏺ Background command "验证 web 模式启动并访问" failed with exit code 137.

⏺ 这个是正常的 - 我主动终止了后台验证任务。从之前的输出可以确认 yarn run web 已经成功运行：

VITE v5.4.21  ready in 333 ms

➜  Local:   http://localhost:5173/

你现在可以使用以下命令开始 Web 开发：

yarn run web

然后在浏览器访问 http://localhost:5173 即可看到集成了 Vuetify 的新界面。
