import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  session,
  shell,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { APP_NAME, API_DEFAULT_PORT, PROTOCOL_SCHEME } from '../shared/constants';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type DownloadTask,
  type MediaQuality,
  type TaskStatus,
} from '../shared/types';
import { TaskRunner, clampRunnerSettings } from './engine/taskRunner';
import { LocalApiServer } from './api/server';
import {
  classifyClipboardDownloadText,
  decodeProtocolCapture,
} from '../shared/protocolUrl';
import { parseCaptureBody } from './api/protocol';
import type { CapturePayload } from '../shared/types';
import { initLogger, log, logError } from './logger';
import { effectiveHttpProxy, parseProxyUrl } from '../shared/proxy';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let taskRunner: TaskRunner | null = null;
let apiServer: LocalApiServer | null = null;
let tray: Tray | null = null;
let apiToken = '';
let apiPortBound = API_DEFAULT_PORT;
let isQuitting = false;
let clipboardTimer: NodeJS.Timeout | null = null;
let lastClipboardDownload = '';
let mainWindowTrayHintShown = false;

function currentSettings(): AppSettings {
  return loadSettings();
}

function handleTaskSettled(task: DownloadTask, _previousStatus: TaskStatus | undefined): void {
  if (task.status !== 'completed') return;
  const settings = currentSettings();
  if (settings.notifyOnComplete && Notification.isSupported()) {
    const notification = new Notification({
      title: `${APP_NAME} 下载完成`,
      body: task.filename,
    });
    notification.on('click', () => {
      showMainWindow();
      if (settings.openFolderOnComplete) {
        void shell.showItemInFolder(task.savePath);
      }
    });
    notification.show();
  }
  if (settings.openFolderOnComplete) {
    try {
      shell.showItemInFolder(task.savePath);
    } catch (error) {
      logError('open folder failed', task.savePath, error);
    }
  }
}

function userDataDir(): string {
  const dir = path.join(app.getPath('userData'), 'LocalDM');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function settingsPath(): string {
  return path.join(userDataDir(), 'settings.json');
}

function tokenPath(): string {
  return path.join(userDataDir(), 'api-token');
}

function loadSettings(): AppSettings {
  const fallbackDownloadDir = path.join(app.getPath('downloads'), 'LocalDM');
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      downloadDir: parsed.downloadDir || fallbackDownloadDir,
      apiPort: parsed.apiPort || API_DEFAULT_PORT,
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      downloadDir: fallbackDownloadDir,
      apiPort: API_DEFAULT_PORT,
    };
  }
}

function saveSettings(settings: AppSettings): void {
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function applyProxyEnv(proxyUrl: string): void {
  const value = (proxyUrl || '').trim();
  const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'] as const;
  if (value) {
    for (const key of keys) process.env[key] = value;
    process.env.NODE_USE_ENV_PROXY = '1';
  } else {
    for (const key of keys) delete process.env[key];
    delete process.env.NODE_USE_ENV_PROXY;
  }
}

async function applyProxySettings(proxyUrl: string): Promise<void> {
  applyProxyEnv(proxyUrl);
  try {
    await session.defaultSession.setProxy({
      proxyRules: (proxyUrl || '').trim() || 'direct://',
      proxyBypassRules: '<-loopback>',
    });
  } catch (error) {
    logError('apply proxy failed', error);
  }
}

function applyAutoLaunch(enabled: boolean): void {
  try {
    // Electron 44+ types: openAsHidden is macOS-only / removed; Windows uses --hidden
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      args: ['--hidden'],
    });
    log('autoLaunch', enabled ? 'on' : 'off');
  } catch (error) {
    logError('autoLaunch failed', error);
  }
}

function ensureApiToken(): string {
  try {
    return fs.readFileSync(tokenPath(), 'utf8').trim();
  } catch {
    const token = randomUUID().replace(/-/g, '');
    fs.writeFileSync(tokenPath(), token, { encoding: 'utf8', mode: 0o600 });
    return token;
  }
}

function broadcastTasks(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !taskRunner) return;
  mainWindow.webContents.send('tasks:updated', taskRunner.list());
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function resolveAppIcon(): string {
  const resourcesPath =
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || '';
  const candidates = [
    resourcesPath ? path.join(resourcesPath, 'icon.png') : '',
    resourcesPath ? path.join(resourcesPath, 'icon.ico') : '',
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.ico'),
    path.join(app.getAppPath(), 'icon.png'),
  ].filter(Boolean);
  return candidates.find((item) => fs.existsSync(item)) || candidates[0];
}

