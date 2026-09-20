import type {
  AppSettings,
  DownloadMode,
  DownloadTask,
  EngineHealth,
  MediaFormatList,
  MediaQuality,
} from './types';

export interface AboutInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  userDataDir: string;
  appPath: string;
  apiPort: number;
  httpProxy: string;
  disclaimer: string;
  extensionPath?: string;
  downloadMode?: DownloadMode;
}

export interface BootstrapPayload {
  appName: string;
  settings: AppSettings;
  health: EngineHealth;
  tokenPreview: string;
  apiToken: string;
  userDataDir: string;
  about: AboutInfo;
}

export type MenuAction = 'add-url' | 'settings' | 'about';

export interface LocalDmBridge {
  getBootstrap: () => Promise<BootstrapPayload>;
  saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  getTheme: () => Promise<AppSettings['theme']>;
  getExtensionStatus: () => Promise<{
    extensionDir: string | null;
    manifestExists: boolean;
  }>;
  copyText: (text: string) => Promise<boolean>;
  listTasks: () => Promise<DownloadTask[]>;
  addTaskUrl: (
    url: string,
    options?: {
      headers?: Record<string, string>;
      mediaQuality?: MediaQuality;
      saveDir?: string;
      startPaused?: boolean;
    },
  ) => Promise<DownloadTask>;
  chooseDirectory: () => Promise<string | null>;
  probeMediaFormats: (url: string) => Promise<MediaFormatList | null>;
  pauseTask: (taskId: string) => Promise<void>;
  resumeTask: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  setTaskSpeedLimit: (taskId: string, limitBps: number) => Promise<DownloadTask>;
  setTaskMediaQuality: (taskId: string, quality: MediaQuality) => Promise<DownloadTask>;
  removeTask: (taskId: string, deleteFiles: boolean) => Promise<void>;
  pauseAllTasks: () => Promise<number>;
  resumeAllTasks: () => Promise<number>;
  clearFinishedTasks: () => Promise<number>;
  clearFailedTasks: () => Promise<number>;
  showItemInFolder: (targetPath: string) => Promise<void>;
  openPath: (targetPath: string) => Promise<void>;
  onTasksUpdated: (listener: (tasks: DownloadTask[]) => void) => () => void;
  onMenuAction: (listener: (action: MenuAction) => void) => () => void;
}
