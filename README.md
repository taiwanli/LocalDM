# LocalDM

[![CI](https://github.com/taiwanli/LocalDM/actions/workflows/ci.yml/badge.svg)](https://github.com/taiwanli/LocalDM/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**LocalDM** 是一款面向 Windows 的开源多线程下载管理器。  
基于 Electron + React + TypeScript，自研 Range 分段引擎，可配合可选的 yt-dlp / ffmpeg / aria2c，覆盖直链多线程下载、视频站点下载与 BT/磁力任务。

> 个人本机使用场景优先设计：打开 → 粘贴链接 → 开始下载。无付费墙、无账号体系。

## 功能特性

- **多线程 Range 下载**：开放 Range 探测、ETag/Length 续传校验、按服务器限制连接数
- **限流自适应**：遇到 401/403/410/429/503/567 等响应时自动降并发并冷却重试
- **队列与并发**：任务队列、暂停/继续、批量暂停/恢复、清空已完成/失败
- **视频与流媒体**：可选 yt-dlp 解析站点页面；HLS（m3u8）本地合并
- **BT / 磁力**：可选 aria2c 引擎（设置中开启）
- **浏览器扩展（MV3）**：右键送入桌面端、资源嗅探、下载接管提示
- **本地 HTTP API**：默认 `127.0.0.1:37280`，供扩展与本机工具调用
- **液态玻璃 UI**：明暗主题跟随系统，任务三栏 + 分类筛选

## 系统要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10 / 11 x64 |
| Node.js（仅开发） | ≥ 20 |
| npm（仅开发） | ≥ 10 |
| 可选二进制 | yt-dlp、ffmpeg、aria2c（视频/HLS/BT 需要） |

## 安装

### 方式一：安装包 / 便携版

从 [Releases](https://github.com/taiwanli/LocalDM/releases) 下载：

- `LocalDM Setup x.y.z.exe` — NSIS 安装版
- `LocalDM-x.y.z-portable.exe` — 便携版

SmartScreen 提示时选择「更多信息 → 仍要运行」。

安装包会在 `resources/bin` 附带可用的 `yt-dlp.exe` / `ffmpeg.exe` / `aria2c.exe`（若构建时源目录存在）。

### 方式二：源码运行

```powershell
git clone https://github.com/taiwanli/LocalDM.git
cd LocalDM
npm install
npm run build
npm start
```

网络受限时可为 npm / Electron 配置代理或镜像后再安装依赖。

## 快速上手

1. 启动 LocalDM，首次运行会显示简短引导。
2. 点击 **添加**，粘贴直链或视频页 URL。
3. 需要批量操作时使用工具栏：**全部暂停 / 全部恢复 / 清空失败**。
4. 完成的任务可右键 →「在资源管理器中显示」。

### 浏览器扩展（可选）

1. 桌面端 **关于** 页可查看扩展目录（安装后通常为 `resources/extension`）。
2. Chrome / Edge：打开扩展页 → 开发者模式 → **加载已解压的扩展程序** → 选择该目录。
3. 扩展弹窗确认「桌面端已连接」。
4. 视频站点建议在页面上右键「下载此视频」，将整页 URL 交给桌面端解析。

### 下载策略说明

当前版本固定为 **Range 多线程 + 限流自适应**（无多模式切换 UI）：

- 设置中可调整连接数、任务并发
- 默认开启「限流时自动降并发」
- 详情页可查看「有效连接 n」

## 开发

```powershell
# 终端 1：Vite UI
npm run dev:ui

# 终端 2：Electron（需先编译主进程）
npm run watch:electron
npm run dev:electron
```

常用命令：

| 命令 | 说明 |
|---|---|
| `npm run typecheck` | TypeScript 检查 |
| `npm run smoke` | 类型检查 + 全量 smoke |
| `npm run build` | 构建 UI 与 Electron 主进程 |
| `npm start` | 构建并启动 |
| `npm run pack:win` | 打包 Windows 安装版 + 便携版 → `release/` |

### 目录结构

```
electron/     主进程（窗口、本地 API、下载引擎）
src/          React 渲染进程 UI
shared/       主进程 / 渲染进程共享类型
extension/    Chrome MV3 浏览器扩展
docs/         使用与架构文档
scripts/      smoke 测试与构建辅助
resources/bin 可选外部工具（不入库）
```

### 运行时数据位置

设置与任务状态保存在 Electron `userData` 下的 `LocalDM/`：

- `settings.json` — 设置
- `tasks-state.json` — 任务列表
- `tasks/*.meta.json` — 续传元数据
- `api-token` — 本地 API token（请勿提交或分享）

## 架构概览

```
Browser MV3 extension
    → POST http://127.0.0.1:37280/capture
    → localdm://capture?data=...
Electron main
    → Local HTTP API (token)
    → TaskStore / RangeEngine / MediaEngine / Aria2Engine
React renderer (IPC)
```

更完整的说明见 [docs/architecture.md](docs/architecture.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [快速开始](docs/getting-started.md) | 安装、扩展、常见问题 |
| [架构说明](docs/architecture.md) | 进程模型、引擎、API |
| [浏览器扩展](docs/extension.md) | 扩展能力与调试 |
| [打包发布](docs/packaging.md) | Windows 打包步骤 |
| [贡献指南](CONTRIBUTING.md) | 开发环境与 PR 规范 |
| [更新日志](CHANGELOG.md) | 版本变更 |

## 可选外部工具

视频 / HLS / BT 能力依赖你自行放置的可执行文件（已 gitignore，避免版权与体积问题）：

- `resources/bin/yt-dlp.exe`
- `resources/bin/ffmpeg.exe`
- `resources/bin/aria2c.exe`

也可在设置中指定自定义路径。

## 安全与合规

- 本地 API 默认仅监听 `127.0.0.1`，并使用 token 校验。
- 请仅下载你有权获取的内容。
- 漏洞请按 [SECURITY.md](SECURITY.md) 私下报告，不要开公开 Issue。

## 持续集成

GitHub Actions 在 push / PR 时于 Windows 运行 `npm ci` → `typecheck` → `smoke`。状态见 README 顶部 CI badge。


## 贡献

欢迎 Issue 与 Pull Request。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [行为准则](CODE_OF_CONDUCT.md)。

## 许可

本项目采用 [MIT License](LICENSE)。

## 鸣谢

- [Electron](https://www.electronjs.org/) / [React](https://react.dev/) / [Vite](https://vite.dev/)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)、[ffmpeg](https://ffmpeg.org/)、[aria2](https://aria2.github.io/)（可选外部工具，各自许可见上游）
