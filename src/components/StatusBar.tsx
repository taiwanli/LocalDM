import { formatSpeed } from '../utils/format';

export type ExtensionStatus = 'unknown' | 'checking' | 'ok' | 'down';

interface Props {
  taskCount: number;
  totalSpeed: number;
  downloadDir: string;
  extensionStatus?: ExtensionStatus;
  onOpenAbout?: () => void;
}

const EXT_LABEL: Record<ExtensionStatus, string> = {
  unknown: '扩展：检测中',
  checking: '扩展：检测中',
  ok: '扩展：已连接',
  down: '扩展：未连接',
};

export function StatusBar({
  taskCount,
  totalSpeed,
  downloadDir,
  extensionStatus = 'unknown',
  onOpenAbout,
}: Props) {
  return (
    <footer className="statusbar glass-thin">
      <span>
        {taskCount} 个任务 · 总速度{' '}
        <span className="mono">{formatSpeed(totalSpeed)}</span>
        {' '}· Range 自适应
      </span>
      <button
        type="button"
        className={`ext-pill ext-${extensionStatus}`}
        title={extensionStatus === 'down' ? '点击查看如何加载扩展' : '浏览器扩展连通状态'}
        onClick={() => {
          if (extensionStatus === 'down') onOpenAbout?.();
        }}
      >
        {EXT_LABEL[extensionStatus]}
      </button>
      <span className="dir mono">{downloadDir}</span>
      <style>{`
        .statusbar {
          margin: 0 var(--space-3) var(--space-3);
          border-radius: var(--radius-md);
          min-height: var(--statusbar-height);
          display: flex;
          align-items: center;
          gap: 10px;
          justify-content: space-between;
          padding: 0 var(--space-4);
          font-size: var(--text-12);
          color: var(--label-secondary);
        }
        .dir { max-width: 36%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ext-pill {
          flex-shrink: 0;
          border: 1px solid var(--separator);
          border-radius: var(--radius-full);
          padding: 2px 10px;
          font-size: var(--text-12);
          background: var(--fill);
          color: var(--label-secondary);
        }
        .ext-pill.ext-ok {
          border-color: color-mix(in srgb, var(--success) 40%, transparent);
          color: var(--success);
          background: color-mix(in srgb, var(--success) 12%, transparent);
        }
        .ext-pill.ext-down {
          border-color: color-mix(in srgb, var(--warning) 45%, transparent);
          color: var(--warning);
          background: color-mix(in srgb, var(--warning) 12%, transparent);
          cursor: pointer;
        }
      `}</style>
    </footer>
  );
}
