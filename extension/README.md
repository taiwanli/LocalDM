# LocalDM 浏览器扩展（MV3）

自用加载，不上架。与桌面端通过本机 HTTP 通信。

## 加载步骤

1. 启动桌面端 `LocalDM`（默认 API `127.0.0.1:37280`）
2. Edge：`edge://extensions` → 开发人员模式 → **加载解压的扩展程序** → 选择本目录 `extension/`
3. Chrome：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序
4. 打开任意网页，点击扩展图标查看「桌面端已连接」

## 能力

| 能力 | 行为 |
|---|---|
| 右键「下载此链接」 | `POST /capture`，kind=direct |
| 右键「下载此视频」 | 视频平台页整页 URL → kind=video-platform（桌面 yt-dlp 在 M4） |
| 右键「嗅探本页全部资源」 | 将本页已嗅探列表批量 capture |
| 视频悬浮按钮 | 非平台页 `<video>` 右上角「下载该视频」 |
| 网络嗅探 | `webRequest` 收集 mp4/m3u8 等（过滤分片噪音；平台页不刷屏） |
| popup | 连通性、端口、嗅探开关、接管下载开关、本页资源列表 |

## 通信

- 主通道：`POST http://127.0.0.1:<port>/capture`
- 冷启动：`localdm://capture?data=<base64 JSON>`
- 端口在 popup 中配置，写入 `chrome.storage.local.apiPort`（需与设置页一致）

## 合规

图标与代码均为 LocalDM 自用原创，不使用第三方下载器资源。
