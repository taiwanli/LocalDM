interface Props {
  onAdd: () => void;
  onPause: () => void;
  onResume: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onClearFinished: () => void;
  onClearFailed: () => void;
  onDeleteSelected: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  canPause: boolean;
  canResume: boolean;
  canDelete: boolean;
  canPauseAll: boolean;
  canResumeAll: boolean;
  canClearFailed: boolean;
  canClearFinished: boolean;
}

/** Grouped primary actions: add · single · batch · cleanup · about/settings. */
export function Toolbar({
  onAdd,
  onPause,
  onResume,
  onPauseAll,
  onResumeAll,
  onClearFinished,
  onClearFailed,
  onDeleteSelected,
  onOpenSettings,
  onOpenAbout,
  canPause,
  canResume,
  canDelete,
  canPauseAll,
  canResumeAll,
  canClearFailed,
  canClearFinished,
}: Props) {
  return (
    <div className="toolbar glass-thick">
      <div className="toolbar-group">
        <button type="button" className="btn-primary" onClick={onAdd}>
          添加
        </button>
      </div>
      <div className="toolbar-divider" aria-hidden="true" />
      <div className="toolbar-group">
        <button type="button" className="btn-secondary" onClick={onPause} disabled={!canPause}>
          暂停
        </button>
        <button type="button" className="btn-secondary" onClick={onResume} disabled={!canResume}>
          继续
        </button>
      </div>
      <div className="toolbar-divider" aria-hidden="true" />
      <div className="toolbar-group">
        <button
          type="button"
          className="btn-secondary"
          onClick={onPauseAll}
          disabled={!canPauseAll}
        >
          全部暂停
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onResumeAll}
          disabled={!canResumeAll}
        >
          全部恢复
        </button>
      </div>
      <div className="toolbar-divider" aria-hidden="true" />
      <div className="toolbar-group">
        <button
          type="button"
          className="btn-ghost"
          disabled={!canDelete}
          onClick={onDeleteSelected}
        >
          删除选中
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={onClearFinished}
          disabled={!canClearFinished}
        >
          清空已完成
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={onClearFailed}
          disabled={!canClearFailed}
        >
          清空失败
        </button>
      </div>
      <div className="spacer" />
      <div className="toolbar-group">
        <button type="button" className="btn-ghost" onClick={onOpenAbout}>
          关于
        </button>
        <button type="button" className="btn-ghost" onClick={onOpenSettings}>
          设置
        </button>
      </div>
      <style>{`
        .toolbar {
          margin: 0 var(--space-3) var(--space-3);
          border-radius: var(--radius-lg);
          min-height: var(--toolbar-height);
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: 0 var(--space-3);
          flex-wrap: wrap;
        }
        .toolbar-group {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .toolbar-divider {
          width: 1px;
          height: 16px;
          flex-shrink: 0;
          border-radius: 1px;
          background: var(--separator);
          opacity: 0.75;
        }
        .spacer { flex: 1; min-width: var(--space-2); }
      `}</style>
    </div>
  );
}
