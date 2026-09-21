import { useEffect, useState } from 'react';
import type { DownloadTask, MediaQuality } from '@shared/types';
import { MEDIA_QUALITY_LABELS, STATUS_LABELS } from '@shared/types';
import { friendlyTaskError, taskLogHint } from '@shared/errorMessages';
import { formatBytes, formatEta, formatSpeed, percent } from '../utils/format';

interface Props {
  task: DownloadTask;
  onClose: () => void;
  onPause: () => void;
  onCancel: () => void;
  onResume?: (task: DownloadTask) => void;
  onSetSpeedLimit?: (taskId: string, limitBps: number) => Promise<unknown> | void;
  onSetMediaQuality?: (taskId: string, quality: MediaQuality) => Promise<unknown> | void;
  onOpenFile?: (task: DownloadTask) => void;
  onOpenFolder?: (task: DownloadTask) => void;
  onCopyError?: (text: string) => void;
  onOpenTaskLog?: (task: DownloadTask) => void;
}

type Tab = 'status' | 'limit' | 'complete';

export function TaskDetailDialog({
  task,
  onClose,
  onPause,
  onCancel,
  onResume,
  onSetSpeedLimit,
  onSetMediaQuality,
  onOpenFile,
  onOpenFolder,
  onCopyError,
  onOpenTaskLog,
}: Props) {
  const [tab, setTab] = useState<Tab>('status');
  const [limitDraft, setLimitDraft] = useState(String(task.speedLimitBps ?? 0));
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [limitSaving, setLimitSaving] = useState(false);
  const [qualityDraft, setQualityDraft] = useState<MediaQuality>(task.mediaQuality || 'best');
  const [qualityMsg, setQualityMsg] = useState<string | null>(null);
  const isMedia =
    task.mediaKind === 'video-platform' ||
    task.mediaKind === 'sniffed-media' ||
    task.mediaKind === 'torrent' ||
    task.mediaKind === 'magnet' ||
    /\.(m3u8|mpd)(\?|$)/i.test(task.url);
  const pct = percent(task.doneBytes, task.totalBytes, task.status);

  useEffect(() => {
    setLimitDraft(String(task.speedLimitBps ?? 0));
  }, [task.speedLimitBps, task.id]);

  useEffect(() => {
    setQualityDraft(task.mediaQuality || 'best');
  }, [task.mediaQuality, task.id]);
  let host = '';
  try {
    host = new URL(task.url).host;
  } catch {
    host = task.url;
  }

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div
        className="dialog glass-thick"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dlg-head">
          <div className="title">
            LocalDM · ({host}) {pct.toFixed(0)}% {task.filename}
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="url mono">{task.url}</div>

        <div className="segmented" role="tablist">
          {(
            [
              ['status', '下载状态'],
              ['limit', '速度限制'],
              ['complete', '下载完成选项'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`seg-item${tab === id ? ' is-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'status' && (
          <div className="panel">
            <div className="field">
              <span className="k">任务类型</span>
              <span className="v">
                {task.mediaKind === 'video-platform'
                  ? '平台视频（yt-dlp）'
                  : task.mediaKind === 'sniffed-media'
                    ? '嗅探媒体（yt-dlp/Range）'
                    : task.mediaKind === 'magnet'
                      ? '磁力链接（BT/aria2c）'
                      : task.mediaKind === 'torrent'
                        ? '种子任务（BT/aria2c）'
                        : 'HTTP 直链（Range）'}
              </span>
            </div>
            <div className="field">
              <span className="k">下载状态</span>
              <span className="v tint">{STATUS_LABELS[task.status]}</span>
              {task.effectiveConnections && task.effectiveConnections > 0 ? (
                <span className="v mono" style={{ marginLeft: 8 }}>
                  有效连接 {task.effectiveConnections}
                </span>
              ) : null}
            </div>
            {task.error || task.status === 'failed' ? (
              <div className="err-box">
                <div className="err-title">提示</div>
                <div className="err-msg">{friendlyTaskError(task.error)}</div>
                <div className="hint">
                  {onOpenTaskLog ? (
                    <button type="button" className="log-link" onClick={() => onOpenTaskLog(task)}>
                      查看任务日志
                    </button>
                  ) : (
                    <span className="mono">{taskLogHint(task.id)}</span>
                  )}
                </div>
                {task.error && (
                  <div className="hint mono raw" title={task.error}>
                    原始：{task.error}
                  </div>
                )}
                <div className="err-actions">
                  {onResume && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => onResume(task)}
                    >
                      重试
                    </button>
                  )}
                  {onOpenFolder && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => onOpenFolder(task)}
                    >
                      打开所在文件夹
                    </button>
                  )}
                  {onCopyError && task.error && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        onCopyError(
                          `${friendlyTaskError(task.error)}\n${task.error}\n${taskLogHint(task.id)}`,
                        )
                      }
                    >
                      复制错误信息
                    </button>
                  )}
                </div>
              </div>
            ) : null}
            <div className="grid">
              <div>
                <span className="k">文件大小</span>
                <span className="v mono">{formatBytes(task.totalBytes)}</span>
              </div>
              <div>
                <span className="k">已经下载</span>
                <span className="v mono">
                  {formatBytes(task.doneBytes)} ({pct.toFixed(2)} %)
                </span>
              </div>
              <div>
                <span className="k">传输速度</span>
                <span className="v mono">{formatSpeed(task.speedBps)}</span>
              </div>
              <div>
                <span className="k">剩余时间</span>
                <span className="v mono">{formatEta(task.etaSeconds)}</span>
              </div>
              <div>
                <span className="k">能否续传</span>
                <span className="v">{task.canResume ? '能够' : '不能'}</span>
              </div>
            </div>

            <div className="threads">
              <div className="progress-track total">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="seg-label">各线程的起始位置以及下载进度</div>
              <div className="seg-bars">
                {(task.segments.length ? task.segments : [{ start: 0, end: 0, done: task.doneBytes }]).map(
                  (s, i) => {
                    const span = Math.max(1, s.end - s.start);
                    const p = Math.min(100, (s.done / span) * 100);
                    return (
                      <div key={i} className="seg-bar" title={`#${i + 1}`}>
                        <div
                          className="seg-fill"
                          style={{
                            width: `${p}%`,
                            opacity: 0.35 + (i % 4) * 0.2,
                          }}
                        />
                      </div>
                    );
                  },
                )}
              </div>
              <table className="thread-table">
                <thead>
                  <tr>
                    <th>N.</th>
                    <th>已经下载</th>
                    <th>信息</th>
                  </tr>
                </thead>
                <tbody>
                  {(task.segments.length ? task.segments : [{ start: 0, end: task.totalBytes, done: task.doneBytes }]).map(
                    (s, i) => (
                      <tr key={i}>
                        <td className="mono">{i + 1}</td>
                        <td className="mono">{formatBytes(s.done)}</td>
                        <td>{task.status === 'downloading' ? STATUS_LABELS.downloading : STATUS_LABELS[task.status]}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'limit' && (
          <div className="panel">
            <div className="field">
              <span className="k">当前限速</span>
              <span className="v mono">
                {task.speedLimitBps && task.speedLimitBps > 0
                  ? `${formatSpeed(task.speedLimitBps)}（仅本任务）`
                  : '不限'}
              </span>
            </div>
            <div className="field">
              <span className="k">全局限速</span>
              <span className="v mono">见「设置」（与本任务限速同时生效，取更严）</span>
            </div>
            <label className="limit-label" htmlFor="task-limit">
              本任务限速 (B/s，0 = 不限)
            </label>
            <div className="limit-row">
              <input
                id="task-limit"
                className="limit-input mono"
                type="number"
                min={0}
                value={limitDraft}
                onChange={(event) => {
                  setLimitDraft(event.target.value);
                  setLimitMsg(null);
                }}
              />
              <button
                type="button"
                className="btn-primary"
                disabled={limitSaving || !onSetSpeedLimit}
                onClick={() => {
                  if (!onSetSpeedLimit) return;
                  const next = Number(limitDraft);
                  if (!Number.isFinite(next) || next < 0) {
                    setLimitMsg('请输入不小于 0 的数字');
                    return;
                  }
                  setLimitSaving(true);
                  setLimitMsg(null);
                  Promise.resolve(onSetSpeedLimit(task.id, Math.floor(next)))
                    .then(() =>
                      setLimitMsg(
                        isMedia
                          ? '已保存；yt-dlp 任务在下次开始/继续时生效'
                          : '已应用',
                      ),
                    )
                    .catch((error: unknown) => {
                      setLimitMsg(error instanceof Error ? error.message : String(error));
                    })
                    .finally(() => setLimitSaving(false));
                }}
              >
                {limitSaving ? '应用中…' : '应用'}
              </button>
            </div>
            <div className="limit-hint">
              示例：2097152 = 2 MB/s。Range 下载立即生效；yt-dlp 使用 --limit-rate，在下次启动时应用。
            </div>
            {limitMsg && <div className="limit-msg">{limitMsg}</div>}

            {isMedia && (
              <div className="quality-block">
                <div className="field" style={{ marginTop: 16 }}>
                  <span className="k">清晰度（yt-dlp）</span>
                  <span className="v">
                    {MEDIA_QUALITY_LABELS[task.mediaQuality || 'best']}
                    {task.mediaQuality ? '' : '（默认）'}
                  </span>
                </div>
                <label className="limit-label" htmlFor="task-quality">
                  选择清晰度
                </label>
                <div className="limit-row">
                  <select
                    id="task-quality"
                    className="limit-input"
                    value={qualityDraft}
                    onChange={(event) => {
                      setQualityDraft(event.target.value as MediaQuality);
                      setQualityMsg(null);
                    }}
                  >
                    {(Object.keys(MEDIA_QUALITY_LABELS) as MediaQuality[]).map((key) => (
                      <option key={key} value={key}>
                        {MEDIA_QUALITY_LABELS[key]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!onSetMediaQuality}
                    onClick={() => {
                      if (!onSetMediaQuality) return;
                      Promise.resolve(onSetMediaQuality(task.id, qualityDraft))
                        .then(() => setQualityMsg('已保存；下次开始/继续时生效'))
                        .catch((error: unknown) => {
                          setQualityMsg(error instanceof Error ? error.message : String(error));
                        });
                    }}
                  >
                    应用
                  </button>
                </div>
                {qualityMsg && <div className="limit-msg">{qualityMsg}</div>}
              </div>
            )}
          </div>
        )}
        {tab === 'complete' && (
          <div className="panel muted">
            完成后行为使用全局设置：「完成后打开所在文件夹」「下载完成后通知」（设置页）。
            <div className="limit-hint mono" style={{ marginTop: 8 }}>
              目录：{task.savePath}
            </div>
            <div className="limit-hint mono">
              任务日志：logs/tasks/{task.id}.log（UserData/LocalDM 下）
            </div>
            <div className="limit-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={task.status !== 'completed' || !onOpenFile}
                onClick={() => onOpenFile?.(task)}
              >
                打开文件
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!onOpenFolder}
                onClick={() => onOpenFolder?.(task)}
              >
                打开所在文件夹
              </button>
            </div>
          </div>
        )}

        <footer className="dlg-foot">
          <button type="button" className="btn-secondary" onClick={onPause}>
            暂停
          </button>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            取消
          </button>
        </footer>
      </div>
      <style>{`
        .overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.28);
          display: grid; place-items: center;
          z-index: 40;
        }
        .dialog {
          width: min(640px, calc(100vw - 48px));
          max-height: min(80vh, 720px);
          overflow: auto;
          border-radius: var(--radius-xl);
          padding: var(--space-5);
        }
        .dlg-head { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
        .title { font-size: var(--text-17); font-weight: 600; }
        .url { margin-top: 8px; font-size: var(--text-12); color: var(--label-secondary); word-break: break-all; user-select: text; }
        .segmented {
          margin-top: 16px;
          display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 4px; padding: 3px;
          background: var(--fill); border-radius: var(--radius-full);
        }
        .seg-item {
          height: 32px; border-radius: var(--radius-full);
          font-size: var(--text-13); color: var(--label-secondary);
        }
        .seg-item.is-active {
          background: var(--bg-elevated); color: var(--label); font-weight: 500;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .panel { margin-top: 16px; }
        .muted { color: var(--label-secondary); font-size: var(--text-13); }
        .field { display: flex; gap: 12px; align-items: baseline; margin-bottom: 12px; }
        .k { font-size: var(--text-13); color: var(--label-secondary); min-width: 72px; }
        .v { font-size: var(--text-15); font-weight: 500; }
        .v.tint { color: var(--tint); }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin-bottom: 16px; }
        .grid .k { display: block; margin-bottom: 2px; }
        .err-box {
          margin: 0 0 14px;
          padding: 10px 12px;
          border-radius: var(--radius-md);
          background: color-mix(in srgb, var(--error) 8%, transparent);
          border: 1px solid color-mix(in srgb, var(--error) 25%, transparent);
        }
        .err-title { font-size: var(--text-12); font-weight: 600; color: var(--error); margin-bottom: 4px; }
        .err-msg { font-size: var(--text-13); color: var(--label); line-height: 1.45; }
        .err-box .hint { margin-top: 6px; font-size: var(--text-11); color: var(--label-secondary); }
        .err-box .raw { opacity: 0.85; word-break: break-all; }
        .err-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        .log-link {
          border: none;
          background: none;
          color: var(--tint);
          cursor: pointer;
          padding: 0;
          font-size: inherit;
          text-decoration: underline;
        }
        .threads { border-top: 1px solid var(--separator); padding-top: 14px; }
        .total { height: 6px; }
        .seg-label { margin: 10px 0 6px; font-size: var(--text-12); color: var(--label-secondary); }
        .seg-bars { display: grid; gap: 4px; margin-bottom: 12px; }
        .seg-bar { height: 6px; border-radius: var(--radius-full); background: var(--separator); overflow: hidden; }
        .seg-fill { height: 100%; background: var(--tint); border-radius: var(--radius-full); }
        .thread-table { width: 100%; border-collapse: collapse; font-size: var(--text-12); }
        .thread-table th { text-align: left; color: var(--label-secondary); font-weight: 400; padding: 4px 0; }
        .thread-table td { padding: 4px 0; border-top: 1px solid var(--separator); }
        .dlg-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
      `}</style>
    </div>
  );
}
