# AGENTS.md — LocalDM

面向参与本仓库开发的智能体 / 贡献者约定。

## 项目是什么

Windows 桌面多线程下载器（Electron + React + TypeScript + Vite）。  
功能：Range 多线程下载、限流自适应、任务队列、可选 yt-dlp/HLS/BT、Chrome MV3 扩展、本地 HTTP API。

对外文档以 `README.md` 与 `docs/` 下公开文档为准。

## 开发规范（必须遵守）

1. **安全合规（最高）**：禁止恶意代码；禁止硬编码 token/密钥（一律 UserData 或环境变量）；外部输入必须校验；遵守开源许可。
2. **代码正确性**：TypeScript 零错误（`npm run typecheck` 必过）；命名语义化；不要吞掉异常。
3. **可维护性**：单一职责；重复逻辑抽公共模块；魔法值常量化；注释只写非显而易见的「为什么」。
4. **性能与可靠性**：资源句柄闭环释放；覆盖空值、边界与并发。
5. **交付适配**：不过度设计；新依赖须说明；修改后给出验证命令。

## 项目硬性约束

1. **原创实现**：不得引入其他下载器产品的商标、图标、商店扩展包或安装包资源。
2. **无付费墙**：不实现激活码 / LicenseManager 类逻辑。
3. **UI Token**：颜色/圆角/间距优先引用 `src/styles/tokens.css`，避免组件内硬编码色值。
4. **主题**：默认 `follow` 系统；light/dark 成对维护。
5. **主操作纪律**：每屏 Primary 按钮通常 ≤ 1（「添加」）。
6. **引擎正确性优先于皮肤**：跨进程续传必须校验 ETag/Length。
7. **API Token**：仅存 `UserData/api-token`，不得提交仓库、不得写入源码。
8. **参考信息**：调研笔记、竞品逆向等内部材料不得进入公开仓库。

## 目录

```
electron/     主进程（窗口、API、引擎）
src/          React UI
shared/       渲染/主进程共享类型与常量
extension/    MV3 浏览器扩展
docs/         公开文档（快速开始/架构/扩展/打包）
scripts/      smoke 测试与构建脚本
resources/bin 可选外部工具（运行时放置，不入库）
UserData/     运行时配置与 token（gitignore）
```

## 常用命令

```powershell
npm install
npm run typecheck
npm run smoke
npm run build
npm start
npm run pack:win
```

## 提交前检查清单

- [ ] `npm run typecheck` 通过
- [ ] `npm run smoke` 退出码为 0
- [ ] 未提交 `UserData/`、`release/`、`*.pem`、`resources/bin/*`、密钥
- [ ] UI 改动使用设计 token
- [ ] 文档与 CHANGELOG 已按需更新
- [ ] 无第三方产品商标/逆向笔记进入仓库
