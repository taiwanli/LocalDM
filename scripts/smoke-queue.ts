import { clampRunnerSettings, TaskRunner } from '../electron/engine/taskRunner';
import { startRangeServer, ensurePayload } from './local-test-server';
import fsp from 'node:fs/promises';
import path from 'node:path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-queue] ${message}`);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 15000,
  label = 'condition',
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timeout waiting ${label}`);
}

async function main(): Promise<void> {
  const clamped = clampRunnerSettings({ maxConnections: 999, maxConcurrentTasks: 0, minSegmentBytes: 1 });
  assert(clamped.maxConnections === 64, 'maxConnections clamped to 64');
  assert(clamped.maxConcurrentTasks === 1, 'maxConcurrentTasks clamped to 1');
  assert(clamped.minSegmentBytes === 64 * 1024, 'minSegmentBytes clamped to 64KiB');

  const payload = ensurePayload();
  const server = await startRangeServer(payload, 18766);
  const urlBase = 'http://127.0.0.1:18766/file';
  const workDir = path.join(process.cwd(), 'scripts', '.tmp-queue');
  await fsp.rm(workDir, { recursive: true, force: true });
  await fsp.mkdir(workDir, { recursive: true });

  const runner = new TaskRunner({
    userDataDir: path.join(workDir, 'userdata'),
    downloadDir: path.join(workDir, 'downloads'),
    maxConnections: 4,
    minSegmentBytes: 256 * 1024,
    maxConcurrentTasks: 1,
  });

  const taskA = await runner.addUrl(urlBase);
  const taskB = await runner.addUrl(urlBase);
  assert(taskA.status === 'queued' || taskA.status === 'probing' || taskA.status === 'downloading', 'A enqueued');
  assert(taskB.status === 'queued', 'B must wait while concurrency=1');

  const activePeak = () =>
    runner.list().filter((task) => ['probing', 'downloading', 'merging'].includes(task.status)).length;

  await waitFor(() => runner.get(taskA.id)?.status === 'completed', 20000, 'A completed');
  await waitFor(() => runner.get(taskB.id)?.status === 'completed', 20000, 'B completed after promote');
  assert(activePeak() === 0, 'no active tasks after both complete');

  // pauseAll / resumeAll / clearFinished
  const runner2 = new TaskRunner({
    userDataDir: path.join(workDir, 'userdata2'),
    downloadDir: path.join(workDir, 'downloads2'),
    maxConnections: 2,
    minSegmentBytes: 256 * 1024,
    maxConcurrentTasks: 2,
  });
  const c1 = await runner2.addUrl(urlBase);
  const c2 = await runner2.addUrl(urlBase);
  await waitFor(
    () => runner2.list().filter((t) => t.status === 'downloading' || t.status === 'probing').length >= 1,
    10000,
    'concurrent start',
  );
  await runner2.pauseAll();
  await waitFor(
    () => runner2.list().every((t) => t.status !== 'downloading' && t.status !== 'probing'),
    10000,
    'paused',
  );
  await runner2.resumeAll();
  await waitFor(() => runner2.get(c1.id)?.status === 'completed', 20000, 'c1 complete');
  await waitFor(() => runner2.get(c2.id)?.status === 'completed', 20000, 'c2 complete');
  const cleared = await runner2.clearFinished();
  assert(cleared >= 2, `clearFinished removed finished tasks, got ${cleared}`);
  assert(runner2.list().length === 0, 'list empty after clearFinished');

  server.close();
  console.log('smoke-queue: OK');
  console.log('  clamp settings ok');
  console.log('  concurrency=1 queue promotion ok');
  console.log('  pauseAll/resumeAll/clearFinished ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
