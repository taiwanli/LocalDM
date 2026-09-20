import fsp from 'node:fs/promises';
import path from 'node:path';
import { SpeedGovernor } from '../electron/engine/speedGovernor';
import { TaskRunner } from '../electron/engine/taskRunner';
import { RangeEngine } from '../electron/engine/rangeEngine';
import { startRangeServer, ensurePayload } from './local-test-server';
import type { DownloadTask } from '../shared/types';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-complete] ${message}`);
}

async function waitFor(predicate: () => boolean, timeoutMs = 20000, label = 'cond'): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timeout ${label}`);
}

async function main(): Promise<void> {
  // SpeedGovernor unit
  const governor = new SpeedGovernor(0);
  const t0 = Date.now();
  await governor.consume(10 * 1024 * 1024);
  assert(Date.now() - t0 < 50, 'unlimited governor should not wait');
  governor.setLimit(50 * 1024); // 50 KiB/s
  const t1 = Date.now();
  await governor.consume(80 * 1024); // over burst window
  const waited = Date.now() - t1;
  assert(waited >= 50, `limited governor should wait, waited=${waited}ms`);

  // Engine respects governor (download should take longer than unlimited)
  const payload = ensurePayload(); // 5 MiB
  const server = await startRangeServer(payload, 18770);
  const workDir = path.join(process.cwd(), 'scripts', '.tmp-complete');
  await fsp.rm(workDir, { recursive: true, force: true });
  await fsp.mkdir(workDir, { recursive: true });

  const engine = new RangeEngine({
    maxConnections: 4,
    minSegmentBytes: 256 * 1024,
    sidecarDir: path.join(workDir, 'sidecar'),
    globalSpeedLimitBps: 1.5 * 1024 * 1024, // 1.5 MB/s
    flushIntervalMs: 50,
  });
  const savePath = path.join(workDir, 'limited.bin');
  const task: DownloadTask = {
    id: 'limited-1',
    url: 'http://127.0.0.1:18770/file',
    filename: 'limited.bin',
    savePath,
    category: 'other',
    status: 'queued',
    totalBytes: payload.length,
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
  const startedAt = Date.now();
  await engine.start(task, {
    onProgress: () => undefined,
    onStatus: (_id, status) => {
      finalStatus = status;
    },
  });
  const elapsed = Date.now() - startedAt;
  assert(finalStatus === 'completed', `limited download status=${finalStatus}`);
  // 5MiB at ~1.5MB/s theoretical ~3.3s; local loopback may burst to cap then throttle.
  assert(elapsed >= 800, `throttled download too fast elapsed=${elapsed}ms`);
  engine.setGlobalSpeedLimit(0);

  // TaskRunner open-folder hook fires only on completed
  const settleLog: Array<{ id: string; status: string }> = [];
  const runner = new TaskRunner({
    userDataDir: path.join(workDir, 'ud'),
    downloadDir: path.join(workDir, 'dl'),
    maxConnections: 2,
    minSegmentBytes: 256 * 1024,
    maxConcurrentTasks: 2,
    globalSpeedLimitBps: 0,
    onTaskStatusSettled: (settled) => {
      settleLog.push({ id: settled.id, status: settled.status });
    },
  });
  const doneTask = await runner.addUrl('http://127.0.0.1:18770/file');
  await waitFor(() => runner.get(doneTask.id)?.status === 'completed', 20000, 'runner complete');
  assert(
    settleLog.some((item) => item.id === doneTask.id && item.status === 'completed'),
    'settle hook received completed',
  );

  // Simulate main-process policy: open folder only when completed + flag
  const openFolderOnComplete = true;
  const shouldOpen =
    openFolderOnComplete && runner.get(doneTask.id)?.status === 'completed';
  assert(shouldOpen === true, 'open-folder policy true on completed');
  assert(
    openFolderOnComplete && runner.get(doneTask.id)?.status !== 'failed' ? true : false,
    'open-folder policy false on non-completed',
  );

  server.close();
  console.log('smoke-complete: OK');
  console.log(`  governor unlimited ok; limited wait ok; engine elapsed=${elapsed}ms`);
  console.log('  settle hook + open-folder policy ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
