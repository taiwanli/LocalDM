/**
 * BT/magnet via shared aria2 JSON-RPC daemon (single instance).
 * Pause/cancel map to aria2.pause / aria2.forceRemove; resume = unpause.
 * HTTP split params are NOT applied to BT — use bt-max-peers etc.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isMagnetUrl } from '../../shared/url';

export interface TorrentProgress {
  doneBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number | null;
  connections?: number;
  seeders?: number;
}

export interface TorrentDownloadCallbacks {
  onProgress: (progress: TorrentProgress) => void;
  onStatus: (
    status: 'starting' | 'downloading' | 'completed' | 'failed' | 'paused',
    error?: string,
  ) => void;
  onOutputFile?: (filePath: string) => void;
  onLog?: (line: string) => void;
}

export interface TorrentDownloadOptions {
  saveDir: string;
  source: string;
  limitRateBps?: number;
  maxConnections?: number;
  proxy?: string;
  userDataDir?: string;
  /** Extra trackers (newline/comma separated from settings) */
  extraTrackers?: string[];
  /** Fail when magnet stays at metadata 0B for this many ms (default 180s) */
  metadataTimeoutMs?: number;
}

export const MAGNET_PUBLIC_TRACKERS = [
  'http://tracker.openbittorrent.com:80/announce',
  'http://t.acg.rip:6699/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://p4p.aria2.com:80/announce',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.openwebtorrent.com',
] as const;

export const DEFAULT_METADATA_TIMEOUT_MS = 180_000;
export const ARIA2_RPC_PORT = 6810;

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
  if (!aria2cPath.includes(path.sep) && !aria2cPath.includes('/')) {
    return { available: true, path: aria2cPath };
  }
  return { available: false, path: aria2cPath };
}

/** Merge default + custom trackers into a comma list for aria2 --bt-tracker / option. */
export function mergeTrackers(extra?: string[] | string): string[] {
  const list: string[] = [...MAGNET_PUBLIC_TRACKERS];
  const raw = Array.isArray(extra) ? extra : String(extra || '').split(/[\r\n,;]+/);
  for (const item of raw) {
    const t = item.trim();
    if (!t || t.startsWith('#')) continue;
    if (!list.includes(t)) list.push(t);
  }
  return list;
}

/** Daemon-level args: one shared aria2c for all BT/magnet tasks. */
export function buildAria2DaemonArgs(options: {
  aria2cPath: string;
  port: number;
  secret: string;
  userDataDir: string;
  proxy?: string;
  extraTrackers?: string[];
}): string[] {
  const dhtBase = path.join(options.userDataDir, 'aria2');
  const trackers = mergeTrackers(options.extraTrackers);
  const args = [
    '--enable-rpc=true',
    `--rpc-listen-port=${options.port}`,
    `--rpc-secret=${options.secret}`,
    '--rpc-listen-all=false',
    '--rpc-allow-origin-all=true',
    '--continue=true',
    '--seed-time=0',
    '--file-allocation=none',
    '--async-dns=true',
    '--auto-file-renaming=false',
    '--allow-overwrite=true',
    '--console-log-level=warn',
    '--summary-interval=0',
    // Shared swarm / DHT
    '--enable-dht=true',
    '--enable-peer-exchange=true',
    '--bt-enable-lpd=true',
    '--listen-port=51413-52413',
    '--dht-listen-port=51413-52413',
    `--dht-file-path=${path.join(dhtBase, 'dht.dat')}`,
    `--dht-file-path6=${path.join(dhtBase, 'dht6.dat')}`,
    '--dht-entry-point=dht.transmissionbt.com:6881',
    '--dht-entry-point=router.bittorrent.com:6881',
    '--dht-entry-point=dht.libtorrent.org:25401',
    // BT peer strategy (not HTTP split)
    '--bt-max-peers=128',
    '--bt-request-peer-speed-limit=50K',
    '--bt-save-metadata=true',
    '--bt-load-saved-metadata=true',
    '--max-concurrent-downloads=5',
  ];
  for (const tr of trackers) {
    args.push(`--bt-tracker=${tr}`);
  }
  const proxy = (options.proxy || '').trim();
  if (proxy) args.push(`--all-proxy=${proxy}`);
  void options.aria2cPath;
  return args;
}

