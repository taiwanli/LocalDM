/**
 * HTTP Range download engine.
 * Resume policy: sidecar + remote ETag/Last-Modified/Content-Length must match;
 * mismatch restarts the task instead of appending stale bytes.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { DownloadTask, SegmentProgress } from "../../shared/types";
import { SpeedGovernor } from "./speedGovernor";
import { applyContentTypeExtension, uniqueFilename } from "../../shared/url";
import {
  adaptiveCooldownMs,
  isRateLimitStatus as isLimitedStatus,
  nextAdaptiveConnections,
  rateLimitHint,
} from "../../shared/limits";

export interface ProbeResult {
  url: string;
  size: number;
  acceptRanges: boolean;
  etag: string | null;
  lastModified: string | null;
  filename: string | null;
  contentType: string | null;
}

export interface EngineCallbacks {
  onProgress: (
    taskId: string,
    doneBytes: number,
    segments: SegmentProgress[],
    speedBps: number,
  ) => void;
  onStatus: (taskId: string, status: DownloadTask["status"], error?: string) => void;
  onAdaptive?: (
    taskId: string,
    info: { effectiveConnections: number; message: string },
  ) => void;
  onPathResolved?: (taskId: string, savePath: string, filename: string) => void;
}

export interface EngineOptions {
  maxConnections: number;
  minSegmentBytes: number;
  sidecarDir: string;
  flushIntervalMs?: number;
  /** 0 = unlimited; shared across tasks on this engine instance. */
  globalSpeedLimitBps?: number;
  speedGovernor?: SpeedGovernor;
  /** 0 = unlimited; only applies to this download run. */
  taskSpeedLimitBps?: number;
  /** Cap concurrent workers against a single host; defaults to maxConnections. */
  maxConnectionsPerServer?: number;
  /** Cap connections for HuggingFace-like hosts without Authorization (default 4). */
  hfConnectionCap?: number;
  workerStaggerMs?: number;
  requestGapMs?: number;
  probeCooldownMs?: number;
  probeMaxRounds?: number;
  /** Auto-degrade connections on WAF/rate-limit (567/403/429…). */
  adaptiveDegrade?: boolean;
}

export function planSegments(
  size: number,
  maxConnections: number,
  minSegmentBytes: number,
): SegmentProgress[] {
  if (size <= 0 || maxConnections <= 1) {
    return [{ start: 0, end: Math.max(size, 0), done: 0 }];
  }
  const maxSegs = Math.max(1, Math.min(maxConnections, 64));
  const ideal = Math.max(minSegmentBytes, Math.ceil(size / maxSegs));
  const count = Math.max(1, Math.min(maxSegs, Math.ceil(size / ideal)));
  const segs: SegmentProgress[] = [];
  const step = Math.ceil(size / count);
  for (let index = 0; index < count; index += 1) {
    const start = index * step;
    const end = Math.min(size, (index + 1) * step);
    if (start >= end) break;
    segs.push({ start, end, done: 0 });
  }
  return segs.length ? segs : [{ start: 0, end: size, done: 0 }];
}

export function sumDone(segments: SegmentProgress[]): number {
  return segments.reduce((total, segment) => total + segment.done, 0);
}

function headerMap(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw.slice(0, 60);
  }
}

function parseContentRangeSize(contentRange: string | null): number {
  if (!contentRange) return 0;
  const match = /\/(\d+)\s*$/.exec(contentRange);
  return match ? Number(match[1]) : 0;
}

function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* ignore decode errors and fall back */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1].trim() : null;
}

interface SidecarFile {
  url: string;
  etag: string | null;
  lastModified: string | null;
  totalLength: number;
  segments: SegmentProgress[];
  partPath: string;
  updatedAt: string;
}

function sidecarPathFor(sidecarDir: string, taskId: string): string {
  return path.join(sidecarDir, `${taskId}.meta.json`);
}

async function writeSidecar(sidecarDir: string, taskId: string, data: SidecarFile): Promise<void> {
  const file = sidecarPathFor(sidecarDir, taskId);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
        await new Promise((resolve) => setTimeout(resolve, 20 + attempt * 20));
        continue;
      }
      try {
        await fsp.writeFile(file, JSON.stringify(data, null, 2), "utf8");
        await fsp.rm(tmp, { force: true });
        return;
      } catch (fallbackError) {
        throw fallbackError;
      }
    }
  }
  await fsp.writeFile(file, JSON.stringify(data, null, 2), "utf8");
  await fsp.rm(tmp, { force: true }).catch(() => undefined);
}

