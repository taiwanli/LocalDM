/**
 * Native HLS (m3u8) MVP — original implementation.
 * Master playlist → best variant → parallel media segments → optional ffmpeg remux.
 * AES-encrypted streams and DASH are out of scope; route those to yt-dlp.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export interface HlsProgress {
  doneBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number | null;
  segmentsDone: number;
  segmentsTotal: number;
}

export interface HlsDownloadCallbacks {
  onProgress: (progress: HlsProgress) => void;
  onStatus: (
    status: 'starting' | 'downloading' | 'merging' | 'completed' | 'failed' | 'paused',
    error?: string,
  ) => void;
  onOutputFile?: (filePath: string) => void;
}

export interface HlsDownloadOptions {
  saveDir: string;
  filename?: string;
  playlistUrl: string;
  headers?: Record<string, string>;
  /** Prefer variant height ≤ N; undefined = best bandwidth */
  maxHeight?: number;
  maxConnections?: number;
  ffmpegPath?: string;
  proxy?: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface HlsVariant {
  uri: string;
  bandwidth: number;
  height?: number;
}

export function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url) || /\/hls\//i.test(url);
}

/** Parse #EXT-X-STREAM-INF master playlist into variants. */
export function parseHlsMaster(text: string, baseUrl: string): HlsVariant[] {
  const lines = text.split(/\r?\n/);
  const variants: HlsVariant[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = line.slice('#EXT-X-STREAM-INF:'.length);
    const bwMatch = /BANDWIDTH=(\d+)/i.exec(attrs) || /AVERAGE-BANDWIDTH=(\d+)/i.exec(attrs);
    const hMatch = /RESOLUTION=\d+x(\d+)/i.exec(attrs);
    let uri = '';
    for (let j = i + 1; j < lines.length; j += 1) {
      const cand = lines[j].trim();
      if (!cand || cand.startsWith('#')) continue;
      uri = new URL(cand, baseUrl).toString();
      break;
    }
    if (!uri) continue;
    variants.push({
      uri,
      bandwidth: bwMatch ? Number(bwMatch[1]) : 0,
      height: hMatch ? Number(hMatch[1]) : undefined,
    });
  }
  return variants;
}

export function pickHlsVariant(variants: HlsVariant[], maxHeight?: number): HlsVariant | null {
  if (!variants.length) return null;
  let pool = variants;
  if (maxHeight && maxHeight > 0) {
    const filtered = variants.filter((v) => !v.height || v.height <= maxHeight);
    if (filtered.length) pool = filtered;
  }
  return [...pool].sort((a, b) => {
    if (a.height && b.height && a.height !== b.height) return b.height - a.height;
    return b.bandwidth - a.bandwidth;
  })[0];
}

/** Extract media segment URIs from a media playlist (skips encryption keys for MVP fail-fast). */
export function parseHlsMediaSegments(text: string, baseUrl: string): {
  segments: string[];
  encrypted: boolean;
} {
  const lines = text.split(/\r?\n/);
  const segments: string[] = [];
  let encrypted = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-KEY')) {
      if (!/METHOD=NONE/i.test(line)) encrypted = true;
      continue;
    }
    if (line.startsWith('#')) continue;
    segments.push(new URL(line, baseUrl).toString());
  }
  return { segments, encrypted };
}

export function buildHlsHeaders(user?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: '*/*',
    'Accept-Encoding': 'identity',
  };
  if (user) {
    for (const k of Object.keys(user)) {
      const existing = Object.keys(headers).find((x) => x.toLowerCase() === k.toLowerCase());
      if (existing) delete headers[existing];
      headers[k] = user[k];
    }
  }
  return headers;
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`[HlsEngine] playlist HTTP ${res.status}`);
  return res.text();
}

export class HlsEngine {
  private active = new Set<string>();

  isRunning(taskId: string): boolean {
    return this.active.has(taskId);
  }

  pause(taskId: string): void {
    /* process map handled by caller killing child if needed */
    void taskId;
  }

