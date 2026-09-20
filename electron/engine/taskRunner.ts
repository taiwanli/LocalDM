import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { CapturePayload, DownloadTask, MediaQuality, TaskStatus } from '../../shared/types';
import {
  applyContentTypeExtension,
  categoryFromFilename,
  filenameFromUrl,
  isAllowedDownloadUrl,
  isHuggingFaceUrl,
  isMagnetUrl,
  isTorrentUrl,
  sanitizeFilename,
  uniqueFilename,
} from '../../shared/url';
import { RangeEngine } from './rangeEngine';
import {
  MediaEngine,
  defaultFfmpegPath,
  defaultYtdlpPath,
  effectiveMediaLimitBps,
  isStreamUrl,
} from './mediaEngine';
import { TorrentEngine, defaultAria2cPath } from './torrentEngine';
import { HlsEngine, isHlsUrl } from './hlsEngine';
import { loadTasksState, normalizeTasksForRestore, saveTasksState } from './taskPersistence';
import { logError, logTask } from '../logger';
import { isYtDlpUrl, normalizeDownloadUrl } from '../../shared/media';

export interface TaskRunnerDeps {
  userDataDir: string;
  downloadDir: string;
  maxConnections: number;
  minSegmentBytes: number;
  maxConcurrentTasks: number;
  globalSpeedLimitBps?: number;
  appRoot?: string;
  ytdlpPath?: string;
  ffmpegPath?: string;
  defaultMediaQuality?: MediaQuality;
  httpProxy?: string;
  maxRetryCount?: number;
  retryDelayMs?: number;
  maxConnectionsPerServer?: number;
  hfCookie?: string;
  hfToken?: string;
  hfConnectionCap?: number;
  aria2cPath?: string;
  enableBt?: boolean;
  adaptiveDegrade?: boolean;
  cookieBrowser?: string;
  askVideoQuality?: boolean;
  useNativeHls?: boolean;
  onTaskStatusSettled?: (task: DownloadTask, previousStatus: TaskStatus | undefined) => void;
}

export function shouldUseTorrentEngine(task: Pick<DownloadTask, 'mediaKind' | 'url'>): boolean {
  if (task.mediaKind === 'torrent' || task.mediaKind === 'magnet') return true;
  return isMagnetUrl(task.url) || isTorrentUrl(task.url);
}

const ACTIVE_STATUSES = new Set<TaskStatus>(['probing', 'downloading', 'merging']);

export function clampRunnerSettings(partial: {
  maxConnections?: number;
  minSegmentBytes?: number;
  maxConcurrentTasks?: number;
}): { maxConnections: number; minSegmentBytes: number; maxConcurrentTasks: number } {
  const maxConnections = Math.min(64, Math.max(1, Math.floor(partial.maxConnections ?? 32)));
  const minSegmentBytes = Math.max(64 * 1024, Math.floor(partial.minSegmentBytes ?? 1024 * 1024));
  const maxConcurrentTasks = Math.min(16, Math.max(1, Math.floor(partial.maxConcurrentTasks ?? 3)));
  return { maxConnections, minSegmentBytes, maxConcurrentTasks };
}

export function shouldUseMediaEngine(task: Pick<DownloadTask, 'mediaKind' | 'url'>): boolean {
  if (shouldUseTorrentEngine(task)) return false;
  if (task.mediaKind === 'video-platform') return true;
  return isStreamUrl(task.url) && !isHlsUrl(task.url);
}

export function shouldUseNativeHls(
  task: Pick<DownloadTask, 'mediaKind' | 'url'>,
  useNativeHls: boolean,
): boolean {
  if (!useNativeHls) return false;
  if (shouldUseTorrentEngine(task)) return false;
  return isHlsUrl(task.url) && task.mediaKind !== 'video-platform';
}

