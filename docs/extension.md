# 浏览器扩展

LocalDM 扩展为 **Manifest V3**，源码在仓库 `extension/` 目录。  
它不依赖商店上架，通过「加载已解压的扩展程序」在本机使用。

## 安装

1. 启动 LocalDM 桌面端。
2. 扩展目录：
   - 安装版：关于页显示的 `resources/extension`
   - 源码：`<repo>/extension`
3. Chrome `chrome://extensions` 或 Edge `edge://extensions` → 开发者模式 → 加载已解压目录。
4. 打开扩展弹窗，确认 **桌面端已连接**。

## 功能一览

| 功能 | 行为 |
|---|---|
| 右键「下载此链接」 | `POST /capture`，按直链处理 |
| 右键「下载此视频」 | 视频站点页发送页面 URL，由桌面端 yt-dlp 解析 |
| 右键「嗅探本页全部资源」 | 批量送入本页已嗅探列表 |
| 视频悬浮按钮 | 非平台页 `<video>` 提供下载入口 |
| 网络嗅探 | `webRequest` 收集媒体请求，过滤分片噪音 |
| 下载接管 | 可选：拦截浏览器下载并转到 LocalDM，附系统通知 |
| popup | 连通性、API 端口、嗅探/接管开关、本页资源列表 |

## 通信

### 主通道

```http
POST http://127.0.0.1:<port>/capture
Content-Type: application/json
```

`<port>` 默认 `37280`，需与桌面设置一致；扩展可在 popup 中修改并写入 `chrome.storage.local.apiPort`。

### 协议回退

HTTP 不可用时：

```text
localdm://capture?data=<base64 JSON>
```

桌面端注册协议处理器后可拉起应用并入队。

### 健康检查

扩展会定期请求 `/health`，用于：

- 判断桌面端是否在线
- 读取 `systemTakeoverEnabled` 等开关

## 权限说明

| 权限 | 用途 |
|---|---|
| `webRequest` | 嗅探媒体请求 |
| `downloads` | 接管浏览器下载 |
| `contextMenus` | 右键菜单 |
| `storage` | 端口与开关 |
| `tabs` / `activeTab` | 读取当前页 URL |
| `notifications` | 接管成功/失败提示 |
| `host_permissions` | 全站嗅探 + 本机 API |

业务请求仅发往 `http://127.0.0.1/*` 与 `http://localhost/*`。

## 调试

1. 扩展页 → **服务工作进程**（背景脚本）可查看日志。
2. 网页 → DevTools → Console，过滤 content script 输出。
3. 桌面端日志：`userData/LocalDM/logs/app.log`。
4. 修改 `extension/` 后，在扩展页点击 **重新加载**。

## 常见问题

**一直显示未连接**  
桌面未启动、端口不一致、或扩展未重新加载。先改端口再刷新扩展。

**视频列表里是很多小文件**  
可能是 MSE 分片。请改用页面上的「下载此视频」，不要逐个捕获分片。

**接管下载后桌面没反应**  
确认桌面端运行、扩展已重新加载，且设置中允许浏览器捕获/接管。

## 图标

`extension/icons/` 提供 16/32/48/128 PNG，由 `manifest.json` 的 `icons` 与 `action.default_icon` 引用。

## 合规

扩展代码与图标属于 LocalDM 开源项目，以仓库根目录 [MIT License](../LICENSE) 为准。请勿将本扩展与任何第三方下载器品牌混淆。