  async download(
    taskId: string,
    options: HlsDownloadOptions,
    callbacks: HlsDownloadCallbacks,
  ): Promise<void> {
    if (this.active.has(taskId)) {
      throw new Error(`[HlsEngine] already running id=${taskId}`);
    }
    this.active.add(taskId);
    try {
      callbacks.onStatus('starting');
      const headers = buildHlsHeaders(options.headers);
      await fsp.mkdir(options.saveDir, { recursive: true });

      const masterText = await fetchText(options.playlistUrl, headers);
      let mediaUrl = options.playlistUrl;
      let variants: HlsVariant[] = [];
      if (masterText.includes('#EXT-X-STREAM-INF')) {
        variants = parseHlsMaster(masterText, options.playlistUrl);
        const picked = pickHlsVariant(variants, options.maxHeight);
        if (!picked) throw new Error('[HlsEngine] no HLS variants');
        mediaUrl = picked.uri;
      }
      const mediaText = await fetchText(mediaUrl, headers);
      const { segments, encrypted } = parseHlsMediaSegments(mediaText, mediaUrl);
      if (encrypted) {
        throw new Error('[HlsEngine] AES encrypted HLS not supported in native path; use yt-dlp');
      }
      if (!segments.length) {
        throw new Error('[HlsEngine] empty media playlist');
      }

      const stem =
        (options.filename || 'video').replace(/\.(m3u8|mp4|ts)$/i, '') || `hls-${Date.now()}`;
      const tsPath = path.join(options.saveDir, `${stem}.ts`);
      const outMp4 = path.join(options.saveDir, `${stem}.mp4`);

      callbacks.onStatus('downloading');
      const concurrency = Math.max(1, Math.min(options.maxConnections || 4, 8));
      const sizes = new Array<number>(segments.length).fill(0);
      let doneBytes = 0;
      let windowBytes = 0;
      let windowAt = Date.now();
      let cursor = 0;

      const downloadOne = async (index: number): Promise<void> => {
        const segUrl = segments[index];
        const res = await fetch(segUrl, { headers, redirect: 'follow' });
        if (!res.ok) {
          throw new Error(`[HlsEngine] segment ${index} HTTP ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const part = `${tsPath}.p${index}`;
        await fsp.writeFile(part, buf);
        sizes[index] = buf.length;
        doneBytes += buf.length;
        windowBytes += buf.length;
        const now = Date.now();
        const elapsed = (now - windowAt) / 1000;
        const speedBps = elapsed > 0 ? windowBytes / elapsed : 0;
        if (elapsed >= 0.5) {
          windowBytes = 0;
          windowAt = now;
        }
        const doneSeg = sizes.filter((s) => s > 0).length;
        callbacks.onProgress({
          doneBytes,
          totalBytes: doneBytes,
          speedBps,
          etaSeconds: null,
          segmentsDone: doneSeg,
          segmentsTotal: segments.length,
        });
      };

      const workers: Promise<void>[] = [];
      const runNext = async (): Promise<void> => {
        for (;;) {
          if (cursor >= segments.length) return;
          const i = cursor;
          cursor += 1;
          await downloadOne(i);
        }
      };
      for (let w = 0; w < concurrency; w += 1) workers.push(runNext());
      await Promise.all(workers);

      // concat parts in order
      const concat = await fsp.open(tsPath, 'w');
      try {
        for (let i = 0; i < segments.length; i += 1) {
          const part = `${tsPath}.p${i}`;
          const data = await fsp.readFile(part);
          await concat.write(data);
          await fsp.rm(part, { force: true }).catch(() => undefined);
        }
      } finally {
        await concat.close();
      }

      const total = sizes.reduce((a, b) => a + b, 0);
      callbacks.onProgress({
        doneBytes: total,
        totalBytes: total,
        speedBps: 0,
        etaSeconds: 0,
        segmentsDone: segments.length,
        segmentsTotal: segments.length,
      });

      // Remux if ffmpeg available
      const ffmpeg = options.ffmpegPath && fs.existsSync(options.ffmpegPath) ? options.ffmpegPath : '';
      if (ffmpeg) {
        callbacks.onStatus('merging');
        await remuxWithFfmpeg(ffmpeg, tsPath, outMp4);
        await fsp.rm(tsPath, { force: true }).catch(() => undefined);
        callbacks.onOutputFile?.(outMp4);
        callbacks.onStatus('completed');
        return;
      }

      callbacks.onOutputFile?.(tsPath);
      callbacks.onStatus('completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callbacks.onStatus('failed', message);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      this.active.delete(taskId);
    }
  }
}

function remuxWithFfmpeg(ffmpeg: string, input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      ['-y', '-i', input, '-c', 'copy', '-movflags', '+faststart', output],
      { windowsHide: true },
    );
    let err = '';
    child.stderr.on('data', (c: Buffer) => {
      err += c.toString();
      if (err.length > 200_000) err = err.slice(-200_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`[HlsEngine] ffmpeg exit=${code} ${err.slice(-300)}`));
    });
  });
}

void Readable;
