/**
 * BT/magnet downloads via aria2c subprocess.
 * Pause/cancel kill the process; resume restarts — aria2 continues via .aria2 control file.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isMagnetUrl } from '../../shared/url';

export interface TorrentProgress {
  doneBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number | null;
}

export interface TorrentDownloadCallbacks {
  onProgress: (progress: TorrentProgress) => void;
  onStatus: (
    status: 'starting' | 'downloading' | 'completed' | 'failed' | 'paused',
    error?: string,
  ) => void;
  onOutputFile?: (filePath: string) => void;
}

export interface TorrentDownloadOptions {
  saveDir: string;
  /** magnet URI or path to .torrent file */
  source: string;
  /** Limit rate in bytes/s; 0 = unlimited */
  limitRateBps?: number;
  /** max overall connections */
  maxConnections?: number;
  proxy?: string;
}

export function defaultAria2cPath(appRoot: string, configured?: string): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    configured,
    path.join(appRoot, 'resources/bin/aria2c.exe'),
    path.join(appRoot, 'resources/bin/aria2c'),
    resourcesPath ? path.join(resourcesPath, 'bin/aria2c.exe') : '',
    resourcesPath ? path.join(resourcesPath, 'bin/aria2c') : '',
  ].filter((item): item is string => Boolean(item && item.trim()));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates.find((item) => item.toLowerCase().includes('aria2c')) || 'aria2c';
}

export function aria2cToolStatus(aria2cPath: string): { available: boolean; path: string } {
  if (fs.existsSync(aria2cPath)) return { available: true, path: aria2cPath };
  // bare command name may still resolve via PATH at spawn time
  if (!aria2cPath.includes(path.sep) && !aria2cPath.includes('/')) {
    return { available: true, path: aria2cPath };
  }
  return { available: false, path: aria2cPath };
}

