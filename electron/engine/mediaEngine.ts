/**
 * yt-dlp / ffmpeg subprocess bridge.
 * Hosts must not scrape normal yt-dlp stdout — use --progress-template only.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type { MediaQuality } from '../../shared/types';
import { cookieBrowserArgs, normalizeDownloadUrl } from '../../shared/media';

export interface MediaFormatInfo {
  formatId: string;
  note: string;
  height?: number;
  acodec?: string;
  vcodec?: string;
  ext?: string;
}

export interface MediaResolveResult {
  title: string;
  webpageUrl?: string;
  duration?: number;
  formats: MediaFormatInfo[];
  /** Recommended best video+audio format id expression for yt-dlp -f. */
  suggestedFormat: string;
}

export interface MediaProgress {
  doneBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number | null;
}

export interface MediaDownloadCallbacks {
  onProgress: (progress: MediaProgress) => void;
  onStatus: (status: 'resolving' | 'downloading' | 'merging' | 'completed' | 'failed' | 'paused', error?: string) => void;
  onOutputFile?: (filePath: string) => void;
}

export interface MediaDownloadOptions {
  formatId?: string;
  quality?: MediaQuality;
  saveDir: string;
  outputTemplate?: string;
  headers?: Record<string, string>;
  audioOnly?: boolean;
  /** Bytes/s; applied as yt-dlp --limit-rate. 0 = unlimited. */
  limitRateBps?: number;
  /** HTTP(S) proxy URL for yt-dlp; empty/undefined = no --proxy flag. */
  proxy?: string;
  /** chrome/edge/firefox for --cookies-from-browser on cookie-sensitive hosts */
  cookieBrowser?: string;
}

const PROGRESS_TEMPLATE =
  'download:%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s';

export function isStreamUrl(url: string): boolean {
  return /\.(m3u8|mpd)(\?|$)/i.test(url) || /\/hls\//i.test(url);
}

export function formatExpressionForQuality(quality: MediaQuality | undefined): string {
  switch (quality) {
    case 'audio':
      return 'bestaudio/best';
    case '2160':
      return 'bv*[height<=2160]+ba/b[height<=2160]/b';
    case '1440':
      return 'bv*[height<=1440]+ba/b[height<=1440]/b';
    case '1080':
      return 'bv*[height<=1080]+ba/b[height<=1080]/b';
    case '720':
      return 'bv*[height<=720]+ba/b[height<=720]/b';
    case '480':
      return 'bv*[height<=480]+ba/b[height<=480]/b';
    case 'best':
    default:
      return 'bv*+ba/b';
  }
}

/** yt-dlp --limit-rate accepts a bare byte count; 0/undefined means no flag. */
export function limitRateArg(limitBps: number | undefined): string | undefined {
  if (!limitBps || limitBps <= 0 || !Number.isFinite(limitBps)) return undefined;
  return String(Math.floor(limitBps));
}

/** Effective media throttle: task limit wins if set, else global; min if both. */
export function effectiveMediaLimitBps(
  taskLimitBps: number | undefined,
  globalLimitBps: number | undefined,
): number {
  const taskLimit = taskLimitBps && taskLimitBps > 0 ? Math.floor(taskLimitBps) : 0;
  const globalLimit = globalLimitBps && globalLimitBps > 0 ? Math.floor(globalLimitBps) : 0;
  if (taskLimit && globalLimit) return Math.min(taskLimit, globalLimit);
  return taskLimit || globalLimit || 0;
}

function packagedBinDir(appRoot: string): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return resourcesPath ? path.join(resourcesPath, 'bin') : path.join(appRoot, 'resources/bin');
}

export function defaultYtdlpPath(appRoot: string, configured?: string): string {
  const resourceBin = packagedBinDir(appRoot);
  const candidates = [
    configured,
    path.join(appRoot, 'resources/bin/yt-dlp.exe'),
    path.join(appRoot, 'resources/bin/yt-dlp'),
    path.join(resourceBin, 'yt-dlp.exe'),
    path.join(resourceBin, 'yt-dlp'),
  ].filter((item): item is string => Boolean(item && item.trim()));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return (
    candidates[0] ?? path.join(appRoot, 'resources/bin/yt-dlp.exe')
  );
}

