-- 系统配置表 system_config
CREATE TABLE system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,      -- 主键 自增id
    key TEXT UNIQUE NOT NULL,                  -- 配置键（唯一）
    type TEXT NOT NULL,                        -- 值类型
    value TEXT,                                -- 值文本
    describe TEXT,                             -- 值说明
    create_time DATETIME NOT NULL,             -- 记录创建时间
    update_time DATETIME NOT NULL,             -- 记录更新时间
    disable INTEGER NOT NULL DEFAULT 0         -- 是否注销 0未注销 1已注销
);


-- 扫描任务表 scan_task
CREATE TABLE scan_task (
    id INTEGER PRIMARY KEY AUTOINCREMENT,      -- 主键 自增id
    scan_type TEXT NOT NULL,                   -- 扫描类型 FILE、DATABASE
    file_scan_range TEXT,                       -- 文件扫描区域范围
    heartbeat INTEGER NOT NULL,                -- 任务心跳 每次更新进度 +1
    workspace_path TEXT,                       -- 工作空间目录
    task_state INTEGER NOT NULL,               -- 任务状态 run进行中、succeed成功、fail失败
    task_phase TEXT,                           -- 任务当前阶段
    task_error_message TEXT ,                  -- 任务失败信息
    scan_args TEXT ,                           -- 扫描参数
    file_total INTEGER,                         -- 扫描总数
    file_scanned_count INTEGER,                 -- 已扫描总数
    file_all_suffix_text TEXT,                   -- 本次扫描用的所有文件后缀
    file_all_suffix_count INTEGER,               -- 本次扫描的所有后缀数量
    file_count_suffix_count INTEGER,             -- 工作空间中所有后缀数量
    workspace_count INTEGER,                   -- 工作空间文件数量
    end_time DATETIME,                         -- 扫描结束时间
    scan_log TEXT,                             -- 扫描文本日志
    create_time DATETIME NOT NULL,             -- 记录创建时间（扫描开始时间）
    update_time DATETIME NOT NULL,             -- 更新时间
    disable INTEGER NOT NULL DEFAULT 0         -- 是否注销 0未注销 1已注销
);


-- 数据分布表 data_distributing
CREATE TABLE data_distributing (
    data_distribution_id INTEGER PRIMARY KEY AUTOINCREMENT,  -- 自增id主键
    scan_task_id INTEGER,                                    -- 扫描发现任务id
    path TEXT NOT NULL,                                      -- 路径标识
    data_type INTEGER NOT NULL,                              -- 数据类型 1文件 2数据库
    scan_found_count INTEGER NOT NULL,                       -- 扫描盘点总次数，用于标识存续状态  0 删除 1新增  >2 正常
    content_sign TEXT NOT NULL,                              -- 资源签名（md5）
    file_suffix TEXT,                                          -- 文件后缀
    file_magic TEXT,                                          -- 文件魔数
    file_create_time DATETIME,                                -- 文件创建时间
    file_update_time DATETIME,                                -- 文件修改时间
    file_read_time DATETIME,                                  -- 文件最后读取时间
    file_size INTEGER NOT NULL,                               -- 文件大小
    file_hide INTEGER DEFAULT 0,                              -- 是否隐藏 1是 0否
    upload_state  INTEGER DEFAULT 0,                         -- 0.未上传 1.已上传 2.副本上传 3.上传失败 4.无需上传
    ip TEXT NOT NULL,                                        -- 所在电脑ip
    mac_address TEXT NOT NULL,                               -- 所在电脑mac地址
    parent_id INTEGER,                                       -- 数据从属关系
    scan_time DATETIME NOT NULL,                             -- 扫描发现时间
    create_time DATETIME NOT NULL,                           -- 记录创建时间
    update_time DATETIME NOT NULL,                           -- 记录更新时间
    disable INTEGER NOT NULL DEFAULT 0                       -- 是否注销 0未注销 1已注销
);