/** Parse aria2 console summary lines like: [#HASH 1.2MiB/4.5MiB(26%) CN:5 SD:3 DL:123KiB ETA:12s] */
export function parseAria2ProgressLine(line: string): TorrentProgress | null {
  const match = /\[#[^\]]+?\s+([0-9.]+)([KMGT]?i?B)\/([0-9.]+)([KMGT]?i?B)\((\d+)%\)/i.exec(line);
  if (!match) return null;
  const done = toBytes(Number(match[1]), match[2]);
  const total = toBytes(Number(match[3]), match[4]);
  const dl = /DL:([0-9.]+)([KMGT]?i?B)/i.exec(line);
  const speed = dl ? toBytes(Number(dl[1]), dl[2]) : 0;
  const eta = /ETA:([0-9dhms]+)/i.exec(line);
  return {
    doneBytes: done,
    totalBytes: total || done,
    speedBps: speed,
    etaSeconds: eta ? parseEta(eta[1]) : null,
  };
}

function toBytes(value: number, unit: string): number {
  const u = unit.toUpperCase().replace('I', '');
  const map: Record<string, number> = {
    B: 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
  };
  return Math.floor(value * (map[u] || 1));
}

function parseEta(raw: string): number | null {
  const hours = /(\d+)h/i.exec(raw);
  const mins = /(\d+)m/i.exec(raw);
  const secs = /(\d+)s/i.exec(raw);
  if (!hours && !mins && !secs) return null;
  return (
    (hours ? Number(hours[1]) * 3600 : 0) +
    (mins ? Number(mins[1]) * 60 : 0) +
    (secs ? Number(secs[1]) : 0)
  );
}

export function buildAria2Args(options: TorrentDownloadOptions): string[] {
  const args = [
    '--continue=true',
    '--seed-time=0',
    '--max-overall-download-limit=' +
      (options.limitRateBps && options.limitRateBps > 0
        ? String(Math.floor(options.limitRateBps))
        : '0'),
    '--max-connection-per-server=' + String(Math.max(1, Math.min(16, options.maxConnections || 4))),
    '--split=' + String(Math.max(1, Math.min(16, options.maxConnections || 4))),
    '--console-log-level=warn',
    '--summary-interval=1',
    '--auto-file-renaming=false',
    '--allow-overwrite=true',
    '--dir=' + options.saveDir,
  ];
  const proxy = (options.proxy || '').trim();
  if (proxy) args.push('--all-proxy=' + proxy);
  if (isMagnetUrl(options.source)) {
    args.push(options.source);
  } else {
    args.push(options.source);
  }
  return args;
}

export class TorrentEngine {
  private active = new Map<string, ChildProcessWithoutNullStreams>();
  private killIntent = new Set<string>();
  private aria2cPath: string;

  constructor(aria2cPath: string) {
    this.aria2cPath = aria2cPath;
  }

  updatePath(aria2cPath: string): void {
    this.aria2cPath = aria2cPath;
  }

  get path(): string {
    return this.aria2cPath;
  }

  isRunning(taskId: string): boolean {
    return this.active.has(taskId);
  }

  pause(taskId: string): void {
    this.killIntent.add(taskId);
    this.active.get(taskId)?.kill();
  }

  cancel(taskId: string): void {
    this.killIntent.add(taskId);
    this.active.get(taskId)?.kill();
  }

  async download(
    taskId: string,
    options: TorrentDownloadOptions,
    callbacks: TorrentDownloadCallbacks,
  ): Promise<void> {
    if (this.active.has(taskId)) {
      throw new Error(`[TorrentEngine] task already running id=${taskId}`);
    }
    if (!isMagnetUrl(options.source) && !fs.existsSync(options.source) && !/^https?:/i.test(options.source)) {
      throw new Error(`[TorrentEngine] invalid source: ${options.source.slice(0, 80)}`);
    }
    await fsp.mkdir(options.saveDir, { recursive: true });
    const args = buildAria2Args(options);
    callbacks.onStatus('starting');
    const child = spawn(this.aria2cPath, args, {
      windowsHide: true,
      cwd: options.saveDir,
      env: { ...process.env },
    });
    this.active.set(taskId, child);
    callbacks.onStatus('downloading');

    let stderrTail = '';
    let stdoutTail = '';
    let lastProgress: TorrentProgress | null = null;

    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdoutTail = (stdoutTail + text).slice(-64 * 1024);
        for (const line of text.split(/\r?\n/)) {
          const progress = parseAria2ProgressLine(line);
          if (progress) {
            lastProgress = progress;
            callbacks.onProgress(progress);
          }
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrTail += chunk.toString('utf8');
        if (stderrTail.length > 256 * 1024) stderrTail = stderrTail.slice(-256 * 1024);
      });
      child.on('error', (error) => {
        this.active.delete(taskId);
        const msg =
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? `未找到 aria2c（${this.aria2cPath}）。请将 aria2c.exe 放到 resources/bin 或在设置中指定路径。`
            : error.message;
        callbacks.onStatus('failed', msg);
        reject(new Error(msg));
      });
      child.on('close', (code, signal) => {
        this.active.delete(taskId);
        const intentional = this.killIntent.has(taskId);
        this.killIntent.delete(taskId);
        if (intentional || signal === 'SIGTERM' || signal === 'SIGINT' || code === null) {
          callbacks.onStatus('paused');
          resolve();
          return;
        }
        if (code === 0) {
          if (lastProgress) {
            callbacks.onProgress({ ...lastProgress, doneBytes: lastProgress.totalBytes || lastProgress.doneBytes, speedBps: 0 });
          }
          callbacks.onStatus('completed');
          resolve();
          return;
        }
        const message = `[TorrentEngine] aria2c exit=${code} ${(stderrTail || stdoutTail).slice(-400)}`;
        callbacks.onStatus('failed', message);
        reject(new Error(message));
      });
    });
  }
}