export function defaultFfmpegPath(appRoot: string, configured?: string): string {
  const resourceBin = packagedBinDir(appRoot);
  const candidates = [
    configured,
    path.join(appRoot, 'resources/bin/ffmpeg.exe'),
    path.join(appRoot, 'resources/bin/ffmpeg'),
    path.join(resourceBin, 'ffmpeg.exe'),
    path.join(resourceBin, 'ffmpeg'),
  ].filter((item): item is string => Boolean(item && item.trim()));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return (
    candidates[0] ?? path.join(appRoot, 'resources/bin/ffmpeg.exe')
  );
}

export function mediaToolStatus(ytdlpPath: string, ffmpegPath: string): {
  ytdlpAvailable: boolean;
  ffmpegAvailable: boolean;
} {
  return {
    ytdlpAvailable: fs.existsSync(ytdlpPath),
    ffmpegAvailable: fs.existsSync(ffmpegPath),
  };
}

function parseNumber(raw: string | undefined): number | null {
  if (raw == null || raw === 'NA' || raw === 'None' || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function parseProgressTemplateLine(line: string): MediaProgress | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('download:')) return null;
  const parts = trimmed.slice('download:'.length).split('|');
  if (parts.length < 5) return null;
  const downloaded = parseNumber(parts[0]) ?? 0;
  const total = parseNumber(parts[1]) ?? parseNumber(parts[2]) ?? 0;
  const speed = parseNumber(parts[3]) ?? 0;
  const eta = parseNumber(parts[4]);
  return {
    doneBytes: downloaded,
    totalBytes: total,
    speedBps: speed,
    etaSeconds: eta,
  };
}

function buildEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

export class MediaEngine {
  private active = new Map<string, ChildProcessWithoutNullStreams>();
  private killIntent = new Set<string>();
  private proxy?: string;
  private cookieBrowser?: string;

  constructor(
    private ytdlpPath: string,
    private ffmpegPath: string,
  ) {}

  updatePaths(ytdlpPath: string, ffmpegPath: string): void {
    this.ytdlpPath = ytdlpPath;
    this.ffmpegPath = ffmpegPath;
  }

  setProxy(proxy: string | undefined): void {
    const value = (proxy || '').trim();
    this.proxy = value || undefined;
  }

  setCookieBrowser(browser: string | undefined): void {
    this.cookieBrowser = (browser || '').trim() || undefined;
  }

  get paths() {
    return { ytdlp: this.ytdlpPath, ffmpeg: this.ffmpegPath };
  }

  isRunning(taskId: string): boolean {
    return this.active.has(taskId);
  }

  async resolve(pageUrl: string, headers?: Record<string, string>): Promise<MediaResolveResult> {
    if (!fs.existsSync(this.ytdlpPath)) {
      throw new Error(`[MediaEngine] yt-dlp not found: ${this.ytdlpPath}`);
    }
    const normalized = normalizeDownloadUrl(pageUrl);
    const args = ['--no-warnings', '--no-playlist', '-J', normalized];
    const headerArgs = this.headerArgs(headers);
    const proxyArgs = this.proxyArgs();
    const cookieArgs = this.cookieArgsFor(normalized);
    const json = await this.execCapture([proxyArgs, cookieArgs, headerArgs, args].flat());
    let data: {
      title?: string;
      webpage_url?: string;
      duration?: number;
      formats?: Array<{
        format_id?: string;
        format_note?: string;
        height?: number;
        acodec?: string;
        vcodec?: string;
        ext?: string;
      }>;
    };
    try {
      data = JSON.parse(json) as typeof data;
    } catch {
      throw new Error('[MediaEngine] yt-dlp -J returned invalid JSON');
    }
    const formats: MediaFormatInfo[] = (data.formats ?? [])
      .filter((item) => item.format_id)
      .map((item) => ({
        formatId: String(item.format_id),
        note: item.format_note || item.ext || '',
        height: item.height,
        acodec: item.acodec,
        vcodec: item.vcodec,
        ext: item.ext,
      }));
    return {
      title: data.title || pageUrl,
      webpageUrl: data.webpage_url,
      duration: data.duration,
      formats,
      suggestedFormat: 'bv*+ba/b',
    };
  }

  private headerArgs(headers?: Record<string, string>): string[] {
    const args: string[] = [];
    if (!headers) return args;
    for (const [key, value] of Object.entries(headers)) {
      if (!value) continue;
      const name = key.toLowerCase();
      if (name === 'cookie' || name === 'authorization' || name === 'user-agent' || name === 'referer') {
        args.push('--add-header', `${key}:${value}`);
      }
    }
    return args;
  }

  private proxyArgs(override?: string): string[] {
    const value = ((override ?? this.proxy) || '').trim();
    if (!value) return [];
    return ['--proxy', value];
  }

