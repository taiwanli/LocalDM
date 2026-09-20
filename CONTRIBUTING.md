# 贡献指南

感谢你对 LocalDM 的兴趣。

## 行为准则

参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 开发环境

- Windows 10/11 x64
- Node.js ≥ 20
- npm ≥ 10
- Git

```powershell
git clone https://github.com/taiwanli/LocalDM.git
cd LocalDM
npm install
npm run typecheck
npm run build
npm start
```

可选外部工具（视频 / HLS / BT）放到 `resources/bin/`：

- `yt-dlp.exe`
- `ffmpeg.exe`
- `aria2c.exe`

这些文件不会、也不应提交到仓库。

### 本地开发工作流

```powershell
# 终端 1
npm run dev:ui

# 终端 2
npm run watch:electron
npm run dev:electron
```

提交前请务必运行：

```powershell
npm run typecheck
npm run smoke
```

`smoke` 会做类型检查 + 引擎/API/队列等回归；个别外网用例可能以 WARN 结束，退出码为 0 时视为通过。

## 分支与提交

### 分支命名

| 类型 | 前缀 | 示例 |
|---|---|---|
| 功能 | `feat/` | `feat/task-context-menu` |
| 修复 | `fix/` | `fix/range-probe-cdn` |
| 文档 | `docs/` | `docs/getting-started` |
| 重构 | `refactor/` | `refactor/settings-tabs` |
| 杂务 | `chore/` | `chore/ci-node22` |

### 提交信息

建议使用简洁的祈使句，可带类型前缀：

```
feat: add batch pause/resume toolbar actions
fix: resume signed CDN tasks after 403 cooldown
docs: clarify extension load path
```

同一 PR 聚焦一件事；无关重构请拆分。

## Pull Request

1. Fork 仓库并创建特性分支。
2. 完成修改，保证 `npm run typecheck` 与 `npm run smoke` 通过。
3. 更新相关文档（README / docs / CHANGELOG）。
4. 打开 PR，填写模板：改了什么、为什么、如何验证。
5. 保持 PR 可审阅：说明关键取舍，必要时附日志或截图。

PR 会在 CI（typecheck + smoke）通过后进入评审。

## 报告 Bug

请使用 [Bug 报告模板](https://github.com/taiwanli/LocalDM/issues/new?template=bug_report.yml)，尽量提供：

- 版本号、安装方式（Setup / portable / 源码）
- 复现步骤与期望结果
- 任务 URL 类型（直链 / 视频页 / 磁力）——请勿粘贴含隐私的完整链接时可打码
- `userData/LocalDM/app.log` 相关片段（注意脱敏）

安全漏洞请勿公开提 Issue，见 [SECURITY.md](SECURITY.md)。

## 功能建议

使用 [功能建议模板](https://github.com/taiwanli/LocalDM/issues/new?template=feature_request.yml)，说明使用场景与替代方案。

## 代码约定摘要

完整约定见项目内开发文档；贡献时请注意：

1. **正确性优先**：续传必须校验 ETag/Length；异常不要吞掉。
2. **UI Token**：颜色/圆角/间距优先使用 `src/styles/tokens.css` 变量。
3. **安全**：禁止硬编码密钥；本地 API token 仅存 userData。
4. **依赖**：新增依赖需在 PR 中说明理由。
5. **注释**：只解释非显而易见的「为什么」。

## 许可

提交代码即表示你同意以 [MIT License](LICENSE) 授权你的贡献。
