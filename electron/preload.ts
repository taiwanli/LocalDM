import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, DownloadTask, MediaQuality } from '../shared/types';
import type { BootstrapPayload, LocalDmBridge, MenuAction } from '../shared/ipc';

const api: LocalDmBridge = {
  getBootstrap: () => ipcRenderer.invoke('app:getBootstrap') as Promise<BootstrapPayload>,
  saveSettings: (partial: Partial<AppSettings>) =>
    ipcRenderer.invoke('app:saveSettings', partial) as Promise<AppSettings>,
  getTheme: () => ipcRenderer.invoke('app:getTheme') as Promise<AppSettings['theme']>,
  getExtensionStatus: () =>
    ipcRenderer.invoke('app:getExtensionStatus') as Promise<{
      extensionDir: string | null;
      manifestExists: boolean;
    }>,
  copyText: (text: string) => ipcRenderer.invoke('app:copyText', text) as Promise<boolean>,
  listTasks: () => ipcRenderer.invoke('tasks:list') as Promise<DownloadTask[]>,
  addTaskUrl: (
    url: string,
    options?: {
      headers?: Record<string, string>;
      mediaQuality?: MediaQuality;
      saveDir?: string;
      startPaused?: boolean;
    },
  ) => ipcRenderer.invoke('tasks:addUrl', url, options) as Promise<DownloadTask>,
  chooseDirectory: () =>
    ipcRenderer.invoke('dialog:chooseDirectory') as Promise<string | null>,
  probeMediaFormats: (url: string) =>
    ipcRenderer.invoke('media:probeFormats', url) as Promise<import('../shared/types').MediaFormatList | null>,
  pauseTask: (taskId: string) => ipcRenderer.invoke('tasks:pause', taskId) as Promise<void>,
  resumeTask: (taskId: string) => ipcRenderer.invoke('tasks:resume', taskId) as Promise<void>,
  cancelTask: (taskId: string) => ipcRenderer.invoke('tasks:cancel', taskId) as Promise<void>,
  setTaskSpeedLimit: (taskId: string, limitBps: number) =>
    ipcRenderer.invoke('tasks:setSpeedLimit', taskId, limitBps) as Promise<DownloadTask>,
  setTaskMediaQuality: (taskId: string, quality: MediaQuality) =>
    ipcRenderer.invoke('tasks:setMediaQuality', taskId, quality) as Promise<DownloadTask>,
  removeTask: (taskId: string, deleteFiles: boolean) =>
    ipcRenderer.invoke('tasks:remove', taskId, deleteFiles) as Promise<void>,
  pauseAllTasks: () => ipcRenderer.invoke('tasks:pauseAll') as Promise<number>,
  resumeAllTasks: () => ipcRenderer.invoke('tasks:resumeAll') as Promise<number>,
  clearFinishedTasks: () => ipcRenderer.invoke('tasks:clearFinished') as Promise<number>,
  clearFailedTasks: () => ipcRenderer.invoke('tasks:clearFailed') as Promise<number>,
  showItemInFolder: (targetPath: string) =>
    ipcRenderer.invoke('shell:showItemInFolder', targetPath) as Promise<void>,
  openPath: (targetPath: string) => ipcRenderer.invoke('shell:openPath', targetPath) as Promise<void>,
  onTasksUpdated: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, tasks: DownloadTask[]) => listener(tasks);
    ipcRenderer.on('tasks:updated', handler);
    return () => {
      ipcRenderer.removeListener('tasks:updated', handler);
    };
  },
  onMenuAction: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, action: MenuAction) => listener(action);
    ipcRenderer.on('menu:action', handler);
    return () => {
      ipcRenderer.removeListener('menu:action', handler);
    };
  },
};

contextBridge.exposeInMainWorld('localdm', api);