  private cookieArgsFor(url: string, override?: string): string[] {
    return cookieBrowserArgs(override ?? this.cookieBrowser, url);
  }

  private async execCapture(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.ytdlpPath, args, {
        windowsHide: true,
        env: buildEnv(),
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (stdout.length > 8 * 1024 * 1024) child.kill();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (stderr.length > 1024 * 1024) stderr = stderr.slice(-1024 * 1024);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`[MediaEngine] yt-dlp exit=${code} ${stderr.slice(-400)}`));
      });
    });
  }

  pause(taskId: string): void {
    this.killIntent.add(taskId);
    const child = this.active.get(taskId);
    if (!child) return;
    child.kill();
  }

  cancel(taskId: string): void {
    this.killIntent.add(taskId);
    this.active.get(taskId)?.kill();
  }

  async download(
    taskId: string,
    pageUrl: string,
    options: MediaDownloadOptions,
    callbacks: MediaDownloadCallbacks,
  ): Promise<void> {
    if (this.active.has(taskId)) {
      throw new Error(`[MediaEngine] task already running id=${taskId}`);
    }
    if (!fs.existsSync(this.ytdlpPath)) {
      throw new Error(`[MediaEngine] yt-dlp not found: ${this.ytdlpPath}`);
    }
    await fsp.mkdir(options.saveDir, { recursive: true });
    const normalizedUrl = normalizeDownloadUrl(pageUrl);
    const outputTemplate =
      options.outputTemplate || path.join(options.saveDir, '%(title).200B [%(id)s].%(ext)s');
    const format = options.audioOnly
      ? 'bestaudio/best'
      : options.formatId || formatExpressionForQuality(options.quality);
    const args = [
      '--no-warnings',
      '--no-playlist',
      '--newline',
      '--progress-template',
      PROGRESS_TEMPLATE,
      '--continue',
      '-f',
      format,
      '-o',
      outputTemplate,
    ];
    const rate = limitRateArg(options.limitRateBps);
    if (rate) {
      args.push('--limit-rate', rate);
    }
    args.push(...this.proxyArgs(options.proxy));
    if (fs.existsSync(this.ffmpegPath)) {
      args.push('--ffmpeg-location', path.dirname(this.ffmpegPath));
    }
    args.push(...this.headerArgs(options.headers));
    args.push(...this.cookieArgsFor(normalizedUrl, options.cookieBrowser));
    if (isStreamUrl(normalizedUrl)) {
      args.push('--downloader', 'native');
    }
    args.push(normalizedUrl);

    callbacks.onStatus('resolving');
    const child = spawn(this.ytdlpPath, args, {
      windowsHide: true,
      env: buildEnv(),
    });
    this.active.set(taskId, child);
    callbacks.onStatus('downloading');

    let stderrTail = '';
    let sawMergeHint = false;

    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          if (!line) continue;
          const progress = parseProgressTemplateLine(line);
          if (progress) {
            callbacks.onProgress(progress);
            continue;
          }
          if (/Merging formats|Fixing MPEG|already been downloaded/i.test(line)) {
            sawMergeHint = true;
            callbacks.onStatus('merging');
          }
          const dest = /\[download\] Destination: (.+)$/i.exec(line);
          if (dest?.[1]) callbacks.onOutputFile?.(dest[1].trim());
          const merged = /\[Merger\] Merging formats into "(.+)"$/i.exec(line);
          if (merged?.[1]) callbacks.onOutputFile?.(merged[1].trim());
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrTail += chunk.toString('utf8');
        if (stderrTail.length > 200 * 1024) stderrTail = stderrTail.slice(-200 * 1024);
      });
      child.on('error', (error) => {
        this.active.delete(taskId);
        callbacks.onStatus('failed', error.message);
        reject(error);
      });
      child.on('close', (code, signal) => {
        this.active.delete(taskId);
        const intentional = this.killIntent.has(taskId);
        this.killIntent.delete(taskId);
        if (intentional || signal === 'SIGTERM' || signal === 'SIGINT') {
          callbacks.onStatus('paused');
          resolve();
          return;
        }
        if (code === 0) {
          callbacks.onStatus(sawMergeHint ? 'completed' : 'completed');
          resolve();
          return;
        }
        const message = `[MediaEngine] yt-dlp exit=${code} ${stderrTail.slice(-400)}`;
        callbacks.onStatus('failed', message);
        reject(new Error(message));
      });
    });
  }
}