export class TaskRunner extends EventEmitter {
  private readonly engine: RangeEngine;
  private readonly mediaEngine: MediaEngine;
  private readonly torrentEngine: TorrentEngine;
  private readonly hlsEngine = new HlsEngine();
  private readonly tasks = new Map<string, DownloadTask>();
  private readonly starting = new Set<string>();
  private readonly pendingRetries = new Set<string>();
  private readonly cancelling = new Set<string>();
  private readonly recentCaptures = new Map<string, number>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(private deps: TaskRunnerDeps) {
    super();
    this.engine = new RangeEngine({
      maxConnections: deps.maxConnections,
      minSegmentBytes: deps.minSegmentBytes,
      sidecarDir: path.join(deps.userDataDir, 'tasks'),
      globalSpeedLimitBps: deps.globalSpeedLimitBps ?? 0,
    });
    const appRoot = deps.appRoot || process.cwd();
    this.mediaEngine = new MediaEngine(
      defaultYtdlpPath(appRoot, deps.ytdlpPath),
      defaultFfmpegPath(appRoot, deps.ffmpegPath),
    );
    this.mediaEngine.setProxy(deps.httpProxy);
    this.mediaEngine.setCookieBrowser(deps.cookieBrowser);
    this.torrentEngine = new TorrentEngine(defaultAria2cPath(appRoot, deps.aria2cPath));
    this.deps = {
      ...this.deps,
      adaptiveDegrade: deps.adaptiveDegrade !== false,
    };
    this.hydrateFromDisk();
  }

  private hydrateFromDisk(): void {
    const loaded = normalizeTasksForRestore(loadTasksState(this.deps.userDataDir));
    for (const task of loaded) {
      this.tasks.set(task.id, task);
    }
    if (loaded.length) {
      // Delay promote so IPC/window listeners can attach in main process.
      setTimeout(() => this.promoteQueue(), 0);
    }
  }

