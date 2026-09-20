import { useState } from 'react';
import { parseHeadersText } from '@shared/url';
import { normalizeDownloadUrl, isYtDlpUrl, isM3u8Url } from '@shared/media';
import { MEDIA_QUALITY_LABELS } from '@shared/types';
import type { MediaQuality } from '@shared/types';

interface Props {
  askVideoQuality?: boolean;
  defaultSaveDir?: string;
  aria2Available?: boolean;
  onClose: () => void;
  onSubmit: (
    url: string,
    options?: {
      headers?: Record<string, string>;
      mediaQuality?: MediaQuality;
      saveDir?: string;
      startPaused?: boolean;
    },
  ) => void;
  onProbeFormats?: (url: string) => Promise<{
    title: string;
    formats: Array<{ formatId: string; note: string; height?: number }>;
  } | null>;
  onChooseDirectory?: () => Promise<string | null>;
}

/** P0: URL + one primary action; advanced options collapsed. */
export function AddUrlDialog({
  askVideoQuality,
  defaultSaveDir,
  aria2Available = true,
  onClose,
  onSubmit,
  onProbeFormats,
  onChooseDirectory,
}: Props) {
  const [url, setUrl] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [quality, setQuality] = useState<MediaQuality>('best');
  const [probing, setProbing] = useState(false);
  const [probeInfo, setProbeInfo] = useState<string | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [saveDir, setSaveDir] = useState(defaultSaveDir || '');
  const [startPaused, setStartPaused] = useState(false);

  const normalized = normalizeDownloadUrl(url.trim());
  const isPlatform = isYtDlpUrl(normalized);
  const isHls = isM3u8Url(normalized);
  const isMagnet = /^magnet:\?/i.test(normalized);
  const canSubmit = /^(https?):\/\//i.test(normalized) || isMagnet;

  const engineHint = isMagnet
    ? aria2Available
      ? '将使用 BT（aria2）'
      : '磁力链接：未检测到 aria2c，请先在设置配置路径或放置 resources/bin/aria2c.exe'
    : isPlatform
      ? '将使用 yt-dlp 下载平台视频'
      : isHls
        ? '将使用 HLS 下载'
        : canSubmit
          ? '将使用 Range 多线程下载'
          : '粘贴 http(s) 或 magnet 链接';

  const submit = () => {
    const headers = parseHeadersText(headersText);
    onSubmit(normalized, {
      headers: Object.keys(headers).length ? headers : undefined,
      mediaQuality: advanced && (isPlatform || isHls) ? quality : undefined,
      saveDir: advanced ? saveDir.trim() || undefined : undefined,
      startPaused: advanced ? startPaused : false,
    });
  };

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div
        className="dialog glass-thick"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="title">添加下载</h2>
        <input
          className="input"
          placeholder="粘贴下载链接或磁力链接"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) submit();
          }}
          autoFocus
          spellCheck={false}
        />
        <div className="hint">{engineHint}</div>
        {url.trim() && normalized && normalized !== url.trim() && !isMagnet && (
          <div className="hint mono">将使用：{normalized}</div>
        )}

        <button
          type="button"
          className="toggle"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? '收起高级选项' : '高级选项（可选）'}
        </button>

        {advanced && (
          <div className="advanced">
            {(isPlatform || isHls) && (
              <label className="field">
                <span>清晰度</span>
                <select
                  className="input"
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as MediaQuality)}
                >
                  {(Object.keys(MEDIA_QUALITY_LABELS) as MediaQuality[]).map((key) => (
                    <option key={key} value={key}>
                      {MEDIA_QUALITY_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {askVideoQuality && isPlatform && onProbeFormats && (
              <button
                type="button"
                className="toggle"
                disabled={probing || !canSubmit}
                onClick={() => {
                  setProbing(true);
                  setProbeError(null);
                  setProbeInfo(null);
                  void onProbeFormats(normalized)
                    .then((info) => {
                      if (!info) {
                        setProbeInfo('无法解析格式');
                        return;
                      }
                      const top = info.formats
                        .filter((f) => f.height)
                        .slice(0, 4)
                        .map((f) => `${f.height}p`)
                        .join(' · ');
                      setProbeInfo(`${info.title}${top ? ` · ${top}` : ''}`);
                    })
                    .catch((err: unknown) => {
                      setProbeError(err instanceof Error ? err.message : String(err));
                    })
                    .finally(() => setProbing(false));
                }}
              >
                {probing ? '解析中…' : '探测可选格式'}
              </button>
            )}
            {probeInfo && <div className="hint">{probeInfo}</div>}
            {probeError && <div className="hint err">{probeError}</div>}
            <label className="field">
              <span>保存目录（留空＝按分类归档）</span>
              <div className="dir-row">
                <input
                  className="input mono"
                  value={saveDir}
                  onChange={(e) => setSaveDir(e.target.value)}
                  placeholder={defaultSaveDir || '默认'}
                  spellCheck={false}
                />
                {onChooseDirectory && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      void onChooseDirectory().then((dir) => {
                        if (dir) setSaveDir(dir);
                      });
                    }}
                  >
                    浏览…
                  </button>
                )}
              </div>
            </label>
            <label className="field">
              <span>请求头 Cookie / Authorization（可选）</span>
              <textarea
                className="headers"
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder="Cookie: …"
              />
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                checked={startPaused}
                onChange={(e) => setStartPaused(e.target.checked)}
              />
              <span>暂停开始（入队后不自动下载）</span>
            </label>
          </div>
        )}

        <footer className="foot">
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn-primary" disabled={!canSubmit} onClick={submit}>
            添加并下载
          </button>
        </footer>
      </div>
      <style>{`
        .overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.28);
          display: grid; place-items: center; z-index: 50;
        }
        .dialog {
          width: min(480px, calc(100vw - 48px));
          border-radius: var(--radius-xl);
          padding: var(--space-6);
        }
        .title { margin: 0 0 14px; font-size: var(--text-17); font-weight: 600; }
        .input, .headers {
          width: 100%; border-radius: var(--radius-md);
          border: 1px solid var(--separator); background: var(--bg-elevated);
          padding: 0 12px; color: var(--label); box-sizing: border-box;
        }
        .input { height: 40px; }
        .headers { padding: 8px 12px; font-family: inherit; resize: vertical; margin-top: 6px; }
        .input:focus, .headers:focus { outline: 2px solid var(--tint); outline-offset: 1px; }
        .hint { margin-top: 8px; font-size: var(--text-12); color: var(--label-secondary); }
        .hint.err { color: var(--error); }
        .toggle {
          margin-top: 10px; border: none; background: transparent;
          color: var(--tint); font-size: var(--text-12); cursor: pointer; padding: 0;
        }
        .advanced { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        .field > span { font-size: var(--text-12); color: var(--label-secondary); }
        .dir-row { display: flex; gap: 8px; align-items: center; }
        .dir-row .input { flex: 1; }
        .check-line { display: flex; align-items: center; gap: 8px; font-size: var(--text-13); }
        .foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
      `}</style>
    </div>
  );
}