function resolveExtensionDir(): string {
  const resourcesPath =
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || '';
  const candidates = [
    resourcesPath ? path.join(resourcesPath, 'extension') : '',
    path.join(app.getAppPath(), 'extension'),
  ].filter(Boolean);
  return (
    candidates.find((item) => fs.existsSync(path.join(item, 'manifest.json'))) || ''
  );
}

function createTray(): void {
  if (tray) return;
  const iconPath = resolveAppIcon();
  if (!fs.existsSync(iconPath)) {
    log('tray icon missing', iconPath);
    return;
  }
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: '全部暂停',
        click: () => {
          void taskRunner?.pauseAll().then(() => broadcastTasks());
        },
      },
      {
        label: '全部恢复',
        click: () => {
          void taskRunner?.resumeAll().then(() => broadcastTasks());
        },
      },
      { type: 'separator' },
      { label: '退出 LocalDM', click: () => app.quit() },
    ]),
  );
  tray.on('click', () => showMainWindow());
}

function buildAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '添加 URL…',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            showMainWindow();
            mainWindow?.webContents.send('menu:action', 'add-url');
          },
        },
        {
          label: '打开下载目录',
          click: () => {
            const dir = loadSettings().downloadDir;
            fs.mkdirSync(dir, { recursive: true });
            void shell.openPath(dir);
          },
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '任务',
      submenu: [
        {
          label: '全部暂停',
          click: () => {
            void taskRunner?.pauseAll().then(() => broadcastTasks());
          },
        },
        {
          label: '全部恢复',
          click: () => {
            void taskRunner?.resumeAll().then(() => broadcastTasks());
          },
        },
        {
          label: '清空已完成',
          click: () => {
            void taskRunner?.clearFinished().then(() => broadcastTasks());
          },
        },
        {
          label: '清空失败',
          click: () => {
            void taskRunner?.clearFailed().then(() => broadcastTasks());
          },
        },
      ],
    },
    {
      label: '下载',
      submenu: [
        {
          label: '设置…',
          click: () => {
            showMainWindow();
            mainWindow?.webContents.send('menu:action', 'settings');
          },
        },
        {
          label: '关于 LocalDM',
          click: () => {
            showMainWindow();
            mainWindow?.webContents.send('menu:action', 'about');
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  const iconPath = resolveAppIcon();
  // Auto-launch uses --hidden: stay in tray until user opens the window.
  const startHidden =
    process.argv.includes('--hidden') &&
    loadSettings().autoLaunch &&
    loadSettings().minimizeToTray;
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    show: !startHidden,
    autoHideMenuBar: true,
    title: APP_NAME,
    backgroundColor: '#F2F2F7',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow?.show();
  });
  mainWindow.on('close', (event) => {
    if (currentSettings().minimizeToTray && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      if (!mainWindowTrayHintShown) {
        mainWindowTrayHintShown = true;
        try {
          if (Notification.isSupported()) {
            const n = new Notification({
              title: `${APP_NAME} 仍在运行`,
              body: '已最小化到托盘。双击托盘图标或从菜单「显示主窗口」再打开。',
            });
            n.show();
          }
        } catch (error) {
          logError('tray hint failed', error);
        }
      }
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const distIndex = path.join(app.getAppPath(), 'dist/index.html');
  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (fs.existsSync(distIndex)) {
    void mainWindow.loadFile(distIndex);
  } else if (isDev) {
    void mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    void mainWindow.loadFile(distIndex);
  }
}

function normalizeSettings(raw: Partial<AppSettings>): AppSettings {
  const base = { ...loadSettings(), ...raw };
  const clamped = clampRunnerSettings(base);
  return {
    ...base,
    ...clamped,
    globalSpeedLimitBps: Math.max(0, Math.floor(base.globalSpeedLimitBps || 0)),
    apiPort: Math.min(65535, Math.max(1024, Math.floor(base.apiPort || API_DEFAULT_PORT))),
    theme: base.theme === 'light' || base.theme === 'dark' ? base.theme : 'follow',
    downloadDir: String(base.downloadDir || '').trim() || loadSettings().downloadDir,
    notifyOnComplete: Boolean(base.notifyOnComplete),
    openFolderOnComplete: Boolean(base.openFolderOnComplete),
    ytdlpPath: String(base.ytdlpPath || ''),
    ffmpegPath: String(base.ffmpegPath || ''),
    defaultMediaQuality: base.defaultMediaQuality || 'best',
    httpProxy: String(base.httpProxy || '').trim(),
    proxyType:
      base.proxyType === 'https' || base.proxyType === 'socks5' || base.proxyType === 'socks4'
        ? base.proxyType
        : 'http',
    proxyHost: String(base.proxyHost || '').trim(),
    proxyPort: String(base.proxyPort || '').trim(),
    proxyUser: String(base.proxyUser || ''),
    proxyPass: String(base.proxyPass || ''),
    autoLaunch: Boolean(base.autoLaunch),
    onboardingDone: Boolean(base.onboardingDone),
    maxRetryCount: Math.max(0, Math.min(10, Math.floor(base.maxRetryCount ?? 2))),
    retryDelayMs: Math.max(0, Math.floor(base.retryDelayMs ?? 3000)),
    hfCookie: String(base.hfCookie || ''),
    hfToken: String(base.hfToken || ''),
    minimizeToTray: Boolean(base.minimizeToTray),
    requireApiToken: Boolean(base.requireApiToken),
    aria2cPath: String(base.aria2cPath || ''),
    enableBt: base.enableBt !== false,
    btTrackers: String(base.btTrackers || ''),
    btMetadataTimeoutSec: Math.max(
      0,
      Math.min(3600, Math.floor(base.btMetadataTimeoutSec ?? 180)),
    ),
    systemTakeoverEnabled: Boolean(base.systemTakeoverEnabled),
    clipboardTakeoverEnabled: Boolean(base.clipboardTakeoverEnabled),
    downloadMode:
      base.downloadMode === 'default' ||
      base.downloadMode === 'turbo' ||
      base.downloadMode === 'balanced' ||
      base.downloadMode === 'adaptive'
        ? base.downloadMode
        : 'adaptive',
    adaptiveDegrade: base.adaptiveDegrade !== false,
    cookieBrowser:
      base.cookieBrowser === 'chrome' ||
      base.cookieBrowser === 'edge' ||
      base.cookieBrowser === 'firefox' ||
      base.cookieBrowser === 'twinkstar'
        ? base.cookieBrowser
        : '',
    cookieFile: String(base.cookieFile || '').trim(),
    askVideoQuality: Boolean(base.askVideoQuality),
    useNativeHls: base.useNativeHls !== false,
    accent:
      base.accent === 'purple' ||
      base.accent === 'pink' ||
      base.accent === 'orange' ||
      base.accent === 'green' ||
      base.accent === 'teal' ||
      base.accent === 'indigo' ||
      base.accent === 'graphite'
        ? base.accent
        : 'blue',
  };
}

async function applySettingsToRunner(runner: TaskRunner, next: AppSettings): Promise<void> {
  const composedProxy = effectiveHttpProxy(next);
  const normalized: AppSettings = { ...next, httpProxy: composedProxy };
  saveSettings(normalized);
  await applyProxySettings(composedProxy);
  applyAutoLaunch(normalized.autoLaunch);
  runner.updateDeps({
    downloadDir: normalized.downloadDir,
    maxConnections: normalized.maxConnections,
    maxConnectionsPerServer: normalized.maxConnectionsPerServer,
    minSegmentBytes: normalized.minSegmentBytes,
    maxConcurrentTasks: normalized.maxConcurrentTasks,
    globalSpeedLimitBps: normalized.globalSpeedLimitBps,
    ytdlpPath: normalized.ytdlpPath,
    ffmpegPath: normalized.ffmpegPath,
    defaultMediaQuality: normalized.defaultMediaQuality,
    httpProxy: composedProxy,
    maxRetryCount: normalized.maxRetryCount,
    retryDelayMs: normalized.retryDelayMs,
    hfCookie: normalized.hfCookie,
    hfToken: normalized.hfToken,
    aria2cPath: normalized.aria2cPath,
    enableBt: normalized.enableBt,
    btTrackers: normalized.btTrackers,
    btMetadataTimeoutSec: normalized.btMetadataTimeoutSec,
    adaptiveDegrade: normalized.adaptiveDegrade,
    cookieBrowser: normalized.cookieBrowser,
    cookieFile: normalized.cookieFile,
    askVideoQuality: normalized.askVideoQuality,
    useNativeHls: normalized.useNativeHls,
    downloadMode: normalized.downloadMode,
    appRoot: app.getAppPath(),
  });
}

function registerIpc(runner: TaskRunner): void {
  ipcMain.handle('app:getBootstrap', async () => {
    const settings = loadSettings();
    const token = ensureApiToken();
    return {
      appName: APP_NAME,
      settings,
      health: {
        apiPort: apiServer?.port || settings.apiPort,
        tokenRequired: settings.requireApiToken,
        ytdlpAvailable:
          fs.existsSync(path.join(app.getAppPath(), 'resources/bin/yt-dlp.exe')) ||
          fs.existsSync(
            path.join(
              (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || '',
              'bin/yt-dlp.exe',
            ),
          ),
        ffmpegAvailable:
          fs.existsSync(path.join(app.getAppPath(), 'resources/bin/ffmpeg.exe')) ||
          fs.existsSync(
            path.join(
              (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || '',
              'bin/ffmpeg.exe',
            ),
          ),
        aria2cAvailable:
          fs.existsSync(path.join(app.getAppPath(), 'resources/bin/aria2c.exe')) ||
          fs.existsSync(
            path.join(
              (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || '',
              'bin/aria2c.exe',
            ),
          ) ||
          Boolean(settings.aria2cPath && fs.existsSync(settings.aria2cPath)),
        systemTakeoverEnabled: Boolean(settings.systemTakeoverEnabled),
      },
      tokenPreview: `${token.slice(0, 4)}…`,
      apiToken: token,
      userDataDir: userDataDir(),
      about: {
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform,
        userDataDir: userDataDir(),
        appPath: app.getAppPath(),
        apiPort: apiPortBound,
        httpProxy: settings.httpProxy || '（直连）',
        disclaimer: '',
        extensionPath: resolveExtensionDir() || '（未打包，请手动加载项目 extension/）',
        downloadMode: settings.downloadMode,
      },
    };
  });

  ipcMain.handle('app:saveSettings', async (_event, partial: Partial<AppSettings>) => {
    const next = normalizeSettings(partial);
    await applySettingsToRunner(runner, next);
    if (next.systemTakeoverEnabled && next.clipboardTakeoverEnabled) {
      startClipboardTakeoverMonitor();
    } else {
      stopClipboardTakeoverMonitor();
    }
    return next;
  });

  ipcMain.handle('app:getTheme', async () => loadSettings().theme);
  ipcMain.handle('app:getExtensionStatus', async () => {
    const extensionDir = resolveExtensionDir();
    return {
      extensionDir: extensionDir || null,
      manifestExists: Boolean(extensionDir && fs.existsSync(path.join(extensionDir, 'manifest.json'))),
    };
  });
  ipcMain.handle('app:copyText', async (_event, text: string) => {
    if (typeof text !== 'string') return false;
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('shell:showItemInFolder', async (_event, targetPath: string) => {
    if (typeof targetPath !== 'string' || !targetPath) throw new Error('[IPC] path required');
    shell.showItemInFolder(targetPath);
  });
  ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
    if (typeof targetPath !== 'string' || !targetPath) throw new Error('[IPC] path required');
    await shell.openPath(targetPath);
  });

  ipcMain.handle('tasks:list', async () => runner.list());
  ipcMain.handle(
    'tasks:addUrl',
    async (
      _event,
      url: string,
      options?: {
        headers?: Record<string, string>;
        mediaQuality?: MediaQuality;
        saveDir?: string;
        startPaused?: boolean;
      },
    ) => {
      if (typeof url !== 'string') throw new Error('[IPC] url must be string');
      const task = await runner.addFromCapture(
        {
          kind: 'direct',
          url,
          headers: options?.headers,
          saveDir: options?.saveDir,
          startPaused: options?.startPaused,
        },
        { skipDedupe: true },
      );
      if (options?.mediaQuality) runner.setTaskMediaQuality(task.id, options.mediaQuality);
      broadcastTasks();
      return runner.get(task.id) || task;
    },
  );
  ipcMain.handle('dialog:chooseDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('media:probeFormats', async (_event, url: string) => {
    if (typeof url !== 'string' || !url) throw new Error('[IPC] url required');
    return runner.probeMediaFormats(url);
  });
  ipcMain.handle('tasks:pause', async (_event, taskId: string) => {
    await runner.pause(taskId);
  });
  ipcMain.handle('tasks:resume', async (_event, taskId: string) => {
    await runner.resume(taskId);
    broadcastTasks();
  });
  ipcMain.handle('tasks:cancel', async (_event, taskId: string) => {
    await runner.cancel(taskId);
    broadcastTasks();
  });
  ipcMain.handle('tasks:setSpeedLimit', async (_event, taskId: string, limitBps: number) => {
    if (typeof taskId !== 'string' || !taskId) throw new Error('[IPC] taskId required');
    if (typeof limitBps !== 'number' || !Number.isFinite(limitBps) || limitBps < 0) {
      throw new Error('[IPC] limitBps must be a non-negative number');
    }
    const task = runner.setTaskSpeedLimit(taskId, limitBps);
    broadcastTasks();
    return task;
  });
  ipcMain.handle('tasks:setMediaQuality', async (_event, taskId: string, quality: MediaQuality) => {
    if (typeof taskId !== 'string' || !taskId) throw new Error('[IPC] taskId required');
    const allowed: MediaQuality[] = ['best', '2160', '1440', '1080', '720', '480', 'audio'];
    if (!allowed.includes(quality)) throw new Error('[IPC] invalid media quality');
    const task = runner.setTaskMediaQuality(taskId, quality);
    broadcastTasks();
    return task;
  });
  ipcMain.handle('tasks:remove', async (_event, taskId: string, deleteFiles: boolean) => {
    await runner.remove(taskId, Boolean(deleteFiles));
    broadcastTasks();
  });
  ipcMain.handle('tasks:pauseAll', async () => {
    const count = await runner.pauseAll();
    broadcastTasks();
    return count;
  });
  ipcMain.handle('tasks:resumeAll', async () => {
    const count = await runner.resumeAll();
    broadcastTasks();
    return count;
  });
  ipcMain.handle('tasks:clearFinished', async () => {
    const count = await runner.clearFinished();
    broadcastTasks();
    return count;
  });
  ipcMain.handle('tasks:clearFailed', async () => {
    const count = await runner.clearFailed();
    broadcastTasks();
    return count;
  });
}

function startClipboardTakeoverMonitor(): void {
  if (clipboardTimer) return;
  clipboardTimer = setInterval(() => {
    void (async () => {
      const settings = loadSettings();
      if (!settings.systemTakeoverEnabled || !settings.clipboardTakeoverEnabled) return;
      let text = '';
      try {
        const value = clipboard.readText() as string | Promise<string>;
        text = (await Promise.resolve(value)) || '';
      } catch {
        return;
      }
      const classified = classifyClipboardDownloadText(text);
      if (!classified) return;
      if (classified.url === lastClipboardDownload) return;
      lastClipboardDownload = classified.url;
      if (!taskRunner) return;
      try {
        const task = await taskRunner.addFromCapture({
          kind: classified.kind,
          url: classified.url,
        });
        broadcastTasks();
        log('clipboard takeover', task.id, classified.url.slice(0, 80));
      } catch (error: unknown) {
        logError('clipboard takeover failed', error);
      }
    })();
  }, 1200);
}

function stopClipboardTakeoverMonitor(): void {
  if (!clipboardTimer) return;
  clearInterval(clipboardTimer);
  clipboardTimer = null;
}

function handleLocaldmProtocol(rawUrl: string): void {
  if (!rawUrl || !rawUrl.toLowerCase().startsWith(`${PROTOCOL_SCHEME}://`)) return;
  void (async () => {
    try {
      const decoded = decodeProtocolCapture(rawUrl);
      const payload = parseCaptureBody(JSON.stringify(decoded));
      if (!taskRunner) return;
      const task = await taskRunner.addFromCapture(payload as CapturePayload);
      broadcastTasks();
      try {
        if (Notification.isSupported()) {
          const n = new Notification({
            title: `${APP_NAME} 已接管下载`,
            body: task.filename || payload.url.slice(0, 80),
          });
          n.show();
        }
      } catch {
        /* ignore */
      }
      showMainWindow();
      log('protocol capture', task.id, payload.url.slice(0, 80));
    } catch (error) {
      logError(
        'protocol capture failed',
        error instanceof Error ? error.message : String(error),
        rawUrl.slice(0, 120),
      );
    }
  })();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    showMainWindow();
    const protocolArg = argv.find((item) => String(item).startsWith(`${PROTOCOL_SCHEME}://`));
    if (protocolArg) handleLocaldmProtocol(String(protocolArg));
  });

  app.on('open-url', (_event, url) => {
    handleLocaldmProtocol(url);
  });

  void app.whenReady().then(async () => {
    initLogger(userDataDir());
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [
          path.resolve(process.argv[1]),
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
    }

    const settings = loadSettings();
    apiToken = ensureApiToken();
    fs.mkdirSync(settings.downloadDir, { recursive: true });
    await applyProxySettings(effectiveHttpProxy(settings));
    applyAutoLaunch(settings.autoLaunch);
    buildAppMenu();
    createTray();
    if (process.argv.includes('--hidden') && settings.minimizeToTray) {
      log('started hidden to tray');
    }
    if (settings.systemTakeoverEnabled && settings.clipboardTakeoverEnabled) {
      startClipboardTakeoverMonitor();
    }

    taskRunner = new TaskRunner({
      userDataDir: userDataDir(),
      downloadDir: settings.downloadDir,
      maxConnections: settings.maxConnections,
      maxConnectionsPerServer: settings.maxConnectionsPerServer,
      minSegmentBytes: settings.minSegmentBytes,
      maxConcurrentTasks: settings.maxConcurrentTasks,
      globalSpeedLimitBps: settings.globalSpeedLimitBps,
      appRoot: app.getAppPath(),
      ytdlpPath: settings.ytdlpPath,
      ffmpegPath: settings.ffmpegPath,
      defaultMediaQuality: settings.defaultMediaQuality,
      httpProxy: settings.httpProxy,
      maxRetryCount: settings.maxRetryCount,
      retryDelayMs: settings.retryDelayMs,
      hfCookie: settings.hfCookie,
      hfToken: settings.hfToken,
      hfConnectionCap: 4,
      aria2cPath: settings.aria2cPath,
      enableBt: settings.enableBt,
      adaptiveDegrade: settings.adaptiveDegrade,
      cookieBrowser: settings.cookieBrowser,
      cookieFile: settings.cookieFile,
      askVideoQuality: settings.askVideoQuality,
      useNativeHls: settings.useNativeHls,
      downloadMode: settings.downloadMode,
      btTrackers: settings.btTrackers,
      btMetadataTimeoutSec: settings.btMetadataTimeoutSec,
      onTaskStatusSettled: handleTaskSettled,
    });
    taskRunner.on('tasks', broadcastTasks);

    const makeApiServer = (port: number): LocalApiServer =>
      new LocalApiServer({
        port,
        token: apiToken,
        requireToken: settings.requireApiToken,
        getSystemTakeoverEnabled: () => Boolean(loadSettings().systemTakeoverEnabled),
        onCapture: async (payload) => {
          const task = await taskRunner!.addFromCapture(payload);
          broadcastTasks();
          try {
            if (Notification.isSupported()) {
              const n = new Notification({
                title: `${APP_NAME} 已接管下载`,
                body: task.filename || task.url.slice(0, 80),
              });
              n.show();
            }
          } catch {
            /* ignore */
          }
          return task;
        },
        tasks: {
          list: () => taskRunner!.list(),
          get: (id) => taskRunner!.get(id),
          create: async (input) => {
            const task = await taskRunner!.createTask(input);
            broadcastTasks();
            return task;
          },
          pause: async (id) => {
            await taskRunner!.pause(id);
            broadcastTasks();
          },
          resume: async (id) => {
            await taskRunner!.resume(id);
            broadcastTasks();
          },
          remove: async (id, deleteFiles) => {
            await taskRunner!.remove(id, deleteFiles);
            broadcastTasks();
          },
        },
        settings: {
          get: () => loadSettings(),
          update: async (partial) => {
            const next = normalizeSettings(partial as Partial<AppSettings>);
            await applySettingsToRunner(taskRunner!, next);
            return next;
          },
        },
      });

    const preferredPort = settings.apiPort || API_DEFAULT_PORT;
    let bound: number | null = null;
    for (let offset = 0; offset <= 10 && bound === null; offset += 1) {
      const candidate = preferredPort + offset;
      apiServer = makeApiServer(candidate);
      try {
        bound = await apiServer.start();
        apiPortBound = bound;
        log('API listening', `127.0.0.1:${bound}`);
      } catch (error) {
        logError('API bind failed', candidate, error);
        try {
          await apiServer.stop();
        } catch {
          /* ignore */
        }
        apiServer = null;
      }
    }
    if (bound === null) {
      logError('API failed to bind any port near', preferredPort);
    }

    registerIpc(taskRunner);
    createWindow();

    const coldProtocol = process.argv.find((item) =>
      String(item).startsWith(`${PROTOCOL_SCHEME}://`),
    );
    if (coldProtocol) handleLocaldmProtocol(String(coldProtocol));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showMainWindow();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopClipboardTakeoverMonitor();
    void apiServer?.stop();
    void import('./engine/torrentEngine')
      .then((m) => m.getAria2Daemon().shutdown())
      .catch(() => undefined);
  });

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return;
    if (currentSettings().minimizeToTray && tray) return;
    app.quit();
  });
}
