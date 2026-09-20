import fsp from 'node:fs/promises';
import path from 'node:path';
import { RangeEngine } from '../electron/engine/rangeEngine';
import { TaskRunner } from '../electron/engine/taskRunner';
import { startRangeServer, ensurePayload } from './local-test-server';
import type { DownloadTask } from '../shared/types';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-task-limit] ${message}`);
}

async function main(): Promise<void> {
  const payload = ensurePayload();
  const server = await startRangeServer(payload, 18771);
  const workDir = path.join(process.cwd(), 'scripts', '.tmp-task-limit');
  await fsp.rm(workDir, { recursive: true, force: true });
  await fsp.mkdir(workDir, { recursive: true });

  // Engine-level: task limit while global unlimited
  const engine = new RangeEngine({
    maxConnections: 4,
    minSegmentBytes: 256 * 1024,
    sidecarDir: path.join(workDir, 'sidecar'),
    globalSpeedLimitBps: 0,
  });
  engine.setTaskSpeedLimit('limited', 1.2 * 1024 * 1024);
  const savePath = path.join(workDir, 'task-limited.bin');
  const task: DownloadTask = {
    id: 'limited',
    url: 'http://127.0.0.1:18771/file',
    filename: 'task-limited.bin',
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
    speedLimitBps: 1.2 * 1024 * 1024,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let status = '';
  const started = Date.now();
  await engine.start(task, {
    onProgress: () => undefined,
    onStatus: (_id, s) => {
      status = s;
    },
  });
  const elapsed = Date.now() - started;
  assert(status === 'completed', `task-limited status=${status}`);
  assert(elapsed >= 700, `task limit too fast elapsed=${elapsed}ms`);

  // Runner: setTaskSpeedLimit patches task + engine; unlimited faster path
  const runner = new TaskRunner({
    userDataDir: path.join(workDir, 'ud'),
    downloadDir: path.join(workDir, 'dl'),
    maxConnections: 1,
    minSegmentBytes: 256 * 1024,
    maxConcurrentTasks: 1,
    globalSpeedLimitBps: 0,
  });
  const fast = await runner.addUrl('http://127.0.0.1:18771/file');
  await new Promise((r) => setTimeout(r, 20));
  const patched = runner.setTaskSpeedLimit(fast.id, 512 * 1024);
  assert(patched.speedLimitBps === 512 * 1024, 'runner stores speedLimitBps');
  // wait finish (may already be running unlimited if started before patch — ensure after complete we can set again)
  for (let i = 0; i < 200; i += 1) {
    if (runner.get(fast.id)?.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const again = runner.setTaskSpeedLimit(fast.id, 0);
  assert(again.speedLimitBps === 0, 'runner can clear limit');

  // Two tasks: one limited one not — runner API only; engine-level covered above
  const limitedTask = await runner.addUrl('http://127.0.0.1:18771/file');
  runner.setTaskSpeedLimit(limitedTask.id, 1024 * 1024);
  for (let i = 0; i < 200; i += 1) {
    if (runner.get(limitedTask.id)?.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert(runner.get(limitedTask.id)?.status === 'completed', 'limited runner task completed');

  server.close();
  console.log('smoke-task-limit: OK');
  console.log(`  engine task-limit elapsed=${elapsed}ms`);
  console.log('  runner setTaskSpeedLimit patch/clear ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
