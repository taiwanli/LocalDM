/** Shared types between Electron main and React renderer. */

export type TaskStatus =
  | 'queued'
  | 'probing'
  | 'downloading'
  | 'paused'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type Category =
  | 'video'
  | 'music'
  | 'program'
  | 'archive'
  | 'document'
  | 'model'
  | 'torrent'
  | 'other';

export type StatusBucket = 'all' | 'active' | 'completed';

export type MediaKind =
  | 'direct'
  | 'video-platform'
  | 'sniffed-media'
  | 'torrent'
  | 'magnet';

export type MediaQuality =
  | 'best'
  | '2160'
  | '1440'
  | '1080'
  | '720'
  | '480'
  | 'audio';

export const MEDIA_QUALITY_LABELS: Record<MediaQuality, string> = {
  best: '最佳画质',
  '2160': '4K (≤2160p)',
  '1440': '2K (≤1440p)',
  '1080': '1080p',
  '720': '720p',
  '480': '480p',
  audio: '仅音频',
};

export type ThemePreference = 'follow' | 'light' | 'dark';

export type AccentPreference =
  | 'blue'
  | 'purple'
  | 'pink'
  | 'orange'
  | 'green'
  | 'teal'
  | 'indigo'
  | 'graphite';

/**
 * Download aggressiveness presets.
 * Sites with WAF/CDN rate limits (e.g. EdgeOne 567) often block high parallelism.
 */
export type DownloadMode = 'default' | 'balanced' | 'turbo' | 'adaptive';

export const DOWNLOAD_MODE_LABELS: Record<DownloadMode, string> = {
  default: '默认',
  balanced: '均衡',
  turbo: '极速',
  adaptive: '自适应',
};

export interface DownloadModePreset {
  id: DownloadMode;
  label: string;
  hint: string;
  maxConnections: number;
  maxConnectionsPerServer: number;
  maxConcurrentTasks: number;
  /** ms between starting parallel segment workers */
  workerStaggerMs: number;
  /** Extra delay between Range requests on the same task (ms) */
  requestGapMs: number;
  /** Probe rate-limit cooldown base (ms) */
  probeCooldownMs: number;
  /** Max probe backoff rounds before giving up */
  probeMaxRounds: number;
  /** Force adaptive rate-limit degrade for this mode */
  adaptiveDegrade?: boolean;
  /** When true, engine uses user-configured connection counts instead of fixed preset numbers */
  useSettingsConnections?: boolean;
}

export const DOWNLOAD_MODE_PRESETS: Record<DownloadMode, DownloadModePreset> = {
  default: {
    id: 'default',
    label: '默认',
    hint: '保守并发，优先稳定；遇站点安全策略拦截时使用',
    maxConnections: 2,
    maxConnectionsPerServer: 2,
    maxConcurrentTasks: 1,
    workerStaggerMs: 400,
    requestGapMs: 120,
    probeCooldownMs: 15000,
    probeMaxRounds: 6,
  },
  balanced: {
    id: 'balanced',
    label: '均衡',
    hint: '适中并发，速度与兼容折中',
    maxConnections: 6,
    maxConnectionsPerServer: 6,
    maxConcurrentTasks: 2,
    workerStaggerMs: 120,
    requestGapMs: 30,
    probeCooldownMs: 8000,
    probeMaxRounds: 4,
  },
  turbo: {
    id: 'turbo',
    label: '极速',
    hint: '高并发抢带宽；CDN/WAF 可能限流或返回 567',
    maxConnections: 16,
    maxConnectionsPerServer: 16,
    maxConcurrentTasks: 4,
    workerStaggerMs: 0,
    requestGapMs: 0,
    probeCooldownMs: 4000,
    probeMaxRounds: 3,
  },
  adaptive: {
    id: 'adaptive',
    label: '自适应',
    hint: '按设置里的连接数启动，限流时自动降并发（推荐日常）',
    maxConnections: 8,
    maxConnectionsPerServer: 8,
    maxConcurrentTasks: 3,
    workerStaggerMs: 80,
    requestGapMs: 20,
    probeCooldownMs: 8000,
    probeMaxRounds: 5,
    adaptiveDegrade: true,
    useSettingsConnections: true,
  },
};

export const ACCENT_LABELS: Record<AccentPreference, string> = {
  blue: '系统蓝',
  purple: '紫',
  pink: '粉',
  orange: '橙',
  green: '绿',
  teal: '青',
  indigo: '靛',
  graphite: '石墨',
};

export interface SegmentProgress {
  start: number;
  end: number;
  done: number;
}

