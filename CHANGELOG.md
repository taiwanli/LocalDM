# Changelog

本项目的所有重要变更都会记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- 工具栏独立按钮：全部暂停 / 全部恢复 / 清空失败（按任务状态自动禁用）

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