/** Per-task RPC option map (aria2 changeOption / addUri options). */
export function buildBtRpcTaskOptions(options: TorrentDownloadOptions): Record<string, string> {
  const trackers = mergeTrackers(options.extraTrackers);
  const opts: Record<string, string> = {
    dir: options.saveDir,
    'seed-time': '0',
    'bt-max-peers': '128',
    'bt-request-peer-speed-limit': '50K',
    'bt-save-metadata': 'true',
    'bt-load-saved-metadata': 'true',
    'follow-torrent': 'true',
    'bt-tracker': trackers.join(','),
  };
  if (options.limitRateBps && options.limitRateBps > 0) {
    opts['max-overall-download-limit'] = String(Math.floor(options.limitRateBps));
  }
  const proxy = (options.proxy || '').trim();
  if (proxy) opts['all-proxy'] = proxy;
  return opts;
}

/** Legacy CLI args for a single magnet (fallback / smoke). No HTTP --split on BT. */
export function buildAria2Args(options: TorrentDownloadOptions): string[] {
  const trackers = mergeTrackers(options.extraTrackers);
  const dhtBase = options.userDataDir
    ? path.join(options.userDataDir, 'aria2')
    : path.join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'LocalDM', 'aria2');
  const args = [
    '--continue=true',
    '--seed-time=0',
    '--max-overall-download-limit=' +
      (options.limitRateBps && options.limitRateBps > 0
        ? String(Math.floor(options.limitRateBps))
        : '0'),
    '--console-log-level=warn',
    '--summary-interval=1',
    '--auto-file-renaming=false',
    '--allow-overwrite=true',
    '--file-allocation=none',
    '--async-dns=true',
    '--dir=' + options.saveDir,
  ];
  const proxy = (options.proxy || '').trim();
  if (proxy) args.push('--all-proxy=' + proxy);
  if (isMagnetUrl(options.source) || options.source.endsWith('.torrent')) {
    args.push(
      '--enable-dht=true',
      '--enable-peer-exchange=true',
      '--bt-enable-lpd=true',
      '--listen-port=51413-52413',
      '--dht-listen-port=51413-52413',
      `--dht-file-path=${path.join(dhtBase, 'dht.dat')}`,
      `--dht-file-path6=${path.join(dhtBase, 'dht6.dat')}`,
      '--bt-max-peers=128',
      '--bt-request-peer-speed-limit=50K',
      '--bt-save-metadata=true',
      '--bt-load-saved-metadata=true',
    );
    for (const tr of trackers) {
      args.push(`--bt-tracker=${tr}`);
    }
  }
  args.push(options.source);
  return args;
}