async function readSidecar(sidecarDir: string, taskId: string): Promise<SidecarFile | null> {
  try {
    const raw = await fsp.readFile(sidecarPathFor(sidecarDir, taskId), "utf8");
    return JSON.parse(raw) as SidecarFile;
  } catch {
    return null;
  }
}

export function canResumeFromSidecar(
  sidecar: SidecarFile | null,
  remote: { size: number; etag: string | null; lastModified: string | null },
): boolean {
  if (!sidecar) return false;
  if (remote.size > 0 && sidecar.totalLength !== remote.size) return false;
  if (sidecar.etag && remote.etag && sidecar.etag !== remote.etag) return false;
  if (
    !sidecar.etag &&
    !remote.etag &&
    sidecar.lastModified &&
    remote.lastModified &&
    sidecar.lastModified !== remote.lastModified
  ) {
    return false;
  }
  return true;
}

/** Browser-like defaults so CDNs do not reject empty Node clients. */
const DEFAULT_DOWNLOAD_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Encoding": "identity",
};

export function mergeDownloadHeaders(
  user?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...DEFAULT_DOWNLOAD_HEADERS };
  if (user) {
    for (const key of Object.keys(user)) {
      const existing = Object.keys(headers).find(
        (item) => item.toLowerCase() === key.toLowerCase(),
      );
      if (existing) delete headers[existing];
      headers[key] = user[key];
    }
  }
  return headers;
}

export function probeErrorHint(status: number): string {
  if (status === 401 || status === 403) {
    return "（需要登录/授权，或 CDN 拒绝匿名探测；可配置 Cookie/Token）";
  }
  if (status === 404) return "（文件不存在或链接已失效）";
  if (status === 429 || status === 567) {
    return "（请求过于频繁/网关限流，请降低并发或稍后重试）";
  }
  if (status >= 500) return "（服务器错误，请稍后再试）";
  return "";
}

export function isRateLimitedStatus(status: number): boolean {
  return isLimitedStatus(status);
}

function buildRequestHeaders(
  base: Record<string, string>,
  range?: { start: number; end?: number },
): Record<string, string> {
  const headers: Record<string, string> = mergeDownloadHeaders(base);
  if (range) {
    // Open-ended ranges are valid and required by some signed CDNs.
    headers.Range =
      range.end === undefined || range.end === null
        ? `bytes=${range.start}-`
        : `bytes=${range.start}-${range.end}`;
  }
  return headers;
}

async function readBodyToPosition(
  response: Response,
  handle: fsp.FileHandle,
  absoluteStart: number,
  onBytes: (delta: number) => void,
  signal: AbortSignal,
  throttle?: (bytes: number) => Promise<void>,
): Promise<void> {
  if (!response.body) {
    throw new Error("empty response body");
  }
  const nodeStream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  let position = absoluteStart;
  for await (const chunk of nodeStream) {
    if (signal.aborted) {
      nodeStream.destroy();
      throw new Error("aborted");
    }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer);
    await handle.write(buffer, 0, buffer.length, position);
    position += buffer.length;
    onBytes(buffer.length);
    if (throttle) {
      await throttle(buffer.length);
      if (signal.aborted) {
        nodeStream.destroy();
        throw new Error("aborted");
      }
    }
  }
}

interface ActiveJob {
  taskId: string;
  abort: AbortController;
}

export class RangeEngine {
  private readonly active = new Map<string, ActiveJob>();
  private readonly speedGovernor: SpeedGovernor;
  private readonly taskSpeedGovernors = new Map<string, SpeedGovernor>();

  constructor(private readonly options: EngineOptions) {
    this.speedGovernor =
      options.speedGovernor ?? new SpeedGovernor(options.globalSpeedLimitBps ?? 0);
  }

  setGlobalSpeedLimit(limitBps: number): void {
    this.speedGovernor.setLimit(limitBps);
  }

  getGlobalSpeedLimit(): number {
    return this.speedGovernor.getLimit();
  }

  setTaskSpeedLimit(taskId: string, limitBps: number): void {
    const next = Math.max(0, Math.floor(limitBps));
    const existing = this.taskSpeedGovernors.get(taskId);
    if (existing) {
      existing.setLimit(next);
      return;
    }
    if (next > 0) {
      this.taskSpeedGovernors.set(taskId, new SpeedGovernor(next));
    }
  }

