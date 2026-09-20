import { useState } from 'react';
import type { AboutInfo } from '@shared/ipc';

interface Props {
  about: AboutInfo;
  appName: string;
  apiToken?: string;
  onClose: () => void;
  onOpenLogs?: () => void;
}

function Row({
  label,
  value,
  mono,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="row">
      <span className="k">{label}</span>
      <span className={`v${mono ? ' mono' : ''}`} title={value}>
        {value}
      </span>
      {onCopy && (
        <button type="button" className="copy" onClick={onCopy} title="复制">
          复制
        </button>
      )}
    </div>
  );
}

export function AboutDialog({ about, appName, apiToken, onClose, onOpenLogs }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, key: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key);
        window.setTimeout(() => setCopied(null), 1200);
      },
      () => undefined,
    );
  };

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div
        className="dialog glass-thick"
        role="dialog"
        aria-modal="true"
        aria-label="关于 LocalDM"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="head">
          <div className="brand-block">
            <div className="mark" aria-hidden>
              LD
            </div>
            <div>
              <h2 className="title">{appName}</h2>
              <div className="ver mono">v{about.version}</div>
            </div>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="body">
          <section className="card">
            <div className="card-title">运行环境</div>
            <Row label="Electron" value={about.electron} mono />
            <Row label="Chromium" value={about.chrome} mono />
            <Row label="Node" value={about.node} mono />
            <Row label="平台" value={about.platform} mono />
          </section>

          <section className="card">
            <div className="card-title">本地服务</div>
            <Row label="API 端口" value={String(about.apiPort)} mono />
            <Row label="代理" value={about.httpProxy || '（直连）'} mono />
            {apiToken ? <Row label="Token" value={`${apiToken.slice(0, 4)}…`} mono /> : null}
          </section>

          <section className="card">
            <div className="card-title">路径</div>
            <Row
              label="用户数据"
              value={about.userDataDir}
              mono
              onCopy={() => copy(about.userDataDir, 'ud')}
            />
            <Row
              label="应用路径"
              value={about.appPath}
              mono
              onCopy={() => copy(about.appPath, 'app')}
            />
            {about.extensionPath && (
              <Row
                label="扩展目录"
                value={about.extensionPath}
                mono
                onCopy={() => copy(about.extensionPath || '', 'ext')}
              />
            )}
            {copied && <div className="copied">已复制</div>}
          </section>
        </div>

        <footer className="foot">
          {onOpenLogs && (
            <button type="button" className="btn-secondary" onClick={onOpenLogs}>
              日志目录
            </button>
          )}
          <button type="button" className="btn-primary" onClick={onClose}>
            关闭
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
  width: min(520px, calc(100vw - 48px));
  max-height: min(86vh, 640px);
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
.brand-block { display: flex; gap: 12px; align-items: center; }
.mark {
  width: 48px; height: 48px; border-radius: 14px;
  background: linear-gradient(145deg, var(--tint), var(--tint-strong));
  color: #fff; display: grid; place-items: center;
  font-weight: 700; font-size: 15px;
}
.title { margin: 0; font-size: var(--text-17); font-weight: 600; }
.ver { margin-top: 2px; font-size: var(--text-12); color: var(--label-secondary); }
.body {
  flex: 1;
  overflow: auto;
  padding: 0 var(--space-5) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card {
  border: 1px solid var(--separator);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  padding: 10px 12px;
}
.card-title {
  font-size: var(--text-12);
  font-weight: 600;
  color: var(--label-secondary);
  margin-bottom: 6px;
}
.row {
  display: grid;
  grid-template-columns: 72px 1fr auto;
  gap: 8px;
  align-items: center;
  min-height: 28px;
  padding: 3px 0;
}
.k { font-size: var(--text-12); color: var(--label-secondary); }
.v {
  font-size: var(--text-12);
  color: var(--label);
  word-break: break-all;
  line-height: 1.4;
}
.copy {
  border: none;
  background: var(--fill);
  color: var(--label-secondary);
  font-size: var(--text-11);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
}
.copy:hover { color: var(--label); }
.copied { margin-top: 6px; font-size: var(--text-11); color: var(--success); }
.foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: var(--space-3) var(--space-5) var(--space-5);
  border-top: 1px solid var(--separator);
  background: var(--bg-elevated);
}
`;
