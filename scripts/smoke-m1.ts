import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planSegments, RangeEngine, canResumeFromSidecar } from '../electron/engine/rangeEngine';
import { startRangeServer, ensurePayload } from './local-test-server';
import type { DownloadTask } from '../shared/types';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-m1] ${message}`);
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function waitStatus(
  taskId: string,
  wanted: string[],
  timeoutMs = 30000,
): Promise<{ status: string; error?: string; task: Partial<DownloadTask> }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting status')), timeoutMs);
    // polled via callback capture below
    void taskId;
    void wanted;
    void timer;
  });
}

async function main(): Promise<void> {
  const segments = planSegments(10 * 1024 * 1024, 8, 1024 * 1024);
  assert(segments.length >= 2, 'planSegments should split large files');
  assert(canResumeFromSidecar(null, { size: 1, etag: null, lastModified: null }) === false, 'null sidecar cannot resume');
  assert(
    canResumeFromSidecar(
      {
        url: 'http://127.0.0.1/x',
        etag: '"a"',
        lastModified: null,
        totalLength: 10,
        segments: [],
        partPath: 'x',
        updatedAt: new Date().toISOString(),
      },
      { size: 10, etag: '"a"', lastModified: null },
    ) === true,
    'matching etag can resume',
  );
  assert(
    canResumeFromSidecar(
      {
        url: 'http://127.0.0.1/x',
        etag: '"a"',
        lastModified: null,
        totalLength: 10,
        segments: [],
        partPath: 'x',
        updatedAt: new Date().toISOString(),
      },
      { size: 99, etag: '"a"', lastModified: null },
    ) === false,
    'size mismatch cannot resume',
  );

  const payload = ensurePayload();
  const expected = sha256(payload);
  const server = await startRangeServer(payload);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 18765;
  const url = `http://127.0.0.1:${port}/file`;

  const workDir = path.join(process.cwd(), 'scripts', '.tmp-smoke');
  await fsp.rm(workDir, { recursive: true, force: true });
  await fsp.mkdir(workDir, { recursive: true });
  const savePath = path.join(workDir, 'payload.bin');
  const sidecarDir = path.join(workDir, 'sidecar');

  const engine = new RangeEngine({
    maxConnections: 8,
    minSegmentBytes: 256 * 1024,
    sidecarDir,
    flushIntervalMs: 100,
  });

  const probe = await engine.probe(url);
  assert(probe.size === payload.length, `probe size ${probe.size} != ${payload.length}`);
  assert(probe.acceptRanges, 'probe should detect range support');

  const task: DownloadTask = {
    id: 'smoke-task-1',
    url,
    filename: 'payload.bin',
    savePath,
    category: 'other',
    status: 'queued',
    totalBytes: probe.size,
    doneBytes: 0,
    speedBps: 0,
    etaSeconds: null,
    canResume: true,
    mediaKind: 'direct',
    segments: [],
    headers: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let finalStatus = '';
  let lastError: string | undefined;
  let sawDownloading = false;

  await engine.start(task, {
    onProgress: () => undefined,
    onStatus: (_id, status, error) => {
      finalStatus = status;
      lastError = error;
      if (status === 'downloading') sawDownloading = true;
    },
  });

  assert(sawDownloading, 'should enter downloading status');
  assert(finalStatus === 'completed', `expected completed, got ${finalStatus} ${lastError ?? ''}`);
  const written = await fsp.readFile(savePath);
  assert(written.length === payload.length, 'downloaded size mismatch');
  assert(sha256(written) === expected, 'downloaded hash mismatch');

  // Pause/resume cycle on second task
  const savePath2 = path.join(workDir, 'payload2.bin');
  const task2: DownloadTask = { ...task, id: 'smoke-task-2', savePath: savePath2 };
  let paused = false;
  let completed2 = false;
  const engine2 = new RangeEngine({
    maxConnections: 4,
    minSegmentBytes: 256 * 1024,
    sidecarDir,
    flushIntervalMs: 50,
  });

  const startPromise = engine2.start(task2, {
    onProgress: () => undefined,
    onStatus: (_id, status) => {
      if (status === 'downloading') {
        void engine2.pause(task2.id);
      }
      if (status === 'paused') paused = true;
      if (status === 'completed') completed2 = true;
    },
  });
  await startPromise;
  assert(paused, 'expected paused after abort');
  assert(fs.existsSync(`${savePath2}.part`) || fs.existsSync(path.join(sidecarDir, 'smoke-task-2.meta.json')), 'part or sidecar should exist after pause');

  await engine2.resume(task2, {
    onProgress: () => undefined,
    onStatus: (_id, status) => {
      if (status === 'completed') completed2 = true;
    },
  });
  assert(completed2, 'resume should complete');
  const written2 = await fsp.readFile(savePath2);
  assert(sha256(written2) === expected, 'resume hash mismatch');

  server.close();
  void waitStatus;
  console.log('smoke-m1: OK');
  console.log(`  probe size=${probe.size} segments=${segments.length}`);
  console.log(`  completed hash=${expected.slice(0, 12)}…`);
  console.log(`  resume path verified for ${savePath2}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