-- 信息资源表 data_resources
CREATE TABLE data_resources (
    data_resources_id INTEGER PRIMARY KEY AUTOINCREMENT, -- 资源自增id
    content_sign TEXT NOT NULL,                          -- 资源签名（md5）
    source_count INTEGER NOT NULL,                       -- 数据分布总数量
    workspace_source_count INTEGER NOT NULL,             -- 工作空间来源数量 即来源于 workspace 的数量
    first_create_time DATETIME NOT NULL,                  -- 数据最早创建时间
    resources_name TEXT,                                 -- 资源名称
    resources_desc TEXT,                                 -- 资源摘要
    content_subject TEXT,                                -- 资源类目 file 电子文件、file_table 电子表格、database数据库、image图型图象、video流媒体
    content_type TEXT,                                   -- 内容类别 pdf、docx、ppt、mySql、db2等
    is_claimed INTEGER DEFAULT 0,                        -- 是否认领 0 未认领 1已认领
    claim_status INTEGER DEFAULT 0,                      -- 认领分类 0.未分类 1.个人隐私数据、2.个人工作数据 3.非责任类数据
    importance_level  INTEGER DEFAULT 0,                 -- 重要程度：0.未分类 1.核心 2.重要 3.开放 4.隐私 5.无需归档
    claim_time DATETIME,                                 -- 认领时间
    claimant_name TEXT,                                  -- 认领人姓名
    claimant_unit TEXT,                                  -- 认领人单位
    data_level TEXT,                                     -- 数据级别
    data_share TEXT,                                     -- 共享类型 0.无条件共享 1.有条件共享 2.不予共享
    file_magic TEXT,                                      -- 文件魔数
    create_time DATETIME NOT NULL,                       -- 记录创建时间
    update_time DATETIME NOT NULL,                       -- 记录更新时间
    disable INTEGER NOT NULL DEFAULT 0                   -- 是否注销 0未注销 1已注销
);

-- 文件数量统计表 file_statistics
CREATE TABLE file_statistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,                     -- 自增id主键
    scan_task_id INTEGER NOT NULL,                            -- 扫描任务id，引用scan_task表中的id
    file_total INTEGER NOT NULL DEFAULT 0,                     -- 文件总数：当前所有文件数
    workspace_file_total INTEGER NOT NULL DEFAULT 0,           -- 工作空间文件总数
    history_file_count INTEGER NOT NULL DEFAULT 0,             -- 历史文件数：文件创建时间在历史普查时间之前的文件数
    non_history_file_count INTEGER NOT NULL DEFAULT 0,         -- 非历史文件数：文件总数减历史文件数
    workspace_file_claimed_count INTEGER NOT NULL DEFAULT 0,   -- 工作空间文件认领数
    history_file_claimed_count INTEGER NOT NULL DEFAULT 0,     -- 历史文件认领数
    non_history_file_claimed_count INTEGER NOT NULL DEFAULT 0, -- 非历史文件认领数
    create_time DATETIME NOT NULL,                            -- 记录创建时间
    update_time DATETIME NOT NULL,                            -- 记录更新时间
    disable INTEGER NOT NULL DEFAULT 0                        -- 是否注销 0未注销 1已注销
);

-- 创建用户信息表
CREATE TABLE user_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- 自增主键，唯一标识每条记录
    company_name TEXT NOT NULL,            -- 单位名称，不能为空
    user_name TEXT NOT NULL,               -- 用户姓名，不能为空
    department TEXT NOT NULL,              -- 所属部门，不能为空
    ip TEXT NOT NULL,                      -- 所用电脑ip
    mac_address TEXT NOT NULL,             -- 所用电脑mac地址
    work_address TEXT ,                    -- 工作地点
    phone TEXT ,                           -- 联系方式
    password_md5 TEXT ,                    -- MD5加密后的密码(保留字段)
    id_card TEXT UNIQUE,                   -- 身份证号(保留字段)
    create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- 记录创建时间，默认使用当前时间戳
    update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,-- 最后更新时间，默认使用当前时间戳
    disable INTEGER NOT NULL DEFAULT 0  -- 注销状态：0-未注销（正常），1-已注销
);