  private persistSoon(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        saveTasksState(this.deps.userDataDir, this.list());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[TaskRunner] persist tasks failed: ${message}`);
      }
    }, 200);
  }

  private persistNow(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    try {
      saveTasksState(this.deps.userDataDir, this.list());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TaskRunner] persist tasks failed: ${message}`);
    }
  }

  updateDeps(partial: Partial<TaskRunnerDeps>): void {
    const clamped = clampRunnerSettings(partial);
    this.deps = { ...this.deps, ...partial, ...clamped };
    if (partial.adaptiveDegrade !== undefined) {
      this.deps.adaptiveDegrade = partial.adaptiveDegrade !== false;
    }
    if (partial.globalSpeedLimitBps !== undefined) {
      this.engine.setGlobalSpeedLimit(Math.max(0, Math.floor(partial.globalSpeedLimitBps)));
    }
    const appRoot = this.deps.appRoot || process.cwd();
    if (
      partial.ytdlpPath !== undefined ||
      partial.ffmpegPath !== undefined ||
      partial.appRoot !== undefined
    ) {
      this.mediaEngine.updatePaths(
        defaultYtdlpPath(appRoot, this.deps.ytdlpPath),
        defaultFfmpegPath(appRoot, this.deps.ffmpegPath),
      );
    }
    if (partial.httpProxy !== undefined) {
      this.mediaEngine.setProxy(this.deps.httpProxy);
    }
    if (partial.cookieBrowser !== undefined) {
      this.mediaEngine.setCookieBrowser(this.deps.cookieBrowser);
    }
    if (partial.aria2cPath !== undefined || partial.appRoot !== undefined) {
      this.torrentEngine.updatePath(defaultAria2cPath(appRoot, this.deps.aria2cPath));
    }
  }

  setGlobalSpeedLimit(limitBps: number): void {
    this.engine.setGlobalSpeedLimit(Math.max(0, Math.floor(limitBps)));
    this.deps = { ...this.deps, globalSpeedLimitBps: Math.max(0, Math.floor(limitBps)) };
  }

  mediaTools() {
    return {
      ...this.mediaEngine.paths,
      aria2c: this.torrentEngine.path,
    };
  }

  async probeMediaFormats(pageUrl: string) {
    return this.mediaEngine.resolve(normalizeDownloadUrl(pageUrl)) as Promise<
      import('../../shared/types').MediaFormatList
    >;
  }

  list(): DownloadTask[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(taskId: string): DownloadTask | undefined {
    return this.tasks.get(taskId);
  }

  private upsert(task: DownloadTask): DownloadTask {
    const next: DownloadTask = { ...task, updatedAt: new Date().toISOString() };
    this.tasks.set(next.id, next);
    this.persistSoon();
    this.emit('tasks');
    return next;
  }

  private patch(taskId: string, partial: Partial<DownloadTask>): DownloadTask | undefined {
    const current = this.tasks.get(taskId);
    if (!current) return undefined;
    return this.upsert({ ...current, ...partial });
  }

  private activeCount(): number {
    let count = this.starting.size;
    for (const task of this.tasks.values()) {
      if (ACTIVE_STATUSES.has(task.status) && !this.starting.has(task.id)) count += 1;
    }
    return count;
  }

  private engineOptions(task?: DownloadTask) {
    // Single policy: default Range concurrency + adaptive degrade (no download modes).
    const baseConn =
      task?.effectiveConnections && task.effectiveConnections > 0
        ? task.effectiveConnections
        : this.deps.maxConnections;
    const basePer =
      task?.effectiveConnections && task.effectiveConnections > 0
        ? task.effectiveConnections
        : this.deps.maxConnectionsPerServer;
    return {
      maxConnections: baseConn,
      minSegmentBytes: this.deps.minSegmentBytes,
      sidecarDir: path.join(this.deps.userDataDir, 'tasks'),
      globalSpeedLimitBps: this.deps.globalSpeedLimitBps ?? 0,
      taskSpeedLimitBps: task?.speedLimitBps,
      maxConnectionsPerServer: basePer && basePer > 0 ? basePer : baseConn,
      hfConnectionCap: this.deps.hfConnectionCap ?? 4,
      adaptiveDegrade: this.deps.adaptiveDegrade !== false,
    };
  }

  private promoteQueue(): void {
    const slots = this.deps.maxConcurrentTasks - this.activeCount();
    if (slots <= 0) return;
    const queued = [...this.tasks.values()]
      .filter((task) => task.status === 'queued')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const task of queued.slice(0, slots)) {
      void this.beginEngine(task.id, task.doneBytes > 0 ? 'resume' : 'start').catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.handleFailure(task.id, message);
      });
    }
  }

  private scheduleRetry(taskId: string, error?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.status === 'cancelled' || this.cancelling.has(taskId)) return;
    if (this.pendingRetries.has(taskId)) return;
    const maxRetry = Math.max(0, Math.floor(this.deps.maxRetryCount ?? 0));
    const attempts = task.retryCount ?? 0;
    if (maxRetry <= 0 || attempts >= maxRetry) {
      this.patch(taskId, { status: 'failed', error, speedBps: 0, etaSeconds: null });
      this.persistNow();
      this.promoteQueue();
      return;
    }
    const nextAttempt = attempts + 1;
    const delay = Math.max(0, Math.floor(this.deps.retryDelayMs ?? 3000));
    this.patch(taskId, {
      status: 'failed',
      error: error
        ? `${error}（自动重试 ${nextAttempt}/${maxRetry}）`
        : `自动重试 ${nextAttempt}/${maxRetry}`,
      speedBps: 0,
      etaSeconds: null,
      retryCount: nextAttempt,
    });
    this.pendingRetries.add(taskId);
    this.persistNow();
    this.promoteQueue();
    setTimeout(() => {
      this.pendingRetries.delete(taskId);
      const current = this.tasks.get(taskId);
      if (!current || current.status !== 'failed') return;
      this.patch(taskId, { status: 'queued', error: undefined });
      this.promoteQueue();
    }, delay);
  }

  private handleFailure(taskId: string, error?: string): void {
    try {
      logError('task failed', taskId, error || '');
      logTask(taskId, 'FAILED', error || '');
    } catch {
      /* ignore */
    }
    this.scheduleRetry(taskId, error);
  }

  private settleAndPromote(taskId: string, status: DownloadTask['status'], error?: string): void {
    const previous = this.tasks.get(taskId)?.status;
    if (this.cancelling.has(taskId)) {
      if (status === 'paused' || status === 'failed' || status === 'completed') {
        this.pendingRetries.delete(taskId);
        this.cancelling.delete(taskId);
        this.patch(taskId, {
          status: 'cancelled',
          error: undefined,
          speedBps: 0,
          etaSeconds: null,
        });
        this.persistNow();
        this.promoteQueue();
        return;
      }
    }
    if (status === 'failed') {
      const current = this.tasks.get(taskId);
      if (current?.status === 'cancelled') return;
      this.handleFailure(taskId, error);
      return;
    }
    this.patch(taskId, {
      status,
      error,
      retryCount: status === 'completed' ? 0 : this.tasks.get(taskId)?.retryCount ?? 0,
      speedBps: status === 'downloading' ? (this.tasks.get(taskId)?.speedBps ?? 0) : 0,
    });
    if (status === 'completed' || status === 'cancelled') this.persistNow();
    const settled = status === 'completed' || status === 'cancelled' || status === 'paused';
    if (settled) {
      const task = this.tasks.get(taskId);
      if (task && this.deps.onTaskStatusSettled) {
        try {
          this.deps.onTaskStatusSettled(task, previous);
        } catch (hookError) {
          const message = hookError instanceof Error ? hookError.message : String(hookError);
          console.error(`[TaskRunner] onTaskStatusSettled failed id=${taskId}: ${message}`);
        }
      }
      this.promoteQueue();
    }
  }

  private async beginNativeHls(task: DownloadTask): Promise<void> {
    const saveDir = path.dirname(task.savePath);
    await fsp.mkdir(saveDir, { recursive: true });
    const appRoot = this.deps.appRoot || process.cwd();
    const ffmpeg = defaultFfmpegPath(appRoot, this.deps.ffmpegPath);
    const taskRef = task;
    const quality = task.mediaQuality || this.deps.defaultMediaQuality || 'best';
    const maxHeight =
      quality === 'audio' ? undefined : quality === 'best' ? undefined : Number(quality) || undefined;
    try {
      await this.hlsEngine.download(
        task.id,
        {
          saveDir,
          filename: task.filename,
          playlistUrl: normalizeDownloadUrl(task.url),
          headers: task.headers,
          maxHeight,
          maxConnections: this.deps.maxConnectionsPerServer || this.deps.maxConnections,
          ffmpegPath: fs.existsSync(ffmpeg) ? ffmpeg : '',
          proxy: this.deps.httpProxy,
        },
        {
          onProgress: (p) => {
            this.patch(taskRef.id, {
              doneBytes: p.doneBytes,
              totalBytes: p.totalBytes || p.doneBytes,
              speedBps: p.speedBps,
              etaSeconds: p.etaSeconds,
            });
          },
          onStatus: (status, error) => {
            const mapped: DownloadTask['status'] =
              status === 'starting'
                ? 'probing'
                : status === 'downloading'
                  ? 'downloading'
                  : status === 'merging'
                    ? 'merging'
                    : status === 'completed'
                      ? 'completed'
                      : status === 'failed'
                        ? 'failed'
                        : 'paused';
            this.settleAndPromote(taskRef.id, mapped, error);
          },
          onOutputFile: (filePath) => {
            this.patch(taskRef.id, {
              savePath: filePath,
              filename: path.basename(filePath),
            });
          },
        },
      );
    } catch (error) {
      // onStatus already settles failure/retry; avoid double-scheduling.
      const current = this.tasks.get(taskRef.id);
      if (!current || current.status === 'failed' || current.status === 'paused') return;
      throw error;
    }
  }

  private async beginMedia(task: DownloadTask): Promise<void> {
    const saveDir = path.dirname(task.savePath);
    const taskRef = task;
    const quality = task.mediaQuality || this.deps.defaultMediaQuality || 'best';
    const limitRateBps = effectiveMediaLimitBps(task.speedLimitBps, this.deps.globalSpeedLimitBps);
    try {
      await this.mediaEngine.download(
        task.id,
        task.url,
        {
          saveDir,
          quality,
          limitRateBps,
          headers: task.headers,
          proxy: this.deps.httpProxy,
          cookieBrowser: this.deps.cookieBrowser,
          outputTemplate: path.join(saveDir, '%(title).200B [%(id)s].%(ext)s'),
        },
        {
          onProgress: (progress) => {
            const etaSeconds =
              progress.speedBps > 0 && progress.totalBytes > progress.doneBytes
                ? (progress.totalBytes - progress.doneBytes) / progress.speedBps
                : progress.etaSeconds;
            this.patch(taskRef.id, {
              doneBytes: progress.doneBytes,
              totalBytes: progress.totalBytes || this.tasks.get(taskRef.id)?.totalBytes || 0,
              speedBps: progress.speedBps,
              etaSeconds,
            });
          },
          onStatus: (status, error) => {
            const mapped: DownloadTask['status'] =
              status === 'resolving'
                ? 'probing'
                : status === 'downloading'
                  ? 'downloading'
                  : status === 'merging'
                    ? 'merging'
                    : status === 'completed'
                      ? 'completed'
                      : status === 'failed'
                        ? 'failed'
                        : 'paused';
            if (status === 'completed') {
              const current = this.tasks.get(taskRef.id);
              if (current) {
                this.settleAndPromote(taskRef.id, 'completed');
              }
              return;
            }
            this.settleAndPromote(taskRef.id, mapped, error);
          },
          onOutputFile: (filePath) => {
            this.patch(taskRef.id, {
              savePath: filePath,
              filename: path.basename(filePath),
            });
          },
        },
      );
    } catch (error) {
      const current = this.tasks.get(taskRef.id);
      if (!current || current.status === 'failed' || current.status === 'paused') return;
      throw error;
    }
  }

  private async beginTorrent(task: DownloadTask): Promise<void> {
    if (this.deps.enableBt === false) {
      throw new Error('[TaskRunner] BT/磁力未启用：请在设置中打开「启用 BT/磁力下载」');
    }
    const aria2 = defaultAria2cPath(this.deps.appRoot || process.cwd(), this.deps.aria2cPath);
    if (!fs.existsSync(aria2) && !/[\\\\/]aria2c(\\.exe)?$/i.test(aria2)) {
      // bare command may still exist on PATH; only fail clearly when configured path is missing
    }
    if (this.deps.aria2cPath && !fs.existsSync(this.deps.aria2cPath)) {
      throw new Error('[TaskRunner] 未找到 aria2c：请在设置中修正 aria2c 路径，或安装到 resources/bin');
    }
    const saveDir = path.join(this.deps.downloadDir, task.category || 'torrent');
    await fsp.mkdir(saveDir, { recursive: true });
    const limitBps = effectiveMediaLimitBps(task.speedLimitBps, this.deps.globalSpeedLimitBps);
    const taskRef = task;
    let source = task.url;
    if (!isMagnetUrl(source) && isTorrentUrl(source) && /^https?:/i.test(source)) {
      const metaName = sanitizeFilename(filenameFromUrl(source) || `${task.id}.torrent`);
      const metaPath = path.join(saveDir, metaName);
      const metaTask: DownloadTask = {
        ...task,
        id: `${task.id}::torrent-meta`,
        savePath: metaPath,
        filename: metaName,
        mediaKind: 'direct',
        category: 'torrent',
        status: 'queued',
      };
      let metaError: string | null = null;
      // RangeEngine resolves even when download fails — check status + file.
      await this.engine.start(
        metaTask,
        {
          onProgress: () => undefined,
          onStatus: (_id, status, error) => {
            if (status === 'failed') {
              metaError = error || '[TaskRunner] torrent meta download failed';
            }
          },
        },
        this.engineOptions(task),
      );
      if (metaError || !fs.existsSync(metaPath)) {
        throw new Error(metaError || `[TaskRunner] torrent metadata missing path=${metaPath}`);
      }
      source = metaPath;
    }
    try {
      await this.torrentEngine.download(
        task.id,
        {
          saveDir,
          source,
          limitRateBps: limitBps,
          maxConnections: this.deps.maxConnectionsPerServer || this.deps.maxConnections,
          proxy: this.deps.httpProxy,
        },
        {
          onProgress: (progress) => {
            this.patch(taskRef.id, {
              doneBytes: progress.doneBytes,
              totalBytes: progress.totalBytes || this.tasks.get(taskRef.id)?.totalBytes || 0,
              speedBps: progress.speedBps,
              etaSeconds: progress.etaSeconds,
            });
          },
          onStatus: (status, error) => {
            const mapped: DownloadTask['status'] =
              status === 'starting'
                ? 'probing'
                : status === 'downloading'
                  ? 'downloading'
                  : status === 'completed'
                    ? 'completed'
                    : status === 'failed'
                      ? 'failed'
                      : 'paused';
            if (status === 'completed') {
              void this.resolveTorrentOutput(taskRef.id, saveDir);
              this.settleAndPromote(taskRef.id, 'completed');
              return;
            }
            this.settleAndPromote(taskRef.id, mapped, error);
          },
          onOutputFile: (filePath) => {
            this.patch(taskRef.id, {
              savePath: filePath,
              filename: path.basename(filePath),
            });
          },
        },
      );
    } catch (error) {
      const current = this.tasks.get(taskRef.id);
      if (!current || current.status === 'failed' || current.status === 'paused') return;
      throw error;
    }
  }

  private async resolveTorrentOutput(taskId: string, dir: string): Promise<void> {
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const files: { path: string; mtime: number; size: number; name: string }[] = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (/\.(aria2|torrent)$/i.test(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const st = await fsp.stat(full);
        files.push({ path: full, mtime: st.mtimeMs, size: st.size, name: entry.name });
      }
      files.sort((a, b) => b.mtime - a.mtime || b.size - a.size);
      const top = files[0];
      if (top) {
        this.patch(taskId, { savePath: top.path, filename: top.name });
      } else {
        this.patch(taskId, { savePath: dir });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TaskRunner] resolveTorrentOutput failed id=${taskId}: ${message}`);
    }
  }

  private async beginEngine(taskId: string, mode: 'start' | 'resume'): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`[TaskRunner] unknown task id=${taskId}`);
    if (
      this.engine.isRunning(taskId) ||
      this.mediaEngine.isRunning(taskId) ||
      this.torrentEngine.isRunning(taskId) ||
      this.hlsEngine.isRunning(taskId) ||
      this.starting.has(taskId)
    ) {
      return;
    }
    if (this.activeCount() >= this.deps.maxConcurrentTasks) {
      this.patch(taskId, { status: 'queued' });
      return;
    }
    this.starting.add(taskId);
    this.patch(taskId, { status: 'queued', error: undefined });
    try {
      if (shouldUseTorrentEngine(task)) {
        await this.beginTorrent(task);
      } else if (shouldUseNativeHls(task, this.deps.useNativeHls !== false)) {
        await this.beginNativeHls(task);
      } else if (shouldUseMediaEngine(task)) {
        await this.beginMedia(task);
      } else if (mode === 'resume') {
        await this.engine.resume(task, this.callbacks(), this.engineOptions(task));
      } else {
        await this.engine.start(task, this.callbacks(), this.engineOptions(task));
      }
    } finally {
      this.starting.delete(taskId);
      this.promoteQueue();
    }
  }

  private applyAuthHeaders(url: string, headers: Record<string, string>): Record<string, string> {
    const next = { ...headers };
    if (!isHuggingFaceUrl(url)) return next;
    const cookie = (this.deps.hfCookie || '').trim();
    const token = (this.deps.hfToken || '').trim();
    if (cookie && !next.Cookie && !next.cookie) next.Cookie = cookie;
    if (token && !next.Authorization && !next.authorization) next.Authorization = `Bearer ${token}`;
    return next;
  }

  /** Same URL within 8s is treated as duplicate (extension double-fire / protocol+HTTP). */
  private takeRecentCapture(url: string): boolean {
    const now = Date.now();
    for (const [key, at] of this.recentCaptures) {
      if (now - at > 8000) this.recentCaptures.delete(key);
    }
    if (this.recentCaptures.has(url)) return false;
    this.recentCaptures.set(url, now);
    return true;
  }

  async addFromCapture(
    payload: CapturePayload,
    options?: { skipDedupe?: boolean },
  ): Promise<DownloadTask> {
    if (!options?.skipDedupe && !this.takeRecentCapture(payload.url)) {
      const existing = [...this.tasks.values()].find(
        (task) => task.url === payload.url && task.status !== 'cancelled',
      );
      if (existing) return existing;
    }
    const rawUrl = normalizeDownloadUrl(payload.url);
    const magnet = isMagnetUrl(rawUrl);
    const torrentish = magnet || isTorrentUrl(rawUrl);
    if (!magnet && !isAllowedDownloadUrl(rawUrl)) {
      throw new Error(
        `[TaskRunner] url rejected (http/https/magnet only) url=${rawUrl.slice(0, 80)}`,
      );
    }
    const filename = sanitizeFilename(
      payload.suggestedFilename ||
        (magnet ? `magnet-${Date.now().toString(36)}` : filenameFromUrl(rawUrl)) ||
        'download.bin',
    );
    const platform = !torrentish && (payload.kind === 'video-platform' || isYtDlpUrl(rawUrl));
    const mediaKind: CapturePayload['kind'] = torrentish
      ? magnet
        ? 'magnet'
        : 'torrent'
      : platform
        ? 'video-platform'
        : payload.kind;
    const category =
      payload.category ||
      (torrentish ? 'torrent' : platform ? 'video' : categoryFromFilename(filename));
    const saveDir = payload.saveDir?.trim()
      ? payload.saveDir.trim()
      : path.join(this.deps.downloadDir, category);
    await fsp.mkdir(saveDir, { recursive: true });
    const useMedia =
      !torrentish &&
      (platform || isStreamUrl(rawUrl) || isHlsUrl(rawUrl));
    const headers = torrentish ? {} : this.applyAuthHeaders(rawUrl, payload.headers ?? {});
    let finalName = applyContentTypeExtension(
      useMedia ? `${payload.title || filename}` : filename,
      null,
    );
    finalName = uniqueFilename(saveDir, finalName, (p) => fs.existsSync(p) || fs.existsSync(`${p}.part`));
    const task: DownloadTask = {
      id: randomUUID(),
      url: rawUrl,
      pageUrl: payload.pageUrl,
      title: payload.title,
      filename: finalName,
      savePath: path.join(saveDir, finalName),
      category,
      status: 'queued',
      totalBytes: 0,
      doneBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      canResume: useMedia || torrentish,
      mediaKind,
      mediaQuality:
        platform || isHlsUrl(rawUrl)
          ? this.deps.defaultMediaQuality || 'best'
          : undefined,
      segments: [],
      headers,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.upsert(task);
    logTask(task.id, 'created', rawUrl, 'save', task.savePath);
    if (payload.startPaused) {
      this.patch(task.id, { status: 'paused' });
      logTask(task.id, 'startPaused');
      return this.tasks.get(task.id)!;
    }
    this.promoteQueue();
    return this.tasks.get(task.id)!;
  }

  async addUrl(
    url: string,
    options?: {
      headers?: Record<string, string>;
      saveDir?: string;
      startPaused?: boolean;
    },
  ): Promise<DownloadTask> {
    return this.addFromCapture(
      {
        kind: 'direct',
        url,
        headers: options?.headers,
        saveDir: options?.saveDir,
        startPaused: options?.startPaused,
      },
      { skipDedupe: true },
    );
  }

  async createTask(input: {
    url: string;
    headers?: Record<string, string>;
    title?: string;
    suggestedFilename?: string;
    category?: string;
  }): Promise<DownloadTask> {
    return this.addFromCapture(
      {
        kind: 'direct',
        url: input.url,
        headers: input.headers,
        title: input.title,
        suggestedFilename: input.suggestedFilename,
        category: input.category as CapturePayload['category'],
      },
      { skipDedupe: true },
    );
  }

  async clearFailed(): Promise<number> {
    const failed = [...this.tasks.values()].filter((task) => task.status === 'failed');
    for (const task of failed) {
      this.tasks.delete(task.id);
    }
    if (failed.length) this.persistNow();
    if (failed.length) this.emit('tasks');
    this.promoteQueue();
    return failed.length;
  }

  private callbacks() {
    return {
      onProgress: (
        taskId: string,
        doneBytes: number,
        segments: DownloadTask['segments'],
        speedBps: number,
      ) => {
        const current = this.tasks.get(taskId);
        if (!current) return;
        const totalBytes = current.totalBytes || segments.at(-1)?.end || 0;
        const etaSeconds =
          speedBps > 0 && totalBytes > doneBytes ? (totalBytes - doneBytes) / speedBps : null;
        this.patch(taskId, {
          doneBytes,
          segments,
          speedBps,
          totalBytes: totalBytes || current.totalBytes,
          etaSeconds,
        });
      },
      onStatus: (taskId: string, status: DownloadTask['status'], error?: string) => {
        try {
          logTask(taskId, 'status', status, error || '');
        } catch {
          /* ignore */
        }
        this.settleAndPromote(taskId, status, error);
      },
      onPathResolved: (taskId: string, savePath: string, filename: string) => {
        this.patch(taskId, { savePath, filename });
        logTask(taskId, 'path resolved', savePath);
      },
      onAdaptive: (
        taskId: string,
        info: { effectiveConnections: number; message: string },
      ) => {
        this.patch(taskId, { effectiveConnections: info.effectiveConnections });
        if (info.message && info.message !== `effectiveConnections=${info.effectiveConnections}`) {
          logError('adaptive', taskId, info.message);
        }
      },
    };
  }

  async start(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`[TaskRunner] unknown task id=${taskId}`);
    this.patch(taskId, { status: 'queued', error: undefined });
    this.promoteQueue();
  }

  async pause(taskId: string): Promise<void> {
    if (this.torrentEngine.isRunning(taskId)) {
      this.torrentEngine.pause(taskId);
      return;
    }
    if (this.mediaEngine.isRunning(taskId)) {
      this.mediaEngine.pause(taskId);
      return;
    }
    await this.engine.pause(taskId);
  }

  async resume(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`[TaskRunner] unknown task id=${taskId}`);
    if (
      this.engine.isRunning(taskId) ||
      this.mediaEngine.isRunning(taskId) ||
      this.torrentEngine.isRunning(taskId)
    ) {
      return;
    }
    this.pendingRetries.delete(taskId);
    this.patch(taskId, { status: 'queued', error: undefined, retryCount: 0 });
    this.promoteQueue();
  }

  async cancel(taskId: string): Promise<void> {
    this.cancelling.add(taskId);
    this.pendingRetries.delete(taskId);
    if (this.torrentEngine.isRunning(taskId)) this.torrentEngine.cancel(taskId);
    if (this.mediaEngine.isRunning(taskId)) {
      this.mediaEngine.cancel(taskId);
    }
    await this.engine.cancel(taskId);
    this.patch(taskId, { status: 'cancelled', speedBps: 0, etaSeconds: null, error: undefined });
    this.persistNow();
    // Keep cancelling until engines report settle; clear if nothing was running.
    if (
      !this.torrentEngine.isRunning(taskId) &&
      !this.mediaEngine.isRunning(taskId) &&
      !this.engine.isRunning(taskId)
    ) {
      this.cancelling.delete(taskId);
    }
    this.promoteQueue();
  }

  setTaskSpeedLimit(taskId: string, limitBps: number): DownloadTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`[TaskRunner] unknown task id=${taskId}`);
    const nextLimit = Math.max(0, Math.floor(limitBps));
    this.engine.setTaskSpeedLimit(taskId, nextLimit);
    return this.patch(taskId, { speedLimitBps: nextLimit })!;
  }

  setTaskMediaQuality(taskId: string, quality: MediaQuality): DownloadTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`[TaskRunner] unknown task id=${taskId}`);
    return this.patch(taskId, { mediaQuality: quality })!;
  }

  async pauseAll(): Promise<number> {
    const targets = [...this.tasks.values()].filter((task) => ACTIVE_STATUSES.has(task.status));
    for (const task of targets) {
      if (this.torrentEngine.isRunning(task.id)) this.torrentEngine.pause(task.id);
      else if (this.mediaEngine.isRunning(task.id)) this.mediaEngine.pause(task.id);
      else await this.engine.pause(task.id);
    }
    return targets.length;
  }

  async resumeAll(): Promise<number> {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'paused' || task.status === 'queued' || task.status === 'failed') {
        this.pendingRetries.delete(task.id);
        this.cancelling.delete(task.id);
        this.patch(task.id, { status: 'queued', error: undefined, retryCount: 0 });
        count += 1;
      }
    }
    this.promoteQueue();
    return count;
  }

  async clearFinished(): Promise<number> {
    const finished = [...this.tasks.values()].filter(
      (task) => task.status === 'completed' || task.status === 'cancelled',
    );
    for (const task of finished) {
      this.tasks.delete(task.id);
    }
    if (finished.length) this.persistNow();
    if (finished.length) this.emit('tasks');
    this.promoteQueue();
    return finished.length;
  }

  async remove(taskId: string, deleteFiles: boolean): Promise<void> {
    if (this.torrentEngine.isRunning(taskId)) this.torrentEngine.cancel(taskId);
    if (this.mediaEngine.isRunning(taskId)) this.mediaEngine.cancel(taskId);
    await this.engine.cancel(taskId);
    const task = this.tasks.get(taskId);
    this.tasks.delete(taskId);
    this.persistNow();
    this.emit('tasks');
    if (deleteFiles && task) {
      await fsp.rm(task.savePath, { force: true }).catch(() => undefined);
      await fsp.rm(`${task.savePath}.part`, { force: true }).catch(() => undefined);
    }
    this.promoteQueue();
  }
}
