/** Slim brand strip only — window controls come from the OS frame. */
export function TitleBar() {
  return (
    <header className="titlebar glass-thick">
      <div className="brand">
        <span className="brand-name">LocalDM</span>
        <span className="brand-dot" aria-hidden />
        <span className="brand-status">就绪</span>
      </div>
      <style>{`
        .titlebar {
          height: var(--titlebar-height);
          margin: var(--space-2) var(--space-3) var(--space-2);
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 var(--space-4);
          -webkit-app-region: drag;
        }
        .titlebar > * { -webkit-app-region: no-drag; }
        .brand { display: flex; align-items: center; gap: 8px; }
        .brand-name { font-weight: 600; font-size: var(--text-13); }
        .brand-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); }
        .brand-status { font-size: var(--text-12); color: var(--label-secondary); }
      `}</style>
    </header>
  );
}
