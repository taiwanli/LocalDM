# 打包发布

本文说明如何在本地构建 Windows 安装包与便携版，并准备 GitHub Release。

## 前置条件

- Windows 10/11 x64
- Node.js ≥ 20、npm ≥ 10
- 仓库已 `npm install`
- 可选：将 `yt-dlp.exe` / `ffmpeg.exe` / `aria2c.exe` 放入 `resources/bin/`，打包时会进入 `extraResources`

图标文件：

- `build/icon.png` — 托盘 / 资源
- `build/icon.ico` — Windows 可执行文件图标（建议含 16–256 多尺寸）

## 本地打包

```powershell
npm run typecheck
npm run smoke
npm run pack:win
```

或只跑构建脚本：

```powershell
npm run dist:win
```

### 产物

| 路径 | 说明 |
|---|---|
| `release/LocalDM Setup <version>.exe` | NSIS 安装版 |
| `release/LocalDM-<version>-portable.exe` | 便携版 |
| `release/win-unpacked/` | 未打包应用目录，便于调试 |

安装包配置见 `package.json` → `build`：

- `appId`: `app.localdm.desktop`
- `directories.buildResources`: `build`
- `extraResources`: `bin/`、`icon.png`、`icon.ico`、`extension/`

## 版本号

发版前同步修改：

1. `package.json` 的 `version`
2. `CHANGELOG.md` 新增小节
3. 需要时更新 `extension/manifest.json` 的 `version`
4. Git tag：`vX.Y.Z`

```powershell
git tag -a v1.0.0 -m "LocalDM 1.0.0"
git push origin v1.0.0
```

## GitHub Release

### CLI 方式

```powershell
gh release create v1.0.0 `
  "release/LocalDM Setup 1.0.0.exe" `
  "release/LocalDM-1.0.0-portable.exe" `
  --title "LocalDM 1.0.0" `
  --notes-file docs/release-notes-template.md
```

### 建议附带内容

- 变更摘要（与 CHANGELOG 一致）
- 系统要求
- SmartScreen 说明
- 扩展加载路径提示
- 校验和（可选）：

```powershell
Get-FileHash "release\LocalDM Setup 1.0.0.exe" -Algorithm SHA256
```

## CI 说明

仓库 GitHub Actions（`.github/workflows/ci.yml`）会在 push / PR 时：

1. 安装 Node 依赖
2. `npm run typecheck`
3. `npm run smoke`

CI **不**自动上传安装包；Release 资产由维护者在本地或手动 workflow 附加。

若需自动发版，可自行增加 `workflow_dispatch` / `release` 触发的打包 job（Windows runner + `npm run pack:win` + `gh release upload`）。

## 签名

默认构建使用开发/无签名流程。若需消除 SmartScreen：

- 申请代码签名证书
- 配置 electron-builder `win.signtoolOptions` / 环境变量
- 重新 `pack:win`

开源个人项目常见做法是在 README/Release 中说明「未商业签名，请从本仓库 Releases 下载」。

## 清理

```powershell
# 删除构建产物（保留源码）
Remove-Item release -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item dist,dist-electron -Recurse -Force -ErrorAction SilentlyContinue
```

`release/`、`dist/`、`resources/bin/*`、`*.pem` 已在 `.gitignore` 中，不要提交私钥或本机工具二进制。
