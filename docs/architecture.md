# 架构说明

LocalDM 是 Electron 桌面应用：主进程负责下载引擎与本地 API，渲染进程是 React UI，浏览器扩展通过本机 HTTP 与主进程通信。

## 进程与模块

```
┌─────────────────────┐     POST /capture      ┌──────────────────────┐
│  Chrome MV3 扩展     │ ─────────────────────► │  Electron Main       │
│  background/content │     localdm://         │  · HTTP API :37280   │
└─────────────────────┘                        │  · TaskStore         │
                                               │  · RangeEngine       │
┌─────────────────────┐        IPC             │  · MediaEngine       │
│  React Renderer     │ ◄────────────────────► │  · Aria2Engine       │
│  Toolbar/TaskList   │                        │  · Tray / Notify     │
└─────────────────────┘                        └──────────────────────┘
```

| 目录 | 职责 |
|---|---|
| `electron/` | 主进程：窗口、托盘、IPC、HTTP API、引擎 |
| `src/` | 渲染进程 UI（React + Vite） |
| `shared/` | 类型、常量、错误文案等共享代码 |
| `extension/` | MV3 扩展源码 |
| `scripts/smoke*.ts` | 回归测试 |
| `resources/bin/` | 可选外部工具（不入库） |

## 下载引擎

### RangeEngine（默认 HTTP 路径）

1. **探测**：对目标 URL 发起开放 Range 请求（`GET` + `Range: bytes=0-`），使用常见浏览器 UA 与 `Accept-Encoding: identity`，记录重定向后的最终 URL、`ETag`、`Content-Length`。
2. **分段**：按设置的连接数将文件切成区间，工作线程认领区间下载。
3. **续传**：任务元数据写入 `tasks/<id>.meta.json`；重启后校验 ETag/Length 再继续。
4. **限流自适应**：若出现 401/403/410/429/503/567 等状态：
   - 触发共享冷却
   - 有效连接数减半（下限 1）
   - 冷却后从原始 URL 重新探测
5. **并发调度**：全局任务并发 + 单服务器连接上限，避免打爆 CDN。

### MediaEngine（yt-dlp）

- 识别视频站点 URL（YouTube、Bilibili、抖音等）。
- 将**页面 URL** 交给 yt-dlp，按清晰度参数选择格式。
- HLS 可走本地 HLS 引擎分段下载，再用 ffmpeg 合并。
- 可配置 `cookieBrowser` 以使用本机浏览器 Cookie。

### Aria2Engine（BT / 磁力）

- 设置中开启后，`magnet:` / 种子类任务路由到 aria2c。
- 未开启时任务会以明确错误提示失败，不会静默丢弃。

## 任务模型

任务状态大致包括：

`probing → downloading ⇄ paused → merging → completed`  
以及 `queued` / `failed` / `cancelled`。

关键字段：`url`、`savePath`、`category`、`status`、`totalBytes`、`doneBytes`、`speedBps`、`segments`、`error`。

分类（视频/音乐/压缩包/模型/其他等）由 URL 与内容类型推断，侧边栏可筛选。

持久化：

- `tasks-state.json` — 列表快照
- `tasks/*.meta.json` — Range sidecar
- `logs/tasks/<id>.log` — 单任务日志（若启用）

## 本地 HTTP API

| 项 | 默认值 |
|---|---|
| 监听 | `127.0.0.1:37280` |
| 鉴权 | `UserData/LocalDM/api-token` |
| CORS | 允许浏览器扩展来源 |

常用端点（示意）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查、工具可用性、托管开关 |
| POST | `/capture` | 扩展送入下载 |
| GET/POST | `/tasks*` | 任务查询与控制 |
| GET/POST | `/settings*` | 设置读写 |

协议回退：扩展在 HTTP 不可用时可尝试 `localdm://capture?data=<base64>`。

> 安全提示：token 不要提交到仓库；API 不要绑定到公网地址。

## 渲染进程 UI

- **工具栏**：添加、单任务控制、批量控制、清理、关于/设置；按钮按状态禁用。
- **侧边栏**：状态桶（全部/进行中/已完成）+ 分类计数。
- **任务列表**：进度条、状态徽章、右键菜单（详情 / 资源管理器 / 打开文件）。
- **设置**：常规（目录/并发/限速）、进阶（连接/引擎/扩展）、系统（主题/托管/日志）。
- **主题**：`src/styles/tokens.css` 定义 light/dark token；默认跟随系统。

UI 与主进程仅通过 preload 暴露的 IPC 桥通信（`window.localdm`），不直接 `require` Node。

## 浏览器扩展

详见 [extension.md](extension.md)。要点：

- 权限：`webRequest`、`downloads`、`contextMenus`、`storage`、`tabs`、`notifications` 等
- 仅向 `127.0.0.1` / `localhost` 发送业务请求
- 平台视频页优先整页 URL → yt-dlp，避免把 MSE 分片当成成品文件

## 构建与打包

- UI：Vite → `dist/`
- 主进程：`tsc -p tsconfig.electron.json` → `dist-electron/`
- 打包：electron-builder（NSIS + portable），`build/` 内图标，`extraResources` 附带 bin 与 extension

详见 [packaging.md](packaging.md)。

## 测试

```powershell
npm run typecheck
npm run smoke
```

`smoke` 覆盖本地 HTTP API、Range 下载/续传、队列与批量 API、任务并发限制、媒体路由、BT 路由、接管开关、自适应策略等。外网 HLS 用例失败时可能输出 WARN，退出码 0 仍视为通过。

CI 在 GitHub Actions Windows 环境执行相同检查。
