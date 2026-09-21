import { useState } from 'react';
import type { DownloadTask } from '@shared/types';
import { STATUS_LABELS } from '@shared/types';
import { formatEta, formatSpeed, percent } from '../utils/format';

interface Props {
  tasks: DownloadTask[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onRevealInFolder?: (task: DownloadTask) => void;
  onOpenFile?: (task: DownloadTask) => void;
}

type MenuState = { x: number; y: number; task: DownloadTask } | null;

/** P2: filename + progress; right-click completed → Explorer. */
export function TaskList({
  tasks,
  selectedId,
  onSelect,
  onOpenDetail,
  onRevealInFolder,
  onOpenFile,
}: Props) {
  const [menu, setMenu] = useState<MenuState>(null);
  const closeMenu = () => setMenu(null);

  return (
    <section className="list-shell glass-thin" onClick={closeMenu}>
      <div className="list-head">
        <span>任务</span>
        <span>进度</span>
        <span>状态</span>
      </div>
      <div className="list-body">
        {tasks.length === 0 && (
          <div className="empty">点击「添加」粘贴链接开始下载</div>
        )}
        {tasks.map((t) => {
          const pct = percent(t.doneBytes, t.totalBytes, t.status);
          return (
            <button
              key={t.id}
              type="button"
              className={`row${selectedId === t.id ? ' is-selected' : ''}`}
              onClick={() => onSelect(t.id)}
              onDoubleClick={() => onOpenDetail(t.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelect(t.id);
                setMenu({ x: e.clientX, y: e.clientY, task: t });
              }}
            >
              <div className="row-main">
                <div className="name">{t.filename}</div>
                <div className="meta mono">
                  {(t.category === 'torrent' || t.mediaKind === 'magnet') &&
                  t.status === 'downloading' &&
                  t.totalBytes <= 0
                    ? '获取磁力节点/元数据中…（若长时间无速度，资源可能无做种）'
                    : `${pct.toFixed(1)}%${t.status === 'downloading' || t.status === 'merging' ? ` · ${formatSpeed(t.speedBps)}` : ''}`}
                  {t.status === 'downloading' && t.totalBytes > 0 && t.etaSeconds != null
                    ? ` · 剩余 ${formatEta(t.etaSeconds)}`
                    : ''}
                  {t.effectiveConnections && t.effectiveConnections > 0
                    ? ` · 连接 ${t.effectiveConnections}`
                    : ''}
                </div>
              </div>
              <div className="row-progress">
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    data-done={t.status === 'completed' ? 'true' : 'false'}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <div className="cell">
                <span className="status-pill" data-status={t.status}>
                  {STATUS_LABELS[t.status] || t.status}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {menu && (
        <div
          className="ctx-menu glass-thick"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="ctx-item"
            onClick={() => {
              onOpenDetail(menu.task.id);
              closeMenu();
            }}
          >
            打开详情
          </button>
          <button
            type="button"
            className="ctx-item"
            disabled={!onRevealInFolder}
            onClick={() => {
              onRevealInFolder?.(menu.task);
              closeMenu();
            }}
          >
            在资源管理器中显示
          </button>
          <button
            type="button"
            className="ctx-item"
            disabled={!onOpenFile || menu.task.status !== 'completed'}
            onClick={() => {
              onOpenFile?.(menu.task);
              closeMenu();
            }}
          >
            打开文件
          </button>
        </div>
      )}
      <style>{`
        .list-shell {
          border-radius: var(--radius-lg);
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: hidden;
          position: relative;
        }
        .list-head {
          display: grid;
          grid-template-columns: 1fr 160px 110px;
          gap: 8px;
          padding: 10px 16px;
          font-size: var(--text-12);
          color: var(--label-secondary);
          border-bottom: 1px solid var(--separator);
        }
        .list-body { overflow: auto; padding: 8px; }
        .empty {
          padding: 48px 16px;
          text-align: center;
          color: var(--label-secondary);
          font-size: var(--text-13);
        }
        .row {
          width: 100%;
          min-height: var(--row-height);
          border-radius: var(--radius-sm);
          display: grid;
          grid-template-columns: 1fr 160px 110px;
          gap: 8px;
          align-items: center;
          padding: 8px 12px;
          text-align: left;
          transition: background 0.12s ease, box-shadow 0.12s ease;
        }
        .row:hover { background: var(--fill); }
        .row.is-selected {
          background: var(--tint-soft);
          box-shadow: inset 3px 0 0 var(--tint);
        }
        .name {
          font-size: var(--text-15);
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .meta { font-size: var(--text-12); color: var(--label-secondary); margin-top: 2px; }
        .cell { font-size: var(--text-12); color: var(--label-secondary); }
        .ctx-menu {
          position: fixed;
          z-index: 80;
          min-width: 180px;
          padding: 6px;
          border-radius: var(--radius-md);
        }
        .ctx-item {
          display: block;
          width: 100%;
          text-align: left;
          border: none;
          background: transparent;
          color: var(--label);
          font-size: var(--text-13);
          padding: 8px 10px;
          border-radius: var(--radius-sm);
          cursor: pointer;
        }
        .ctx-item:disabled { opacity: 0.4; cursor: not-allowed; }
        .ctx-item:not(:disabled):hover { background: var(--fill); }
      `}</style>
    </section>
  );
}