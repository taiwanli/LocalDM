interface Props {
  downloadDir: string;
  extensionPath?: string;
  onOpenAdd: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}

/** First-run card: download dir + one primary action; everything else later. */
export function OnboardingDialog({
  downloadDir,
  extensionPath,
  onOpenAdd,
  onOpenSettings,
  onDismiss,
}: Props) {
  return (
    <div className="overlay" role="presentation">
      <div className="dialog glass-thick" role="dialog" aria-modal="true" aria-label="欢迎使用 LocalDM">
        <h2 className="title">欢迎使用 LocalDM</h2>
        <p className="lead">
          默认已按「Range + 限流自适应」就绪。粘贴一条下载链接即可开始。
        </p>
        <div className="dir">
          <span className="k">默认下载目录</span>
          <span className="v mono">{downloadDir}</span>
        </div>
        <div className="tips">
          <div>· 浏览器扩展（可选）：设置/关于里查看目录，Chrome → 开发者模式 → 加载已解压扩展</div>
          {extensionPath ? <div className="mono path">当前扩展目录：{extensionPath}</div> : null}
          <div>· 更多选项（代理、BT、托管等）可稍后在「设置」中配置</div>
        </div>
        <footer className="foot">
          <button type="button" className="btn-secondary" onClick={onOpenSettings}>
            打开设置
          </button>
          <button type="button" className="btn-secondary" onClick={onDismiss}>
            先逛逛
          </button>
          <button type="button" className="btn-primary" onClick={onOpenAdd}>
            添加链接开始下载
          </button>
        </footer>
      </div>
      <style>{`
        .overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.32);
          display: grid; place-items: center; z-index: 70;
        }
        .dialog {
          width: min(520px, calc(100vw - 48px));
          border-radius: var(--radius-xl);
          padding: var(--space-5);
        }
        .title { margin: 0 0 8px; font-size: var(--text-17); font-weight: 600; }
        .lead { margin: 0 0 14px; font-size: var(--text-13); color: var(--label-secondary); line-height: 1.45; }
        .dir {
          display: grid; gap: 4px; margin-bottom: 12px;
          padding: 10px 12px; border-radius: var(--radius-md);
          background: var(--fill);
        }
        .dir .k { font-size: var(--text-12); color: var(--label-secondary); }
        .dir .v { font-size: var(--text-12); word-break: break-all; }
        .tips { font-size: var(--text-12); color: var(--label-secondary); line-height: 1.5; }
        .tips .path { margin-top: 4px; word-break: break-all; }
        .foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
      `}</style>
    </div>
  );
}
