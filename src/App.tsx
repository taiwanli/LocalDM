import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { TaskList } from './components/TaskList';
import { StatusBar } from './components/StatusBar';
import { TaskDetailDialog } from './components/TaskDetailDialog';
import { AddUrlDialog } from './components/AddUrlDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { AboutDialog } from './components/AboutDialog';
import { OnboardingDialog } from './components/OnboardingDialog';
import { countStatuses, filterTasks, totalSpeed } from './stores/taskStore';
import type { AppSettings, Category, DownloadTask, StatusBucket } from '@shared/types';
import { applyAccent, watchSystemTheme } from './utils/theme';
import type { BootstrapPayload } from '@shared/ipc';

export default function App() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [bucket, setBucket] = useState<StatusBucket>('all');
  const [category, setCategory] = useState<Category | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [extensionStatus, setExtensionStatus] = useState<'unknown' | 'checking' | 'ok' | 'down'>('unknown');
  const [aria2Ok, setAria2Ok] = useState(true);

  useEffect(() => {
    return watchSystemTheme(bootstrap?.settings.theme ?? 'follow', bootstrap?.settings.accent ?? 'blue');
  }, [bootstrap?.settings.theme, bootstrap?.settings.accent]);

  useEffect(() => {
    const bridge = window.localdm;
    if (!bridge) {
      setBridgeError('未连接到桌面主进程（请通过 Electron 启动）');
      return;
    }
    let disposed = false;
    void bridge
      .getBootstrap()
      .then((payload) => {
        if (disposed) return;
        setBootstrap(payload);
        if (payload.settings.onboardingDone !== true) setOnboardingOpen(true);
        setAria2Ok(payload.health?.aria2cAvailable !== false);
      })
      .catch((error: unknown) => {
        if (!disposed) setBridgeError(error instanceof Error ? error.message : String(error));
      });
    void bridge
      .listTasks()
      .then((list) => {
        if (!disposed) setTasks(list);
      })
      .catch(() => undefined);
    const offTasks = bridge.onTasksUpdated((list) => setTasks(list));
    const offMenu = bridge.onMenuAction((action) => {
      if (action === 'add-url') setAddOpen(true);
      if (action === 'settings') setSettingsOpen(true);
      if (action === 'about') setAboutOpen(true);
    });
    return () => {
      disposed = true;
      offTasks();
      offMenu();
    };
  }, []);

  useEffect(() => {
    const bridge = window.localdm;
    if (!bridge) return;
    let disposed = false;
    const tick = () => {
      setExtensionStatus('checking');
      void bridge.getExtensionStatus().then((st) => {
        if (disposed) return;
        setExtensionStatus(st?.manifestExists ? 'ok' : 'down');
      }).catch(() => {
        if (!disposed) setExtensionStatus('down');
      });
    };
    tick();
    const timer = setInterval(tick, 8000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  const counts = useMemo(() => countStatuses(tasks), [tasks]);
  const visible = useMemo(() => filterTasks(tasks, bucket, category), [tasks, bucket, category]);
  const speed = useMemo(() => totalSpeed(tasks), [tasks]);
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  const detail = tasks.find((task) => task.id === detailId) ?? null;
  const canPauseAll = useMemo(
    () =>
      tasks.some(
        (t) =>
          t.status === 'downloading' ||
          t.status === 'probing' ||
          t.status === 'merging' ||
          t.status === 'queued',
      ),
    [tasks],
  );
  const canResumeAll = useMemo(
    () =>
      tasks.some(
        (t) => t.status === 'paused' || t.status === 'failed' || t.status === 'cancelled',
      ),
    [tasks],
  );
  const canClearFailed = useMemo(() => tasks.some((t) => t.status === 'failed'), [tasks]);
  const canClearFinished = useMemo(() => tasks.some((t) => t.status === 'completed'), [tasks]);

  const refreshTasks = useCallback(async () => {
    const list = await window.localdm?.listTasks();
    if (list) setTasks(list);
  }, []);

  const handleAddUrl = useCallback(
    async (
      url: string,
      options?: {
        headers?: Record<string, string>;
        mediaQuality?: import('@shared/types').MediaQuality;
        saveDir?: string;
        startPaused?: boolean;
      },
    ) => {
      const bridge = window.localdm;
      if (!bridge) return;
      try {
        await bridge.addTaskUrl(url, options);
        await refreshTasks();
        setAddOpen(false);
        if (bootstrap && bootstrap.settings.onboardingDone !== true) {
          await bridge.saveSettings({ onboardingDone: true });
          setBootstrap((prev) =>
            prev ? { ...prev, settings: { ...prev.settings, onboardingDone: true } } : prev,
          );
          setOnboardingOpen(false);
        }
      } catch (error) {
        setBridgeError(error instanceof Error ? error.message : String(error));
      }
    },
    [refreshTasks, bootstrap],
  );

  const handleSaveSettings = useCallback(
    async (partial: Partial<AppSettings>) => {
      const bridge = window.localdm;
      if (!bridge) throw new Error('桌面桥未就绪');
      const next = await bridge.saveSettings(partial);
      applyAccent(next.accent || 'blue');
      setBootstrap((prev) => (prev ? { ...prev, settings: next } : prev));
      await refreshTasks();
    },
    [refreshTasks],
  );

  return (
    <div className="app-shell">
      <Toolbar
        onAdd={() => setAddOpen(true)}
        onPause={() => {
          if (selected) void window.localdm?.pauseTask(selected.id);
        }}
        onResume={() => {
          if (selected) void window.localdm?.resumeTask(selected.id);
        }}
        onPauseAll={() => {
          void window.localdm?.pauseAllTasks().then(() => refreshTasks());
        }}
        onResumeAll={() => {
          void window.localdm?.resumeAllTasks().then(() => refreshTasks());
        }}
        onClearFinished={() => {
          void window.localdm?.clearFinishedTasks().then(() => refreshTasks());
        }}
        onClearFailed={() => {
          void window.localdm?.clearFailedTasks().then(() => refreshTasks());
        }}
        onDeleteSelected={() => {
          if (!selected) return;
          void window.localdm?.removeTask(selected.id, false).then(() => refreshTasks());
        }}
        canPause={
          !!selected &&
          (selected.status === 'downloading' ||
            selected.status === 'probing' ||
            selected.status === 'merging')
        }
        canResume={
          !!selected &&
          (selected.status === 'paused' ||
            selected.status === 'failed' ||
            selected.status === 'queued' ||
            selected.status === 'cancelled')
        }
        canDelete={!!selected}
        canPauseAll={canPauseAll}
        canResumeAll={canResumeAll}
        canClearFailed={canClearFailed}
        canClearFinished={canClearFinished}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
      />
      <div className="app-body">
        <Sidebar
          bucket={bucket}
          category={category}
          counts={counts}
          onBucket={setBucket}
          onCategory={setCategory}
        />
        <TaskList
          tasks={visible}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpenDetail={setDetailId}
          onRevealInFolder={(task) => {
            void window.localdm?.showItemInFolder(task.savePath);
          }}
          onOpenFile={(task) => {
            void window.localdm?.openPath(task.savePath);
          }}
        />
      </div>
      <StatusBar
        taskCount={visible.length}
        totalSpeed={speed}
        extensionStatus={extensionStatus}
        downloadMode={bootstrap?.settings.downloadMode || 'adaptive'}
        onOpenAbout={() => setAboutOpen(true)}
        downloadDir={
          bootstrap
            ? `${bootstrap.settings.downloadDir} · 队列 ${bootstrap.settings.maxConcurrentTasks} · 连接 ${bootstrap.settings.maxConnections}`
            : bridgeError || '（未连接桌面端）'
        }
      />
      {detail && (
        <TaskDetailDialog
          task={detail}
          onClose={() => setDetailId(null)}
          onPause={() => void window.localdm?.pauseTask(detail.id)}
          onCancel={() => void window.localdm?.cancelTask(detail.id)}
          onSetSpeedLimit={async (taskId, limitBps) => {
            const bridge = window.localdm;
            if (!bridge) throw new Error('桌面桥未就绪');
            await bridge.setTaskSpeedLimit(taskId, limitBps);
            await refreshTasks();
          }}
          onSetMediaQuality={async (taskId, quality) => {
            const bridge = window.localdm;
            if (!bridge) throw new Error('桌面桥未就绪');
            await bridge.setTaskMediaQuality(taskId, quality);
            await refreshTasks();
          }}
          onOpenFile={(task) => {
            void window.localdm?.openPath(task.savePath);
          }}
          onOpenFolder={(task) => {
            void window.localdm?.showItemInFolder(task.savePath);
          }}
          onResume={(task) => {
            void window.localdm?.resumeTask(task.id).then(() => refreshTasks());
          }}
          onCopyError={(text) => {
            void window.localdm?.copyText(text);
          }}
          onOpenTaskLog={(task) => {
            const dir = bootstrap?.about.userDataDir;
            if (dir) void window.localdm?.openPath(`${dir}\\logs\\tasks\\${task.id}.log`);
          }}
        />
      )}
      {addOpen && (
        <AddUrlDialog
          askVideoQuality={bootstrap?.settings.askVideoQuality}
          defaultSaveDir={bootstrap?.settings.downloadDir}
          aria2Available={aria2Ok}
          onClose={() => setAddOpen(false)}
          onSubmit={(url, options) => void handleAddUrl(url, options)}
          onProbeFormats={(url) => window.localdm?.probeMediaFormats(url) ?? Promise.resolve(null)}
          onChooseDirectory={() => window.localdm?.chooseDirectory() ?? Promise.resolve(null)}
        />
      )}
      {settingsOpen && bootstrap && (
        <SettingsDialog
          settings={bootstrap.settings}
          extensionConnected={extensionStatus === 'ok'}
          extensionHint={bootstrap.about?.extensionPath}
          onOpenLogs={() => {
            void window.localdm?.openPath(`${bootstrap.about.userDataDir}\\logs`);
          }}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      )}
      {aboutOpen && bootstrap && (
        <AboutDialog
          about={bootstrap.about}
          appName={bootstrap.appName}
          apiToken={bootstrap.apiToken}
          onOpenLogs={() => {
            void window.localdm?.openPath(`${bootstrap.about.userDataDir}\\logs`);
          }}
          onClose={() => setAboutOpen(false)}
        />
      )}
      {onboardingOpen && bootstrap && (
        <OnboardingDialog
          downloadDir={bootstrap.settings.downloadDir}
          extensionPath={bootstrap.about?.extensionPath}
          onOpenAdd={() => {
            setOnboardingOpen(false);
            setAddOpen(true);
          }}
          onOpenSettings={() => {
            setOnboardingOpen(false);
            setSettingsOpen(true);
          }}
          onDismiss={() => {
            setOnboardingOpen(false);
            void window.localdm?.saveSettings({ onboardingDone: true }).then((s) => {
              setBootstrap((prev) => (prev ? { ...prev, settings: s } : prev));
            });
          }}
        />
      )}
      <style>{appCss}</style>
    </div>
  );
}

const appCss = `
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0;
  background: var(--bg);
}
.app-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  gap: var(--space-3);
  padding: 0 var(--space-3) var(--space-3);
}
`;