export interface DownloadTask {
  id: string;
  url: string;
  pageUrl?: string;
  title?: string;
  filename: string;
  savePath: string;
  category: Category;
  status: TaskStatus;
  totalBytes: number;
  doneBytes: number;
  speedBps: number;
  etaSeconds: number | null;
  canResume: boolean;
  mediaKind: MediaKind;
  segments: SegmentProgress[];
  headers: Record<string, string>;
  /** Per-task download cap in bytes/s; 0 or undefined = unlimited (global limit may still apply). */
  speedLimitBps?: number;
  /** yt-dlp format preference; defaults to AppSettings.defaultMediaQuality when unset. */
  mediaQuality?: MediaQuality;
  /** How many times auto-retry has been scheduled for this task. */
  retryCount?: number;
  /** Live connection budget after adaptive degradation (engine may lower this). */
  effectiveConnections?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaFormatList {
  title: string;
  webpageUrl?: string;
  duration?: number;
  formats: Array<{
    formatId: string;
    note: string;
    height?: number;
  }>;
  suggestedFormat: string;
}

export interface CapturePayload {
  kind: MediaKind;
  url: string;
  pageUrl?: string;
  title?: string;
  suggestedFilename?: string;
  mediaType?: 'video' | 'audio' | 'file' | 'model' | 'stream';
  category?: Category;
  headers?: Record<string, string>;
  /** Override save directory (absolute path). */
  saveDir?: string;
  /** Create task paused without auto-start. */
  startPaused?: boolean;
}

export interface AppSettings {
  downloadDir: string;
  maxConnections: number;
  maxConnectionsPerServer: number;
  minSegmentBytes: number;
  maxConcurrentTasks: number;
  globalSpeedLimitBps: number;
  theme: ThemePreference;
  apiPort: number;
  ytdlpPath: string;
  ffmpegPath: string;
  defaultMediaQuality: MediaQuality;
  enableBrowserCapture: boolean;
  takeoverEnabled: boolean;
  notifyOnComplete: boolean;
  openFolderOnComplete: boolean;
  /** HTTP(S) proxy for downloads/yt-dlp/Electron session; empty = direct. */
  httpProxy: string;
  /** Auto-retry budget for failed tasks; 0 disables auto-retry. */
  maxRetryCount: number;
  /** Delay before each auto-retry attempt (ms). */
  retryDelayMs: number;
  /** Cookie header applied to HuggingFace downloads. */
  hfCookie: string;
  /** Bearer token for HuggingFace private/limited files. */
  hfToken: string;
  /** Close button / all-windows-closed minimizes to tray instead of quit. */
  minimizeToTray: boolean;
  /** Non-health Local API endpoints require Bearer token when true. */
  requireApiToken: boolean;
  /** aria2c executable path for BT/magnet; empty = auto-detect resources/bin. */
  aria2cPath: string;
  /** Enable BT/magnet downloads via aria2c. */
  enableBt: boolean;
  /** Extra BitTorrent trackers for magnets (newline separated; merged with built-in list). */
  btTrackers: string;
  /** Fail magnet tasks stuck on metadata for this many seconds (0 = never). */
  btMetadataTimeoutSec: number;
  /** UI accent (pixel-level theme customization). */
  accent: AccentPreference;
  /** Master switch: system/browser downloads default to LocalDM. */
  systemTakeoverEnabled: boolean;
  /** Watch clipboard for download URLs and enqueue them. */
  clipboardTakeoverEnabled: boolean;
  /** Download aggressiveness: default | balanced | turbo */
  downloadMode: DownloadMode;
  /** Auto-degrade connections on WAF/rate-limit (567/403/429…). */
  adaptiveDegrade: boolean;
  /** yt-dlp --cookies-from-browser for cookie-sensitive hosts (twinkstar = 星愿浏览器) */
  cookieBrowser: '' | 'chrome' | 'edge' | 'firefox' | 'twinkstar';
  /** Netscape cookies.txt path for yt-dlp --cookies (e.g. Douyin) */
  cookieFile: string;
  /** Open quality picker when adding platform video tasks */
  askVideoQuality: boolean;
  /** Prefer native HLS engine for .m3u8 when ffmpeg is available */
  useNativeHls: boolean;
  /** Structured proxy (composed into httpProxy for engine/yt-dlp/session). */
  proxyType: 'http' | 'https' | 'socks5' | 'socks4';
  proxyHost: string;
  proxyPort: string;
  proxyUser: string;
  proxyPass: string;
  /** Launch hidden to tray at login. */
  autoLaunch: boolean;
  /** First-run onboarding has been completed or skipped. */
  onboardingDone?: boolean;
}

export interface EngineHealth {
  apiPort: number;
  tokenRequired: boolean;
  ytdlpAvailable: boolean;
  ffmpegAvailable: boolean;
  aria2cAvailable?: boolean;
  /** Browser/system download takeover master switch. */
  systemTakeoverEnabled?: boolean;
}

export interface StatusCounters {
  all: number;
  active: number;
  completed: number;
  byCategory: Record<Category, number>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  downloadDir: '',
  maxConnections: 8,
  maxConnectionsPerServer: 8,
  minSegmentBytes: 1024 * 1024,
  maxConcurrentTasks: 3,
  globalSpeedLimitBps: 0,
  theme: 'follow',
  apiPort: 37280,
  ytdlpPath: '',
  ffmpegPath: '',
  defaultMediaQuality: 'best',
  enableBrowserCapture: true,
  takeoverEnabled: false,
  notifyOnComplete: true,
  openFolderOnComplete: false,
  httpProxy: '',
  maxRetryCount: 2,
  retryDelayMs: 3000,
  hfCookie: '',
  hfToken: '',
  minimizeToTray: true,
  requireApiToken: true,
  aria2cPath: '',
  enableBt: true,
  btTrackers: '',
  btMetadataTimeoutSec: 180,
  accent: 'blue',
  systemTakeoverEnabled: false,
  clipboardTakeoverEnabled: false,
  downloadMode: 'adaptive',
  adaptiveDegrade: true,
  cookieBrowser: '',
  cookieFile: '',
  askVideoQuality: false,
  useNativeHls: true,
  proxyType: 'http',
  proxyHost: '',
  proxyPort: '',
  proxyUser: '',
  proxyPass: '',
  autoLaunch: false,
  onboardingDone: false,
};

export const CATEGORY_LABELS: Record<Category, string> = {
  video: '视频',
  music: '音乐',
  program: '程序',
  archive: '压缩包',
  document: '文档',
  model: '模型',
  torrent: '种子',
  other: '其他',
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: '排队中',
  probing: '准备中',
  downloading: '下载中',
  paused: '已暂停',
  merging: '合并中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};
