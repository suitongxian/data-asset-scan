# 实现一个本地文件扫描服务
- 扫描指定目录下指定后缀的所有文件

要求：
- 支持以HTTP的方式对外提供
- vue界面端基于该http请求触发扫描

请问答以下问题
当前基于 electron-vite 的架构是否支持？以及如何支持


采用方案二：内嵌 HTTP 服务  架构：Main 进程启动 HTTP Server，Vue 通过 HTTP 请求触发，具体要求如下：

- 编写独立的扫描服务类 传递扫描路径以及扫描后缀，扫描返回所有路径以及总数，必须与HTTP模块解耦合，需编写独立测试用例测试该服务
- 扫描后缀支持逗号分割多个
- 编写http接口对外提供扫描服务，返回结果以json格式返回
- 编写vue界面 埴写扫描参数 路径、后缀列表 点击开始扫描
- 支持  `electron . `带界面与   `electron . --service` 纯服务模式运行，如果纯服务仅提供http接口

开发要求：

- 必须编写测试用例

# 性能重构优化以支持全盘扫描

将 @electron/services/FileScannerService.ts 重构成 fdir
要求：
- 必须通过单元测试



# 项目初始化逻辑
- 项目添加一个config.yaml配置，在启动时加载，包含内容 
    ```yml
    #默认管控列表
    control_type: .doc,.ppt,.docx
    ```
- 初始化数据库使用sqlLite，如果没有数据库文件就要创建一个
- 建表语句database.sql
- 初始系统配置表system_config ，将config.yaml中的 control_type 插入






基于fdir实现扫描原子服务

- 支持指定目路或全盘扫描，过滤条件：包含指定后缀，排除指定目录

- 将扫描的后的文件路径、md5、大小等属性写入sqllite数据库 的data_distributing表中，

- 扫描产先 在scan_task 中建立一个任务，每次批量提交后都要更新进度。scan_task表中关于工作空间的数据先不处理



关于容错：

- 遇到无权限打开的目录直接跳过
- 中断后不考虑恢复

性能优化

- SQLite 采用事务批量写入
- 超过5M文件的md5值 前后取 4096个字节 来计算
- 采用fdir流式处理 不能内存溢出
- 基于P-Queue队列的并发控制 限制同时进行md5文件的数量

实现要求

- 每个任务都要有测试用例来验证，只有用例通过在进入一个阶段的开发
- 尽量自主完成不要打扰我

参考文件

- @electron/database.sql
- @electron/services/FileScannerService.ts

### 架构 设计

采用 **流式 + 生产者消费者模型**

```
扫描器(fdir)  --->  任务队列  --->  文件处理池(md5计算)  --->  批量写入SQLite
       |                |                 |                   |
    统计总数          控制并发数         控制并发数         批量提交
```

核心思想：

- 不一次性收集全部文件
- 不一次性计算全部 MD5
- 不一次性写入数据库
- 每个阶段都有限流控制


字段重构
@electron/database.sql 中的file_count_suffix_count 重构成file_work_suffix_count 相关的其它一起重构
包括测试用例，然后执行测试用例进行验证

前端重构与集成：
- 集成Vuetify，样式以及主题以Vuetify为主
- 集成vue router
- 我希望开发过程中WEB页面为主不打开electron界面，能否在package.json中加个scripts命令 如`web` 当我执行`yarn run web`时就只在web页中开发调式

配置体系重构：
- 对应的配置优先从数据库system_config表中查找，如果没有就去config.yaml中找
- 把config.yaml中配置初始化时同步到数据的代码全部删除，包括相关的测试用例


[data_distributing 表增加 scan_task_id 字段 对应 scan_task表 的id
AtomicScanService.ts 在扫描任务会插入data_distributing记录，请在该操作中把scan_task_id补上

相关文件:
- AtomicScanService.ts 扫描服务
- database.sql 数据库文件 ]()



认领操作： 
当认领为"个人隐私数据"时 直接 把"重要程度"设置为"隐私"即当data_resources 表中认领为 claim_status=1时 直接设置 importance_level=4
相关文件：
- DataResourcesRepository.ts   batchClaim 认领方法
- database.sql 数据库文件 


@src/views/ClassifySearchView.vue 增加一个tab页  "隐私保（个人数据）" 过滤对应值是 importanceLevelFilter=4