/** Parse aria2 console summary (CLI mode) / synthetic lines. */
export function parseAria2ProgressLine(line: string): TorrentProgress | null {
  const match = /\[#[^\]]*?([0-9.]+)([KMGT]?i?B)\/([0-9.]+)([KMGT]?i?B)(?:\((\d+)%\))?/i.exec(line);
  if (!match) return null;
  const done = toBytes(Number(match[1]), match[2]);
  const total = toBytes(Number(match[3]), match[4]);
  const dl = /DL:([0-9.]+)([KMGT]?i?B)/i.exec(line);
  const speed = dl ? toBytes(Number(dl[1]), dl[2]) : 0;
  const eta = /ETA:([0-9dhms]+)/i.exec(line);
  const cn = /CN:(\d+)/i.exec(line);
  const sd = /SD:(\d+)/i.exec(line);
  return {
    doneBytes: done,
    totalBytes: total || done,
    speedBps: speed,
    etaSeconds: eta ? parseEta(eta[1]) : null,
    connections: cn ? Number(cn[1]) : undefined,
    seeders: sd ? Number(sd[1]) : undefined,
  };
}

function toBytes(value: number, unit: string): number {
  const u = unit.toUpperCase().replace('I', '');
  const map: Record<string, number> = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
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

export async function aria2RpcCall<T = unknown>(
  port: number,
  secret: string,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const body = {
    jsonrpc: '2.0',
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    method,
    params: [`token:${secret}`, ...params],
  };
  const res = await fetch(`http://127.0.0.1:${port}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`[Aria2Rpc] HTTP ${res.status} ${method}`);
  }
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) {
    throw new Error(`[Aria2Rpc] ${method}: ${json.error.message || 'error'}`);
  }
  return json.result as T;
}

interface Aria2TellStatus {
  gid: string;
  status: string;
  completedLength: string;
  totalLength: string;
  downloadSpeed: string;
  uploadSpeed: string;
  connections?: string;
  numSeeders?: string;
  files?: { path: string; completedLength: string; length: string }[];
  errorMessage?: string;
  followedBy?: string[];
}

/** Shared aria2 RPC daemon for all BT tasks. */
export class Aria2RpcDaemon {
  private child: ChildProcessWithoutNullStreams | null = null;
  private secret = '';
  private port = ARIA2_RPC_PORT;
  private aria2cPath = '';
  private userDataDir = '';
  private proxy = '';
  private extraTrackers: string[] = [];
  private starting: Promise<void> | null = null;
  private gidByTask = new Map<string, string>();
  private taskByGid = new Map<string, string>();

  get rpcPort(): number {
    return this.port;
  }

  get rpcSecret(): string {
    return this.secret;
  }

  mapTaskGid(taskId: string, gid: string): void {
    this.gidByTask.set(taskId, gid);
    this.taskByGid.set(gid, taskId);
  }

  unmapTask(taskId: string): void {
    const gid = this.gidByTask.get(taskId);
    if (gid) this.taskByGid.delete(gid);
    this.gidByTask.delete(taskId);
  }

  getGid(taskId: string): string | undefined {
    return this.gidByTask.get(taskId);
  }

  async ensureStarted(options: {
    aria2cPath: string;
    userDataDir: string;
    proxy?: string;
    extraTrackers?: string[];
  }): Promise<{ port: number; secret: string }> {
    this.aria2cPath = options.aria2cPath;
    this.userDataDir = options.userDataDir;
    this.proxy = (options.proxy || '').trim();
    this.extraTrackers = options.extraTrackers || [];
    if (this.child && !this.child.killed && this.secret) {
      try {
        await aria2RpcCall(this.port, this.secret, 'aria2.getVersion');
        return { port: this.port, secret: this.secret };
      } catch {
        /* restart */
      }
    }
    if (this.starting) {
      await this.starting;
      return { port: this.port, secret: this.secret };
    }
    this.starting = this.start(options);
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
    return { port: this.port, secret: this.secret };
  }

  private async start(options: {
    aria2cPath: string;
    userDataDir: string;
    proxy?: string;
    extraTrackers?: string[];
  }): Promise<void> {
    const dhtBase = path.join(options.userDataDir, 'aria2');
    await fsp.mkdir(dhtBase, { recursive: true });
    this.secret = randomUUID().replace(/-/g, '');
    this.port = ARIA2_RPC_PORT;
    const args = buildAria2DaemonArgs({
      aria2cPath: options.aria2cPath,
      port: this.port,
      secret: this.secret,
      userDataDir: options.userDataDir,
      proxy: options.proxy,
      extraTrackers: options.extraTrackers,
    });
    const child = spawn(options.aria2cPath, args, {
      windowsHide: true,
      cwd: options.userDataDir,
      env: { ...process.env },
    });
    this.child = child;
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-64 * 1024);
    });
    child.on('exit', () => {
      if (this.child === child) this.child = null;
    });
    // Wait until RPC responds
    const deadline = Date.now() + 8000;
    for (;;) {
      if (!this.child) {
        throw new Error(
          `[Aria2Rpc] daemon exited: ${(stderr || 'no stderr').slice(-240)}`,
        );
      }
      try {
        await aria2RpcCall(this.port, this.secret, 'aria2.getVersion');
        return;
      } catch {
        if (Date.now() > deadline) {
          throw new Error(
            `[Aria2Rpc] RPC not ready on ${this.port}: ${(stderr || '').slice(-200)}`,
          );
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    if (!this.secret) throw new Error('[Aria2Rpc] daemon not started');
    return aria2RpcCall<T>(this.port, this.secret, method, params);
  }

  async shutdown(): Promise<void> {
    try {
      if (this.secret) await this.call('aria2.shutdown').catch(() => undefined);
    } catch {
      /* ignore */
    }
    this.child?.kill();
    this.child = null;
    this.gidByTask.clear();
    this.taskByGid.clear();
  }
}

let daemonSingleton: Aria2RpcDaemon | null = null;

export function getAria2Daemon(): Aria2RpcDaemon {
  if (!daemonSingleton) daemonSingleton = new Aria2RpcDaemon();
  return daemonSingleton;
}

export class TorrentEngine {
  private active = new Map<string, ChildProcessWithoutNullStreams | 'rpc'>();
  private killIntent = new Set<string>();
  private pausedTasks = new Set<string>();
  private aria2cPath: string;
  private userDataDir = '';
  private proxy = '';
  private extraTrackers: string[] = [];
  private metadataTimeoutMs = DEFAULT_METADATA_TIMEOUT_MS;

  constructor(aria2cPath: string) {
    this.aria2cPath = aria2cPath;
  }

  configure(options: {
    userDataDir?: string;
    proxy?: string;
    extraTrackers?: string[];
    metadataTimeoutMs?: number;
    aria2cPath?: string;
  }): void {
    if (options.aria2cPath) this.aria2cPath = options.aria2cPath;
    if (options.userDataDir) this.userDataDir = options.userDataDir;
    if (options.proxy !== undefined) this.proxy = (options.proxy || '').trim();
    if (options.extraTrackers) this.extraTrackers = options.extraTrackers;
    if (options.metadataTimeoutMs && options.metadataTimeoutMs > 0) {
      this.metadataTimeoutMs = options.metadataTimeoutMs;
    }
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

  isPaused(taskId: string): boolean {
    return this.pausedTasks.has(taskId);
  }

  pause(taskId: string): void {
    const daemon = getAria2Daemon();
    const gid = daemon.getGid(taskId);
    if (gid) {
      // Keep gid + poll loop so resume can unpause without re-addUri
      this.pausedTasks.add(taskId);
      void daemon.call('aria2.forcePause', [gid]).catch(() => undefined);
      return;
    }
    this.killIntent.add(taskId);
    const proc = this.active.get(taskId);
    if (proc && proc !== 'rpc') proc.kill();
  }

  cancel(taskId: string): void {
    this.killIntent.add(taskId);
    this.pausedTasks.delete(taskId);
    const daemon = getAria2Daemon();
    const gid = daemon.getGid(taskId);
    if (gid) {
      void daemon.call('aria2.forceRemove', [gid]).catch(() => undefined);
      daemon.unmapTask(taskId);
      this.active.delete(taskId);
      return;
    }
    const proc = this.active.get(taskId);
    if (proc && proc !== 'rpc') proc.kill();
  }

  async resumeRpc(taskId: string): Promise<boolean> {
    const daemon = getAria2Daemon();
    const gid = daemon.getGid(taskId);
    if (!gid) return false;
    this.killIntent.delete(taskId);
    this.pausedTasks.delete(taskId);
    await daemon.call('aria2.unpause', [gid]);
    this.active.set(taskId, 'rpc');
    return true;
  }

  async shutdown(): Promise<void> {
    await getAria2Daemon().shutdown();
    this.active.clear();
    this.pausedTasks.clear();
  }

  /** Shared-RPC download path (primary). */
  async download(
    taskId: string,
    options: TorrentDownloadOptions,
    callbacks: TorrentDownloadCallbacks,
  ): Promise<void> {
    if (
      !isMagnetUrl(options.source) &&
      !fs.existsSync(options.source) &&
      !/^https?:/i.test(options.source)
    ) {
      throw new Error(`[TorrentEngine] invalid source: ${options.source.slice(0, 80)}`);
    }
    await fsp.mkdir(options.saveDir, { recursive: true });
    this.configure({
      userDataDir: options.userDataDir,
      proxy: options.proxy,
      extraTrackers: options.extraTrackers,
      metadataTimeoutMs: options.metadataTimeoutMs,
    });
    const userDataDir = options.userDataDir || this.userDataDir || process.cwd();
    const daemon = getAria2Daemon();
    const timeoutMs = options.metadataTimeoutMs || this.metadataTimeoutMs;

    // Re-attach to existing RPC gid (pause/resume path) instead of duplicate addUri
    const existingGid = daemon.getGid(taskId);
    if (existingGid && this.active.has(taskId)) {
      try {
        const st = await daemon.call<Aria2TellStatus>('aria2.tellStatus', [existingGid]);
        if (st.status === 'paused') {
          await this.resumeRpc(taskId);
        } else if (st.status === 'removed' || st.status === 'error' || st.status === 'complete') {
          daemon.unmapTask(taskId);
          this.active.delete(taskId);
        } else {
          callbacks.onStatus('downloading');
          await this.watchRpcGid(
            taskId,
            existingGid,
            timeoutMs,
            Number(st.completedLength || 0) > 0 || Number(st.totalLength || 0) > 0,
            callbacks,
          );
          return;
        }
      } catch {
        daemon.unmapTask(taskId);
        this.active.delete(taskId);
      }
    }
    if (this.active.has(taskId)) {
      throw new Error(`[TorrentEngine] task already running id=${taskId}`);
    }

    callbacks.onStatus('starting');
    let rpc: { port: number; secret: string };
    try {
      rpc = await daemon.ensureStarted({
        aria2cPath: this.aria2cPath,
        userDataDir,
        proxy: options.proxy || this.proxy,
        extraTrackers: options.extraTrackers || this.extraTrackers,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callbacks.onLog?.(`RPC 启动失败，回退单进程 aria2：${message}`);
      return this.downloadCli(taskId, options, callbacks);
    }
    void rpc;

    const taskOpts = buildBtRpcTaskOptions({
      ...options,
      userDataDir,
      extraTrackers: options.extraTrackers || this.extraTrackers,
      proxy: options.proxy || this.proxy,
    });

    let gid: string;
    try {
      if (isMagnetUrl(options.source) || /^https?:/i.test(options.source)) {
        gid = String(await daemon.call('aria2.addUri', [[options.source], taskOpts]));
      } else {
        const b64 = (await fsp.readFile(options.source)).toString('base64');
        gid = String(await daemon.call('aria2.addTorrent', [b64, [], taskOpts]));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callbacks.onStatus('failed', message);
      throw new Error(message);
    }
    daemon.mapTaskGid(taskId, gid);
    this.active.set(taskId, 'rpc');
    this.pausedTasks.delete(taskId);
    this.killIntent.delete(taskId);
    callbacks.onStatus('downloading');
    callbacks.onLog?.(`RPC gid=${gid} dir=${options.saveDir}`);
    await this.watchRpcGid(taskId, gid, timeoutMs, false, callbacks);
  }

  private async watchRpcGid(
    taskId: string,
    gid: string,
    timeoutMs: number,
    sawBytesInitial: boolean,
    callbacks: TorrentDownloadCallbacks,
  ): Promise<void> {
    const daemon = getAria2Daemon();
    const startedAt = Date.now();
    let lastProgress: TorrentProgress | null = null;
    let sawBytes = sawBytesInitial;
    let done = false;

    await new Promise<void>((resolve, reject) => {
      const finish = (status: 'completed' | 'failed' | 'paused', error?: string) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        if (status === 'paused') {
          // Keep gid mapping for resume; only stop poll when cancelled/removed
          resolve();
          return;
        }
        this.active.delete(taskId);
        this.pausedTasks.delete(taskId);
        daemon.unmapTask(taskId);
        if (status === 'completed') {
          if (lastProgress) {
            callbacks.onProgress({
              ...lastProgress,
              doneBytes: lastProgress.totalBytes || lastProgress.doneBytes,
              speedBps: 0,
            });
          }
          callbacks.onStatus('completed');
          resolve();
          return;
        }
        callbacks.onStatus('failed', error);
        reject(new Error(error || 'bt failed'));
      };

      const timer = setInterval(() => {
        void (async () => {
          try {
            const st = await daemon.call<Aria2TellStatus>('aria2.tellStatus', [gid]);
            const doneBytes = Number(st.completedLength || 0);
            const totalBytes = Number(st.totalLength || 0);
            const speedBps = Number(st.downloadSpeed || 0);
            const connections = Number(st.connections || 0);
            const seeders = Number(st.numSeeders || 0);
            if (doneBytes > 0 || totalBytes > 0) sawBytes = true;
            lastProgress = {
              doneBytes,
              totalBytes: totalBytes || doneBytes,
              speedBps,
              etaSeconds:
                speedBps > 0 && totalBytes > doneBytes
                  ? Math.ceil((totalBytes - doneBytes) / speedBps)
                  : null,
              connections,
              seeders,
            };
            callbacks.onProgress(lastProgress);
            if (st.status === 'complete') {
              const file = st.files?.find((f) => f.path && !f.path.endsWith('.aria2'));
              if (file?.path) callbacks.onOutputFile?.(file.path);
              finish('completed');
              return;
            }
            if (st.status === 'error') {
              finish('failed', st.errorMessage || `[TorrentEngine] aria2 error gid=${gid}`);
              return;
            }
            if (st.status === 'removed') {
              if (this.killIntent.has(taskId)) {
                this.active.delete(taskId);
                daemon.unmapTask(taskId);
                this.pausedTasks.delete(taskId);
                done = true;
                clearInterval(timer);
                callbacks.onStatus('paused');
                resolve();
              } else {
                finish('failed', `[TorrentEngine] aria2 removed gid=${gid}`);
              }
              return;
            }
            if (st.status === 'paused') {
              if (!this.pausedTasks.has(taskId)) {
                this.pausedTasks.add(taskId);
                callbacks.onStatus('paused');
              }
              return;
            }
            if ((st.status === 'active' || st.status === 'waiting') && this.pausedTasks.has(taskId)) {
              this.pausedTasks.delete(taskId);
              callbacks.onStatus('downloading');
            }
            // Metadata stall only while not paused
            if (!this.pausedTasks.has(taskId) && !sawBytes && Date.now() - startedAt >= timeoutMs) {
              await daemon.call('aria2.forceRemove', [gid]).catch(() => undefined);
              finish(
                'failed',
                `[TorrentEngine] 磁力元数据超时（${Math.round(timeoutMs / 1000)}s）：CN:${connections} SD:${seeders}。资源可能无做种或网络无法连通 DHT/Tracker。可在设置中补充 Tracker 或改用完整磁力链。`,
              );
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/not found|GID|cannot find/i.test(message)) {
              if (this.killIntent.has(taskId) || this.pausedTasks.has(taskId)) {
                this.active.delete(taskId);
                this.pausedTasks.delete(taskId);
                daemon.unmapTask(taskId);
                done = true;
                clearInterval(timer);
                callbacks.onStatus('paused');
                resolve();
              } else {
                finish('failed', message);
              }
            }
          }
        })();
      }, 1000);
    });
  }

  /** CLI fallback: one aria2c process per task. */
  private async downloadCli(
    taskId: string,
    options: TorrentDownloadOptions,
    callbacks: TorrentDownloadCallbacks,
  ): Promise<void> {
    const args = buildAria2Args({
      ...options,
      userDataDir: options.userDataDir || this.userDataDir,
      proxy: options.proxy || this.proxy,
      extraTrackers: options.extraTrackers || this.extraTrackers,
    });
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
    const timeoutMs = options.metadataTimeoutMs || this.metadataTimeoutMs;
    const startedAt = Date.now();
    let sawBytes = false;

    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdoutTail = (stdoutTail + text).slice(-64 * 1024);
        callbacks.onLog?.(text.trim());
        for (const line of text.split(/\r?\n/)) {
          const progress = parseAria2ProgressLine(line);
          if (progress) {
            if (progress.doneBytes > 0 || (progress.totalBytes && progress.totalBytes > 0)) {
              sawBytes = true;
            }
            lastProgress = progress;
            callbacks.onProgress(progress);
          }
        }
        if (!sawBytes && Date.now() - startedAt >= timeoutMs) {
          child.kill();
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrTail += chunk.toString('utf8');
        callbacks.onLog?.(chunk.toString('utf8').trim());
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
        if (!sawBytes && !intentional && Date.now() - startedAt >= timeoutMs) {
          callbacks.onStatus(
            'failed',
            `[TorrentEngine] 磁力元数据超时：长时间无节点/无做种，已停止 aria2 进程。`,
          );
          reject(new Error('[TorrentEngine] magnet metadata timeout'));
          return;
        }
        if (intentional || signal === 'SIGTERM' || signal === 'SIGINT' || code === null) {
          callbacks.onStatus('paused');
          resolve();
          return;
        }
        if (code === 0) {
          if (lastProgress) {
            callbacks.onProgress({
              ...lastProgress,
              doneBytes: lastProgress.totalBytes || lastProgress.doneBytes,
              speedBps: 0,
            });
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
