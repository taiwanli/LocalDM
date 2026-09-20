import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { TaskRunner } from '../electron/engine/taskRunner';
import {
  loadTasksState,
  normalizeTasksForRestore,
  saveTasksState,
  tasksStatePath,
} from '../electron/engine/taskPersistence';
import type { DownloadTask } from '../shared/types';
import { startRangeServer, ensurePayload } from './local-test-server';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-m5] ${message}`);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 20000,
  label = 'condition',
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timeout waiting ${label}`);
}

function makeRunner(
  userDataDir: string,
  downloadDir: string,
  extra?: {
    maxRetryCount?: number;
    retryDelayMs?: number;
  },
) {
  return new TaskRunner({
    userDataDir,
    downloadDir,
    maxConnections: 4,
    minSegmentBytes: 256 * 1024,
    maxConcurrentTasks: 2,
    ...extra,
  });
}

function baseTask(partial: Partial<DownloadTask> & Pick<DownloadTask, 'id' | 'url' | 'status'>): DownloadTask {
  return {
    filename: `${partial.id}.bin`,
    savePath: `C:/tmp/${partial.id}.bin`,
    category: 'other',
    totalBytes: 0,
    doneBytes: 0,
    speedBps: 0,
    etaSeconds: null,
    canResume: false,
    mediaKind: 'direct',
    segments: [],
    headers: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

async function main(): Promise<void> {
  const sample: DownloadTask[] = [
    baseTask({
      id: 'a',
      url: 'http://example.com/a.bin',
      status: 'downloading',
      totalBytes: 100,
      doneBytes: 40,
      speedBps: 123,
      etaSeconds: 3,
      canResume: true,
    }),
    baseTask({
      id: 'b',
      url: 'http://example.com/b.bin',
      status: 'probing',
      speedBps: 9,
      etaSeconds: 1,
    }),
    baseTask({
      id: 'c',
      url: 'http://example.com/c.bin',
      status: 'completed',
      totalBytes: 10,
      doneBytes: 10,
      canResume: true,
    }),
  ];
  const restored = normalizeTasksForRestore(sample);
  assert(restored.find((t) => t.id === 'a')?.status === 'paused', 'in-flight with progress → paused');
  assert(restored.find((t) => t.id === 'b')?.status === 'queued', 'in-flight without progress → queued');
  assert(restored.find((t) => t.id === 'c')?.status === 'completed', 'completed preserved');
  assert(restored.every((t) => t.speedBps === 0), 'speed cleared on restore');

  const payload = ensurePayload();
  const server = await startRangeServer(payload, 18772);
  const urlBase = 'http://127.0.0.1:18772/file';
  const workDir = path.join(process.cwd(), 'scripts', '.tmp-m5');
  await fsp.rm(workDir, { recursive: true, force: true });
  await fsp.mkdir(workDir, { recursive: true });
  const userDataDir = path.join(workDir, 'userdata');
  const downloadDir = path.join(workDir, 'downloads');

  const runner1 = makeRunner(userDataDir, downloadDir);
  const task1 = await runner1.addUrl(urlBase);
  await waitFor(() => runner1.get(task1.id)?.status === 'completed', 20000, 'task completed');
  await waitFor(() => fs.existsSync(tasksStatePath(userDataDir)), 3000, 'tasks-state written');
  const saved = loadTasksState(userDataDir);
  assert(saved.some((t) => t.id === task1.id && t.status === 'completed'), 'completed task persisted');

  const ghost: DownloadTask = baseTask({
    id: 'ghost-inflight',
    url: urlBase,
    status: 'downloading',
    totalBytes: 1024,
    doneBytes: 128,
    speedBps: 999,
    etaSeconds: 1,
    canResume: true,
    segments: [{ start: 0, end: 1024, done: 128 }],
  });
  saveTasksState(userDataDir, [...saved, ghost]);

  const runner2 = makeRunner(userDataDir, downloadDir);
  const ghostRestored = runner2.get('ghost-inflight');
  assert(!!ghostRestored, 'ghost task restored from tasks-state.json');
  const ghostTask = ghostRestored!;
  assert(ghostTask.status === 'paused', 'restored in-flight becomes paused');
  assert(ghostTask.doneBytes === 128, 'progress bytes preserved');
  assert(runner2.list().some((t) => t.id === task1.id), 'historical completed task still listed');

  const runner3 = makeRunner(path.join(workDir, 'userdata-retry'), downloadDir, {
    maxRetryCount: 1,
    retryDelayMs: 40,
  });
  const failTask = await runner3.addUrl('http://127.0.0.1:1/unreachable');
  await waitFor(
    () =>
      runner3.get(failTask.id)?.status === 'failed' &&
      (runner3.get(failTask.id)?.retryCount ?? 0) >= 1,
    8000,
    'task retried then failed',
  );
  const failed = runner3.get(failTask.id)!;
  assert(failed.status === 'failed', 'unreachable stays failed after retry budget');
  assert((failed.retryCount ?? 0) >= 1, `retryCount recorded (got ${failed.retryCount})`);

  await server.close();
  console.log('smoke-m5: OK');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
