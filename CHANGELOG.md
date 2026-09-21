# Changelog

本项目的所有重要变更都会记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.1] - 2026-09-21

### Added
- 下载模式四档：自适应 / 默认 / 均衡 / 极速（自适应为默认推荐）
- 工具栏：全部暂停 / 全部恢复 / 清空失败
- 磁力：共用 aria2 RPC 单实例；BT 专用 peer 参数；附加 Tracker；元数据超时；t-save-metadata 元数据缓存
- 设置：Cookie 浏览器支持星愿浏览器 (Twinkstar)；Cookie 文件路径；磁力 Tracker / 超时 / 端口说明

### Fixed
- HLS/媒体合并完成前错误显示 100%（进度封顶 99.9%）
- HLS 非法文件名导致 ENOENT
- 磁力暂停后恢复重复 addUri；任务并发与下载模式预设不一致
- Electron 44 API：登录项 openAsHidden、剪贴板 
eadText 异步

### Security
- 依赖安全升级见 [1.0.0] 后 Electron 44 / electron-builder 26.15.3 提交

## [Unreleased]

### Added
- 工具栏独立按钮：全部暂停 / 全部恢复 / 清空失败（按任务状态自动禁用）
- 恢复下载模式 UI：默认 / 均衡 / 极速，并新增第四种 **自适应**（按设置连接数 + 限流自动降并发，默认推荐）
- 磁力策略升级：共用 aria2 **RPC 单实例**；BT 专用 `bt-max-peers` 等（不再误用 HTTP split）；可编辑附加 Tracker；磁力元数据超时（默认 180s）；`bt-save-metadata` 缓存；设置中说明防火墙端口 51413–52413（aria2 无自动 UPnP）

### Fixed
- HLS/媒体任务在合并完成前错误显示 100%：分段阶段按均值估算总量，未 `completed` 时进度封顶 99.9%
- HLS 中文文件名非法字符导致 `ENOENT`：写盘前 `sanitizeFilename`
- 磁力“无动静”排查：日志显示 aria2 已在跑但 `METADATA 0B/0B CN:0 SD:0`（无节点）；修复 DHT 路径损坏/端口冲突/缺 tracker；列表提示资源可能无做种
- 磁力暂停后继续：RPC 保留 gid，恢复时 `unpause` 而非重复 `addUri`；任务并发上限与下载模式预设一致

### Security
- Electron `35.7.5` → `44.4.3`（消除沙箱 / context isolation / 自定义协议等一批高危公告）
- electron-builder `26.15.3`；`app-builder-lib` / `builder-util-runtime` / `tar` 锁定到已修复版本
- `package.json` 增加 `overrides`，强制传递依赖安全下限
- Electron 44 API 适配：`setLoginItemSettings` 去掉已移除的 `openAsHidden`；剪贴板接管兼容 `readText` 异步返回

## [1.0.0] - 2026-09-20

### Added
- Windows 多线程下载管理器首个公开功能集
- Range 分段下载引擎：开放 Range 探测、ETag/Length 续传、按服务器连接限制
- 限流自适应：401/403/410/429/503/567 等状态自动降并发并重探测
- 任务队列：并发限制、暂停/继续、批量操作、分类筛选
- 视频站点下载：yt-dlp 页面解析 + 可选清晰度
- HLS（m3u8）本地下载与 ffmpeg 合并
- BT / 磁力下载（aria2c，可选开关）
- Chrome MV3 扩展：右键送入、资源嗅探、下载接管提示、桌面连通状态
- 本地 HTTP API（默认端口 37280，token 鉴权）
- 首次运行引导、简化添加 URL、友好错误提示
- 设置页（常规 / 进阶 / 系统）与关于页
- 任务列表右键：详情、资源管理器定位
- Windows NSIS 安装版与便携版打包
- typecheck + smoke 测试套件与 GitHub Actions CI

### Notes
- 默认下载策略为 Range + 自适应限速，不提供多模式 UI
- 扩展需手动「加载已解压的扩展程序」，不自动安装
- 外部工具（yt-dlp / ffmpeg / aria2c）不随源码仓库分发，请自行放置或使用 Release 包

[Unreleased]: https://github.com/taiwanli/LocalDM/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/taiwanli/LocalDM/releases/tag/v1.0.0