  private ensureTaskGovernor(taskId: string, limitBps?: number): SpeedGovernor {
    const existing = this.taskSpeedGovernors.get(taskId);
    if (limitBps === undefined) {
      if (existing) return existing;
      const created = new SpeedGovernor(0);
      this.taskSpeedGovernors.set(taskId, created);
      return created;
    }
    const next = Math.max(0, Math.floor(limitBps));
    if (existing) {
      existing.setLimit(next);
      return existing;
    }
    const created = new SpeedGovernor(next);
    this.taskSpeedGovernors.set(taskId, created);
    return created;
  }

  async probe(url: string, headers: Record<string, string> = {}): Promise<ProbeResult> {
    const merged = buildRequestHeaders(headers);
    let currentUrl = url;
    let lastStatus = 0;

    for (let hop = 0; hop <= 6; hop += 1) {
      // Open-ended GET Range (not bytes=0-0 / HEAD-only): some signed CDNs bind
      // the first Range policy and reject later segments after a 0-0 probe.
      let response = await fetch(currentUrl, {
        method: "GET",
        headers: { ...merged, Range: "bytes=0-" },
        redirect: "manual",
      });
      lastStatus = response.status;

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) {
          throw new Error(
            `[RangeEngine] probe redirect without location status=${response.status}`,
          );
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (response.status === 416) {
        await response.body?.cancel().catch(() => undefined);
        response = await fetch(currentUrl, {
          method: "GET",
          headers: merged,
          redirect: "manual",
        });
        lastStatus = response.status;
      }

      if (response.status >= 400) {
        const host = safeHost(currentUrl);
        await response.body?.cancel().catch(() => undefined);
        throw new Error(
          `[RangeEngine] probe failed status=${response.status} host=${host}${probeErrorHint(response.status)}`,
        );
      }

      const map = headerMap(response.headers);
      let size = 0;
      let acceptRanges = false;
      const contentRange = map["content-range"] ?? null;
      if (contentRange) {
        const total = parseContentRangeSize(contentRange);
        if (total > 0) {
          size = total;
          acceptRanges = true;
        }
      }
      if (!size && map["content-length"] != null) {
        size = Number(map["content-length"]) || 0;
      }
      if (response.status === 206) acceptRanges = true;
      else if (response.status === 200) {
        acceptRanges = (map["accept-ranges"] ?? "").toLowerCase().includes("bytes");
      }
      await response.body?.cancel().catch(() => undefined);

      return {
        url: currentUrl,
        size,
        acceptRanges,
        etag: map["etag"] ?? null,
        lastModified: map["last-modified"] ?? null,
        filename: filenameFromDisposition(map["content-disposition"] ?? null),
        contentType: map["content-type"] ?? null,
      };
    }

    throw new Error(
      `[RangeEngine] too many redirects status=${lastStatus} url=${url.slice(0, 80)}`,
    );
  }

  private ensureNotRunning(taskId: string): void {
    if (this.active.has(taskId)) {
      throw new Error(`[RangeEngine] task already running id=${taskId}`);
    }
  }

  async start(
    task: DownloadTask,
    callbacks: EngineCallbacks,
    options?: Partial<EngineOptions>,
  ): Promise<void> {
    this.ensureNotRunning(task.id);
    const merged: EngineOptions = { ...this.options, ...options };
    await this.runTask(task, callbacks, merged, false);
  }

  async resume(
    task: DownloadTask,
    callbacks: EngineCallbacks,
    options?: Partial<EngineOptions>,
  ): Promise<void> {
    this.ensureNotRunning(task.id);
    const merged: EngineOptions = { ...this.options, ...options };
    await this.runTask(task, callbacks, merged, true);
  }

  async pause(taskId: string): Promise<void> {
    this.active.get(taskId)?.abort.abort();
  }

  async cancel(taskId: string): Promise<void> {
    this.active.get(taskId)?.abort.abort();
  }

  isRunning(taskId: string): boolean {
    return this.active.has(taskId);
  }

