import { useMemo, useState } from 'react';
import type {
  AccentPreference,
  AppSettings,
  MediaQuality,
  ThemePreference,
} from '@shared/types';
import { ACCENT_LABELS, MEDIA_QUALITY_LABELS } from '@shared/types';
import { buildProxyUrl, parseProxyUrl } from '@shared/proxy';

interface Props {
  settings: AppSettings;
  onClose: () => void;
  onSave: (partial: Partial<AppSettings>) => Promise<void>;
  extensionHint?: string;
  extensionConnected?: boolean;
  onOpenLogs?: () => void;
}

type PanelId = 'general' | 'advanced' | 'system';

const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: 'follow', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
];

const PANELS: { id: PanelId; label: string; desc: string }[] = [
  { id: 'general', label: '常规', desc: '目录 · 完成动作 · 外观' },
  { id: 'advanced', label: '进阶', desc: '连接 · 代理 · 媒体 · BT' },
  { id: 'system', label: '系统', desc: '托管 · 托盘 · API' },
];

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function SettingsDialog({
  settings,
  onClose,
  onSave,
  extensionHint,
  extensionConnected,
  onOpenLogs,
}: Props) {
  const [draft, setDraft] = useState<AppSettings>({
    ...settings,
    accent: settings.accent || 'blue',
    enableBt: settings.enableBt !== false,
    aria2cPath: settings.aria2cPath || '',
    hfCookie: settings.hfCookie || '',
    hfToken: settings.hfToken || '',
    httpProxy: settings.httpProxy || '',
    proxyType: settings.proxyType || 'http',
    proxyHost: settings.proxyHost || '',
    proxyPort: settings.proxyPort || '',
    proxyUser: settings.proxyUser || '',
    proxyPass: settings.proxyPass || '',
    autoLaunch: Boolean(settings.autoLaunch),
    systemTakeoverEnabled: Boolean(settings.systemTakeoverEnabled),
    clipboardTakeoverEnabled: Boolean(settings.clipboardTakeoverEnabled),
    adaptiveDegrade: settings.adaptiveDegrade !== false,
    cookieBrowser: settings.cookieBrowser || '',
    askVideoQuality: Boolean(settings.askVideoQuality),
    useNativeHls: settings.useNativeHls !== false,
  });
  const [panel, setPanel] = useState<PanelId>('general');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const proxyDisplay = useMemo(
    () =>
      buildProxyUrl({
        proxyEnabled: true,
        proxyType: draft.proxyType,
        proxyHost: draft.proxyHost,
        proxyPort: draft.proxyPort,
        proxyUser: draft.proxyUser,
        proxyPass: draft.proxyPass,
      }) || draft.httpProxy,
    [draft.proxyType, draft.proxyHost, draft.proxyPort, draft.proxyUser, draft.proxyPass, draft.httpProxy],
  );

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const partial: Partial<AppSettings> = {
        downloadDir: draft.downloadDir.trim() || settings.downloadDir,
        maxConnections: clampInt(draft.maxConnections, 1, 64, 32),
        maxConnectionsPerServer: clampInt(draft.maxConnectionsPerServer, 1, 64, 32),
        minSegmentBytes: clampInt(draft.minSegmentBytes, 64 * 1024, 64 * 1024 * 1024, 1024 * 1024),
        maxConcurrentTasks: clampInt(draft.maxConcurrentTasks, 1, 16, 3),
        globalSpeedLimitBps: Math.max(0, Math.floor(draft.globalSpeedLimitBps || 0)),
        theme: draft.theme,
        apiPort: clampInt(draft.apiPort, 1024, 65535, 37280),
        ytdlpPath: draft.ytdlpPath.trim(),
        ffmpegPath: draft.ffmpegPath.trim(),
        defaultMediaQuality: draft.defaultMediaQuality || 'best',
        enableBrowserCapture: draft.enableBrowserCapture,
        takeoverEnabled: draft.takeoverEnabled,
        notifyOnComplete: draft.notifyOnComplete,
        openFolderOnComplete: draft.openFolderOnComplete,
        httpProxy: proxyDisplay.trim(),
        proxyType: draft.proxyType,
        proxyHost: draft.proxyHost.trim(),
        proxyPort: String(draft.proxyPort || '').trim(),
        proxyUser: draft.proxyUser || '',
        proxyPass: draft.proxyPass || '',
        autoLaunch: draft.autoLaunch,
        maxRetryCount: clampInt(draft.maxRetryCount, 0, 10, 2),
        retryDelayMs: clampInt(draft.retryDelayMs, 0, 600_000, 3000),
        hfCookie: draft.hfCookie.trim(),
        hfToken: draft.hfToken.trim(),
        minimizeToTray: draft.minimizeToTray,
        requireApiToken: draft.requireApiToken,
        aria2cPath: draft.aria2cPath.trim(),
        enableBt: draft.enableBt,
        accent: draft.accent || 'blue',
        systemTakeoverEnabled: draft.systemTakeoverEnabled,
        clipboardTakeoverEnabled: draft.clipboardTakeoverEnabled,
        adaptiveDegrade: draft.adaptiveDegrade !== false,
        cookieBrowser: draft.cookieBrowser || '',
        askVideoQuality: draft.askVideoQuality,
        useNativeHls: draft.useNativeHls,
      };
      await onSave(partial);
      setMessage('已保存');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div
        className="dialog glass-thick"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="head">
          <div>
            <h2 className="title">设置</h2>
            <div className="sub">当前页：{PANELS.find((p) => p.id === panel)?.desc}</div>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="layout">
          <nav className="nav" aria-label="设置分组">
            {PANELS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item${panel === item.id ? ' is-active' : ''}`}
                onClick={() => setPanel(item.id)}
              >
                <span className="nav-label">{item.label}</span>
                <span className="nav-desc">{item.desc}</span>
              </button>
            ))}
          </nav>

          <div className="panel">
            {panel === 'general' && (
              <>
                <section className="group">
                  <div className="group-title">下载目录与行为</div>
                  <label className="field">
                    <span>下载目录</span>
                    <input
                      className="input"
                      value={draft.downloadDir}
                      onChange={(event) => update('downloadDir', event.target.value)}
                      spellCheck={false}
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.adaptiveDegrade}
                      onChange={(event) => update('adaptiveDegrade', event.target.checked)}
                    />
                    <span>
                      限流时自动降并发
                      <em>（567/403/429 冷却并减少连接，推荐开启）</em>
                    </span>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.notifyOnComplete}
                      onChange={(event) => update('notifyOnComplete', event.target.checked)}
                    />
                    <span>下载完成后通知</span>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.openFolderOnComplete}
                      onChange={(event) => update('openFolderOnComplete', event.target.checked)}
                    />
                    <span>完成后打开所在文件夹</span>
                  </label>
                </section>

                <section className="group">
                  <div className="group-title">外观</div>
                  <div className="segmented" role="tablist" aria-label="主题">
                    {THEME_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="tab"
                        aria-selected={draft.theme === option.id}
                        className={`seg-item${draft.theme === option.id ? ' is-active' : ''}`}
                        onClick={() => update('theme', option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="group-title" style={{ marginTop: 12 }}>
                    强调色
                  </div>
                  <div className="accent-grid" role="listbox" aria-label="强调色">
                    {(Object.keys(ACCENT_LABELS) as AccentPreference[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        role="option"
                        aria-selected={draft.accent === key}
                        className={`accent-item${draft.accent === key ? ' is-active' : ''}`}
                        onClick={() => update('accent', key)}
                      >
                        <span className="accent-dot" data-accent-swatch={key} />
                        <span>{ACCENT_LABELS[key]}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}

            {panel === 'advanced' && (
              <>
                <section className="group">
                  <div className="group-title">连接与队列</div>
                  <div className="grid-2">
                    <label className="field">
                      <span>最大分段连接数</span>
                      <input
                        className="input mono"
                        type="number"
                        min={1}
                        max={64}
                        value={draft.maxConnections}
                        onChange={(event) => update('maxConnections', Number(event.target.value))}
                      />
                    </label>
                    <label className="field">
                      <span>单服务器上限</span>
                      <input
                        className="input mono"
                        type="number"
                        min={1}
                        max={64}
                        value={draft.maxConnectionsPerServer}
                        onChange={(event) =>
                          update('maxConnectionsPerServer', Number(event.target.value))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>同时任务数</span>
                      <input
                        className="input mono"
                        type="number"
                        min={1}
                        max={16}
                        value={draft.maxConcurrentTasks}
                        onChange={(event) =>
                          update('maxConcurrentTasks', Number(event.target.value))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>最小分段 (字节)</span>
                      <input
                        className="input mono"
                        type="number"
                        min={65536}
                        value={draft.minSegmentBytes}
                        onChange={(event) => update('minSegmentBytes', Number(event.target.value))}
                      />
                    </label>
                    <label className="field">
                      <span>全局限速 (B/s，0=不限)</span>
                      <input
                        className="input mono"
                        type="number"
                        min={0}
                        value={draft.globalSpeedLimitBps}
                        onChange={(event) =>
                          update('globalSpeedLimitBps', Number(event.target.value))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>自动重试次数</span>
                      <input
                        className="input mono"
                        type="number"
                        min={0}
                        max={10}
                        value={draft.maxRetryCount}
                        onChange={(event) => update('maxRetryCount', Number(event.target.value))}
                      />
                    </label>
                    <label className="field">
                      <span>重试间隔 (ms)</span>
                      <input
                        className="input mono"
                        type="number"
                        min={0}
                        value={draft.retryDelayMs}
                        onChange={(event) => update('retryDelayMs', Number(event.target.value))}
                      />
                    </label>
                  </div>
                </section>

                <section className="group">
                  <div className="group-title">代理</div>
                  <label className="field">
                    <span>代理地址（可整段粘贴）</span>
                    <input
                      className="input mono"
                      value={proxyDisplay}
                      onChange={(event) => {
                        const parsed = parseProxyUrl(event.target.value);
                        update('httpProxy', event.target.value);
                        update('proxyType', parsed.proxyType);
                        update('proxyHost', parsed.proxyHost);
                        update('proxyPort', parsed.proxyPort);
                        update('proxyUser', parsed.proxyUser);
                        update('proxyPass', parsed.proxyPass);
                      }}
                      placeholder="http://127.0.0.1:7890"
                      spellCheck={false}
                    />
                  </label>
                  <div className="grid-2">
                    <label className="field">
                      <span>类型</span>
                      <select
                        className="input"
                        value={draft.proxyType}
                        onChange={(e) =>
                          update('proxyType', e.target.value as AppSettings['proxyType'])
                        }
                      >
                        <option value="http">HTTP</option>
                        <option value="https">HTTPS</option>
                        <option value="socks5">SOCKS5</option>
                        <option value="socks4">SOCKS4</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>主机</span>
                      <input
                        className="input mono"
                        value={draft.proxyHost}
                        onChange={(e) => update('proxyHost', e.target.value)}
                        placeholder="127.0.0.1"
                        spellCheck={false}
                      />
                    </label>
                    <label className="field">
                      <span>端口</span>
                      <input
                        className="input mono"
                        value={draft.proxyPort}
                        onChange={(e) => update('proxyPort', e.target.value)}
                        placeholder="7890"
                      />
                    </label>
                    <label className="field">
                      <span>用户名</span>
                      <input
                        className="input mono"
                        value={draft.proxyUser}
                        onChange={(e) => update('proxyUser', e.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>密码</span>
                      <input
                        className="input mono"
                        type="password"
                        value={draft.proxyPass}
                        onChange={(e) => update('proxyPass', e.target.value)}
                      />
                    </label>
                  </div>
                </section>

                <section className="group">
                  <div className="group-title">媒体与 BT</div>
                  <div className="grid-2">
                    <label className="field">
                      <span>默认清晰度</span>
                      <select
                        className="input"
                        value={draft.defaultMediaQuality || 'best'}
                        onChange={(event) =>
                          update('defaultMediaQuality', event.target.value as MediaQuality)
                        }
                      >
                        {(Object.keys(MEDIA_QUALITY_LABELS) as MediaQuality[]).map((key) => (
                          <option key={key} value={key}>
                            {MEDIA_QUALITY_LABELS[key]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Cookie 浏览器</span>
                      <select
                        className="input"
                        value={draft.cookieBrowser || ''}
                        onChange={(event) =>
                          update(
                            'cookieBrowser',
                            event.target.value as AppSettings['cookieBrowser'],
                          )
                        }
                      >
                        <option value="">不使用</option>
                        <option value="chrome">Chrome</option>
                        <option value="edge">Edge</option>
                        <option value="firefox">Firefox</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>yt-dlp 路径</span>
                      <input
                        className="input mono"
                        value={draft.ytdlpPath}
                        onChange={(event) => update('ytdlpPath', event.target.value)}
                        placeholder="resources/bin/yt-dlp.exe"
                        spellCheck={false}
                      />
                    </label>
                    <label className="field">
                      <span>ffmpeg 路径</span>
                      <input
                        className="input mono"
                        value={draft.ffmpegPath}
                        onChange={(event) => update('ffmpegPath', event.target.value)}
                        placeholder="resources/bin/ffmpeg.exe"
                        spellCheck={false}
                      />
                    </label>
                    <label className="field">
                      <span>aria2c 路径</span>
                      <input
                        className="input mono"
                        value={draft.aria2cPath}
                        onChange={(event) => update('aria2cPath', event.target.value)}
                        placeholder="resources/bin/aria2c.exe"
                        spellCheck={false}
                      />
                    </label>
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.enableBt}
                      onChange={(event) => update('enableBt', event.target.checked)}
                    />
                    <span>启用 BT / 磁力下载</span>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.useNativeHls}
                      onChange={(event) => update('useNativeHls', event.target.checked)}
                    />
                    <span>m3u8 优先内置 HLS</span>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.askVideoQuality}
                      onChange={(event) => update('askVideoQuality', event.target.checked)}
                    />
                    <span>添加平台视频时显示格式探测</span>
                  </label>
                  <div className="grid-2">
                    <label className="field">
                      <span>HuggingFace Cookie</span>
                      <input
                        className="input mono"
                        value={draft.hfCookie}
                        onChange={(event) => update('hfCookie', event.target.value)}
                        placeholder="仅 hf 域名"
                        spellCheck={false}
                      />
                    </label>
                    <label className="field">
                      <span>HuggingFace Token</span>
                      <input
                        className="input mono"
                        type="password"
                        value={draft.hfToken}
                        onChange={(event) => update('hfToken', event.target.value)}
                        placeholder="hf_…"
                        spellCheck={false}
                      />
                    </label>
                  </div>
                </section>
              </>
            )}

            {panel === 'system' && (
              <>
                <section className="group">
                  <div className="group-title">浏览器扩展与托管</div>
                  <div className={`hint${extensionConnected ? ' ok' : ''}`}>
                    {extensionConnected
                      ? `扩展目录已就绪${extensionHint ? `：${extensionHint}` : ''}`
                      : '未检测到扩展目录；托管需在 Chrome 加载扩展后才生效。'}
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.systemTakeoverEnabled}
                      onChange={(event) => update('systemTakeoverEnabled', event.target.checked)}
                    />
                    <span>
                      <strong>系统下载托管</strong>
                      <em>（浏览器下载默认走 LocalDM）</em>
                    </span>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.clipboardTakeoverEnabled}
                      disabled={!draft.systemTakeoverEnabled}
                      onChange={(event) =>
                        update('clipboardTakeoverEnabled', event.target.checked)
                      }
                    />
                    <span>监听剪贴板下载链接</span>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.takeoverEnabled}
                      onChange={(event) => update('takeoverEnabled', event.target.checked)}
                    />
                    <span>扩展本地接管</span>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.enableBrowserCapture}
                      onChange={(event) => update('enableBrowserCapture', event.target.checked)}
                    />
                    <span>启用浏览器 capture API</span>
                  </label>
                </section>

                <section className="group">
                  <div className="group-title">窗口与启动</div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.minimizeToTray}
                      onChange={(event) => update('minimizeToTray', event.target.checked)}
                    />
                    <span>关闭窗口时最小化到托盘</span>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.autoLaunch}
                      onChange={(event) => update('autoLaunch', event.target.checked)}
                    />
                    <span>开机自启并隐藏到托盘</span>
                  </label>
                </section>

                <section className="group">
                  <div className="group-title">本地 API</div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.requireApiToken}
                      onChange={(event) => update('requireApiToken', event.target.checked)}
                    />
                    <span>非 health 接口要求 Token</span>
                  </label>
                  <label className="field">
                    <span>API 端口（重启生效）</span>
                    <input
                      className="input mono"
                      type="number"
                      min={1024}
                      max={65535}
                      value={draft.apiPort}
                      onChange={(event) => update('apiPort', Number(event.target.value))}
                    />
                  </label>
                </section>
              </>
            )}
          </div>
        </div>

        <footer className="foot">
          {message && <span className="msg">{message}</span>}
          {onOpenLogs && (
            <button type="button" className="btn-secondary" onClick={onOpenLogs}>
              日志
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={saving}
            onClick={() => void handleSubmit()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
      <style>{styles}</style>
    </div>
  );
}

const styles = `
.overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.28);
  display: grid; place-items: center; z-index: 60;
}
.dialog {
  width: min(760px, calc(100vw - 40px));
  max-height: min(88vh, 780px);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-xl);
  padding: 0;
  overflow: hidden;
}
.head {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: var(--space-5) var(--space-5) var(--space-3);
}
.title { margin: 0; font-size: var(--text-17); font-weight: 600; }
.sub { margin-top: 4px; font-size: var(--text-12); color: var(--label-secondary); }
.layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 148px 1fr;
  gap: 0;
  border-top: 1px solid var(--separator);
}
.nav {
  border-right: 1px solid var(--separator);
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: color-mix(in srgb, var(--fill) 50%, transparent);
}
.nav-item {
  text-align: left;
  border-radius: var(--radius-md);
  padding: 10px 10px;
  border: 1px solid transparent;
  color: var(--label);
}
.nav-item.is-active {
  background: var(--bg-elevated);
  border-color: var(--separator);
  box-shadow: var(--focus-ring);
}
.nav-label { display: block; font-size: var(--text-13); font-weight: 600; }
.nav-desc { display: block; margin-top: 2px; font-size: var(--text-11); color: var(--label-secondary); }
.panel {
  min-height: 0;
  overflow: auto;
  padding: 12px var(--space-5) var(--space-4);
}
.group {
  margin-bottom: 16px;
  padding: 12px 14px;
  border: 1px solid var(--separator);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
}
.group-title {
  font-size: var(--text-12);
  font-weight: 600;
  color: var(--label-secondary);
  margin-bottom: 10px;
}
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.field > span { font-size: var(--text-12); color: var(--label-secondary); }
.input {
  height: 36px;
  border-radius: var(--radius-md);
  border: 1px solid var(--separator);
  background: var(--bg);
  color: var(--label);
  padding: 0 10px;
}
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
.segmented {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 4px; padding: 3px;
  background: var(--fill); border-radius: var(--radius-full);
}
.seg-item {
  height: 34px; border-radius: var(--radius-full);
  font-size: var(--text-13); color: var(--label-secondary);
}
.seg-item.is-active {
  background: var(--bg-elevated); color: var(--label); font-weight: 500;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.check {
  display: flex; align-items: flex-start; gap: 8px;
  margin-bottom: 8px; font-size: var(--text-13);
  line-height: 1.4;
}
.check em {
  font-style: normal;
  color: var(--label-secondary);
  font-size: var(--text-12);
  margin-left: 4px;
}
.hint {
  font-size: var(--text-12);
  color: var(--label-secondary);
  line-height: 1.45;
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: var(--fill);
}
.hint.ok {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 10%, transparent);
}
.foot {
  display: flex; justify-content: flex-end; align-items: center;
  gap: 8px; padding: var(--space-3) var(--space-5) var(--space-4);
  border-top: 1px solid var(--separator);
  background: var(--bg-elevated);
}
.msg { margin-right: auto; font-size: var(--text-12); color: var(--label-secondary); }
.accent-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.accent-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--separator);
  background: var(--bg);
  color: var(--label);
  font-size: var(--text-12);
}
.accent-item.is-active {
  border-color: var(--tint);
  box-shadow: 0 0 0 2px var(--tint-soft);
}
.accent-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #007aff;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.08);
}
.accent-dot[data-accent-swatch='blue'] { background: #007aff; }
.accent-dot[data-accent-swatch='purple'] { background: #af52de; }
.accent-dot[data-accent-swatch='pink'] { background: #ff2d55; }
.accent-dot[data-accent-swatch='orange'] { background: #ff9500; }
.accent-dot[data-accent-swatch='green'] { background: #34c759; }
.accent-dot[data-accent-swatch='teal'] { background: #32ade6; }
.accent-dot[data-accent-swatch='indigo'] { background: #5856d6; }
.accent-dot[data-accent-swatch='graphite'] { background: #636366; }
`;