  private async runTask(
    task: DownloadTask,
    callbacks: EngineCallbacks,
    options: EngineOptions,
    isResume: boolean,
  ): Promise<void> {
    const abort = new AbortController();
    this.active.set(task.id, { taskId: task.id, abort });
    const flushIntervalMs = options.flushIntervalMs ?? 500;
    let lastFlushAt = 0;
    let windowBytes = 0;
    let windowStartedAt = Date.now();

    try {
      callbacks.onStatus(task.id, "probing");
      let probe: ProbeResult | null = null;
      let probeRound = 0;
      while (!probe) {
        try {
          probe = await this.probe(task.url, task.headers);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const statusMatch = /status=(\d+)/.exec(message);
          const status = statusMatch ? Number(statusMatch[1]) : 0;
          probeRound += 1;
          const maxRounds = options.probeMaxRounds ?? 4;
          const baseWait = options.probeCooldownMs ?? 8000;
          if (!isRateLimitedStatus(status) || probeRound > maxRounds) throw error;
          const wait = Math.min(baseWait * 2 ** (probeRound - 1), 120000);
          callbacks.onStatus(task.id, "probing");
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
      }
      if (probe.size <= 0 && !probe.acceptRanges) {
        throw new Error(`[RangeEngine] cannot determine remote size url=${task.url}`);
      }
      const downloadUrlRef = { url: probe.url || task.url };
      const hasAuthHeader = Object.keys(task.headers || {}).some(
        (key) => key.toLowerCase() === "authorization",
      );
      const isHf =
        /huggingface\.co|hf\.co|cdn-lfs|xet-bridge/i.test(task.url) ||
        /huggingface\.co|hf\.co|cdn-lfs|xet-bridge/i.test(downloadUrlRef.url);
      // Signed CDNs that bind the first Range policy: each segment should start
      // from the original URL so the edge can re-sign for this exact Range.
      const rangeLockedCdn =
        isHf || /xet-bridge|cdn-lfs|ByteRange/i.test(decodeURIComponent(downloadUrlRef.url));
      const hfCap =
        options.hfConnectionCap != null && options.hfConnectionCap > 0
          ? options.hfConnectionCap
          : 4;
      const startConnections =
        isHf && !hasAuthHeader
          ? Math.max(1, Math.min(options.maxConnections, hfCap))
          : options.maxConnections;
      const adaptiveOn = options.adaptiveDegrade !== false;
      const live = { connections: startConnections, rlRound: 0, cooldown: null as Promise<void> | null };
      callbacks.onAdaptive?.(task.id, {
        effectiveConnections: live.connections,
        message: `effectiveConnections=${live.connections}`,
      });

      const saveDir = path.dirname(task.savePath);
      await fsp.mkdir(saveDir, { recursive: true });
      let resolvedName = path.basename(task.savePath);
      let resolvedPath = task.savePath;
      const sidecar = isResume ? await readSidecar(options.sidecarDir, task.id) : null;
      const resumeOk = isResume && canResumeFromSidecar(sidecar, probe);
      if (!resumeOk) {
        const generic = !resolvedName || /^download(_\d+)?(\.[^.]+)?$/i.test(resolvedName);
        if (probe.filename && (generic || !/\.[A-Za-z0-9]{1,12}$/.test(resolvedName))) {
          resolvedName = probe.filename;
        }
        resolvedName = applyContentTypeExtension(resolvedName, probe.contentType);
        resolvedName = uniqueFilename(saveDir, resolvedName, (p) => {
          return fs.existsSync(p) || fs.existsSync(`${p}.part`);
        });
        resolvedPath = path.join(saveDir, resolvedName);
        if (resolvedPath !== task.savePath) {
          callbacks.onPathResolved?.(task.id, resolvedPath, resolvedName);
        }
      }
      const partPath = `${resolvedPath}.part`;

      let segments: SegmentProgress[];
      if (resumeOk && sidecar) {
        segments = sidecar.segments.map((segment) => ({ ...segment }));
      } else {
        if (isResume) {
          await fsp.rm(partPath, { force: true });
        }
        segments = probe.acceptRanges
          ? planSegments(probe.size, live.connections, options.minSegmentBytes)
          : [{ start: 0, end: probe.size, done: 0 }];
      }

      const totalLength = resumeOk && sidecar ? sidecar.totalLength : probe.size;
      const handle = await fsp.open(partPath, fs.constants.O_RDWR | fs.constants.O_CREAT);
      const persist = async (force = false) => {
        const now = Date.now();
        if (!force && now - lastFlushAt < flushIntervalMs) return;
        lastFlushAt = now;
        const snapshot: SidecarFile = {
          url: task.url,
          etag: probe.etag,
          lastModified: probe.lastModified,
          totalLength,
          segments: segments.map((segment) => ({ ...segment })),
          partPath,
          updatedAt: new Date().toISOString(),
        };
        await writeSidecar(options.sidecarDir, task.id, snapshot);
      };

      callbacks.onStatus(task.id, "downloading");
      await persist(true);

      const taskGovernor = this.ensureTaskGovernor(
        task.id,
        options.taskSpeedLimitBps !== undefined ? options.taskSpeedLimitBps : task.speedLimitBps,
      );
      const queue = segments.filter((segment) => segment.start + segment.done < segment.end);
      const perServer =
        options.maxConnectionsPerServer && options.maxConnectionsPerServer > 0
          ? options.maxConnectionsPerServer
          : options.maxConnections;
      const workerCount = Math.max(
        1,
        Math.min(
          queue.length || 1,
          live.connections,
          Math.min(perServer, live.connections),
          64,
        ),
      );
      const minSplit = Math.max(64 * 1024, options.minSegmentBytes);
      const activeSegments = new Set<SegmentProgress>();

      const sharedBackoff = async (status: number, segment: SegmentProgress): Promise<void> => {
        if (!adaptiveOn) {
          await new Promise((r) => setTimeout(r, adaptiveCooldownMs(1, options.probeCooldownMs ?? 8000)));
          return;
        }
        if (live.cooldown) {
          await live.cooldown;
          return;
        }
        live.rlRound += 1;
        const maxRounds = options.probeMaxRounds ?? 3;
        if (live.rlRound > maxRounds) {
          throw new Error(
            `[RangeEngine] rate-limit cooldown exhausted status=${status} taskId=${task.id}`,
          );
        }
        const before = live.connections;
        live.connections = nextAdaptiveConnections(before);
        const wait = adaptiveCooldownMs(live.rlRound, options.probeCooldownMs ?? 3000);
        const message = `${rateLimitHint(status)}；连接 ${before}→${live.connections}，冷却第 ${live.rlRound} 轮 ${Math.round(wait / 1000)}s`;
        callbacks.onAdaptive?.(task.id, {
          effectiveConnections: live.connections,
          message,
        });
        callbacks.onStatus(task.id, "downloading", message);
        live.cooldown = (async () => {
          await new Promise((r) => setTimeout(r, wait));
          // Re-probe original URL for a fresh CDN signature when possible.
          try {
            const re = await this.probe(task.url, task.headers);
            if (re.url) downloadUrlRef.url = re.url;
          } catch {
            /* keep last url */
          }
          live.cooldown = null;
        })();
        await live.cooldown;
        void segment;
      };

      const remainingOf = (segment: SegmentProgress): number =>
        Math.max(0, segment.end - (segment.start + segment.done));

      const claimWork = (): SegmentProgress | null => {
        while (queue.length) {
          const next = queue.shift();
          if (!next) break;
          if (remainingOf(next) > 0) {
            activeSegments.add(next);
            return next;
          }
        }
        let largest: SegmentProgress | null = null;
        let largestRemaining = 0;
        for (const segment of segments) {
          if (activeSegments.has(segment)) continue;
          const remaining = remainingOf(segment);
          if (remaining > largestRemaining) {
            largest = segment;
            largestRemaining = remaining;
          }
        }
        if (!largest || largestRemaining <= 0) return null;
        if (largestRemaining >= minSplit * 2) {
          const start = largest.start + largest.done;
          const mid = start + Math.floor(largestRemaining / 2);
          const originalEnd = largest.end;
          largest.end = mid;
          const spawned: SegmentProgress = { start: mid, end: originalEnd, done: 0 };
          segments.push(spawned);
          activeSegments.add(spawned);
          return spawned;
        }
        // Too small to bisect — claim the idle remainder so workers do not exit early.
        activeSegments.add(largest);
        return largest;
      };

      const downloadSegment = async (segment: SegmentProgress): Promise<void> => {
        activeSegments.add(segment);
        try {
          while (segment.start + segment.done < segment.end) {
            if (abort.signal.aborted) throw new Error("aborted");
            const start = segment.start + segment.done;
            const end = segment.end - 1;
            let response: Response;
            try {
              const segmentUrl = rangeLockedCdn ? task.url : downloadUrlRef.url;
              response = await fetch(segmentUrl, {
                method: "GET",
                headers: buildRequestHeaders(task.headers, { start, end }),
                redirect: "follow",
                signal: abort.signal,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (abort.signal.aborted) throw new Error("aborted");
              // Network/stack errors are not WAF rate-limits — fail the segment
              // and let TaskRunner's retry budget handle them.
              throw error instanceof Error ? error : new Error(message);
            }
            if (response.status === 200 && (end > start || segments.length > 1)) {
              await response.body?.cancel().catch(() => undefined);
              live.connections = 1;
              callbacks.onAdaptive?.(task.id, {
                effectiveConnections: 1,
                message: "服务器忽略 Range，已切换单连接",
              });
              throw new Error(
                `[RangeEngine] server ignored Range status=200 collapse taskId=${task.id}`,
              );
            }
            if (response.status !== 206 && response.status !== 200) {
              await response.body?.cancel().catch(() => undefined);
              const status = response.status;
              if (isRateLimitedStatus(status)) {
                await sharedBackoff(status, segment);
                continue;
              }
              throw new Error(
                `[RangeEngine] segment failed status=${status} taskId=${task.id}`,
              );
            }
            await readBodyToPosition(
              response,
              handle,
              start,
              (delta) => {
                segment.done += delta;
                windowBytes += delta;
                const now = Date.now();
                const elapsed = (now - windowStartedAt) / 1000;
                const speedBps = elapsed > 0 ? windowBytes / elapsed : 0;
                if (elapsed >= 0.5) {
                  windowBytes = 0;
                  windowStartedAt = now;
                }
                callbacks.onProgress(
                  task.id,
                  sumDone(segments),
                  segments.map((item) => ({ ...item })),
                  speedBps,
                );
                void persist();
              },
              abort.signal,
              async (bytes: number) => {
                if (taskGovernor.getLimit() > 0) await taskGovernor.consume(bytes);
                await this.speedGovernor.consume(bytes);
              },
            );
            const reqGap = Math.max(0, options.requestGapMs ?? 0);
            if (reqGap > 0) {
              await new Promise((r) => setTimeout(r, reqGap));
            }
          }
        } finally {
          activeSegments.delete(segment);
        }
      };

      const runNext = async (): Promise<void> => {
        for (;;) {
          if (abort.signal.aborted) throw new Error("aborted");
          if (activeSegments.size >= live.connections) {
            await new Promise((r) => setTimeout(r, 80));
            continue;
          }
          const segment = claimWork();
          if (!segment) {
            if (activeSegments.size > 0) {
              await new Promise((r) => setTimeout(r, 80));
              continue;
            }
            return;
          }
          try {
            await downloadSegment(segment);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/rate-limit cooldown exhausted/.test(message)) throw error;
            if (/ignored Range.*collapse/i.test(message)) {
              // Put remaining work back as a single full-range stream.
              segments.length = 0;
              const single: SegmentProgress = {
                start: 0,
                end: totalLength > 0 ? totalLength : probe.size,
                done: 0,
              };
              segments.push(single);
              queue.length = 0;
              queue.push(single);
              try {
                await handle.truncate(0);
              } catch {
                /* ignore */
              }
              live.connections = 1;
              await downloadSegment(single);
              return;
            }
            throw error;
          }
        }
      };
      const stagger = Math.max(0, options.workerStaggerMs ?? 0);
      const workers: Promise<void>[] = [];
      for (let index = 0; index < workerCount; index += 1) {
        const delayMs = stagger * index;
        workers.push(
          (async () => {
            if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
            await runNext();
          })(),
        );
      }
      await Promise.all(workers);
      await handle.close();

      if (abort.signal.aborted) {
        await persist(true);
        callbacks.onStatus(task.id, "paused");
        return;
      }

      const done = sumDone(segments);
      if (totalLength > 0 && done < totalLength) {
        await persist(true);
        throw new Error(
          `[RangeEngine] incomplete download taskId=${task.id} done=${done} total=${totalLength}`,
        );
      }

      callbacks.onStatus(task.id, "merging");
      await fsp.rm(resolvedPath, { force: true });
      await fsp.rename(partPath, resolvedPath);
      await fsp.rm(sidecarPathFor(options.sidecarDir, task.id), { force: true });
      callbacks.onProgress(
        task.id,
        totalLength || done,
        segments.map((segment) => ({ ...segment, done: segment.end - segment.start })),
        0,
      );
      callbacks.onStatus(task.id, "completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "aborted" || abort.signal.aborted) {
        callbacks.onStatus(task.id, "paused");
      } else {
        callbacks.onStatus(task.id, "failed", message);
      }
    } finally {
      this.active.delete(task.id);
    }
  }
}
