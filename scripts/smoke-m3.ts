import { decodeProtocolCapture } from '../shared/protocolUrl';
import { parseCaptureBody } from '../electron/api/protocol';
import { TaskRunner } from '../electron/engine/taskRunner';
import { LocalApiServer } from '../electron/api/server';
import { startRangeServer, ensurePayload } from './local-test-server';
import fsp from 'node:fs/promises';
import path from 'node:path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-m3] ${message}`);
}

function encodeProtocolData(payload: unknown): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64');
}

async function main(): Promise<void> {
  const payload = {
    kind: 'sniffed-media' as const,
    url: 'https://example.com/demo.mp4',
    pageUrl: 'https://example.com/watch',
    suggestedFilename: 'demo.mp4',
    category: 'video' as const,
  };
  const protocolUrl = `localdm://capture?data=${encodeURIComponent(encodeProtocolData(payload))}`;
  const decoded = decodeProtocolCapture(protocolUrl);
  const parsed = parseCaptureBody(JSON.stringify(decoded));
  assert(parsed.url === payload.url, 'protocol roundtrip url');
  assert(parsed.category === 'video', 'protocol category preserved');

  let rejected = false;
  try {
    decodeProtocolCapture('https://not-localdm/x');
  } catch {
    rejected = true;
  }
  assert(rejected, 'non-localdm protocol rejected');

  const rangePayload = ensurePayload();
  const server = await startRangeServer(rangePayload, 18768);
  const workDir = path.join(process.cwd(), 'scripts', '.tmp-m3');
  await fsp.rm(workDir, { recursive: true, force: true });
  await fsp.mkdir(workDir, { recursive: true });

  const runner = new TaskRunner({
    userDataDir: path.join(workDir, 'userdata'),
    downloadDir: path.join(workDir, 'downloads'),
    maxConnections: 4,
    minSegmentBytes: 256 * 1024,
    maxConcurrentTasks: 2,
  });

  const api = new LocalApiServer({
    port: 18769,
    token: 'test-token-not-secret',
    requireToken: false,
    onCapture: async (capture) => runner.addFromCapture(capture),
    tasks: {
      list: () => runner.list(),
      get: (id) => runner.get(id),
      create: async (body) => runner.createTask(body),
      pause: async (id) => runner.pause(id),
      resume: async (id) => runner.resume(id),
      remove: async (id, deleteFiles) => runner.remove(id, deleteFiles),
    },
  });
  const boundPort = await api.start();
  assert(boundPort === 18769, `api port ${boundPort}`);

  const healthRes = await fetch(`http://127.0.0.1:${boundPort}/health`);
  const healthBody = (await healthRes.json()) as { ok: boolean; app: string };
  assert(healthRes.ok && healthBody.app === 'LocalDM', 'health ok');

  const captureRes = await fetch(`http://127.0.0.1:${boundPort}/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'direct',
      url: 'http://127.0.0.1:18768/file',
      suggestedFilename: 'payload.bin',
    }),
  });
  const captureBody = (await captureRes.json()) as { ok?: boolean; task?: { id: string } };
  assert(captureRes.ok && captureBody.ok === true && !!captureBody.task?.id, 'capture created task');

  const platformRes = await fetch(`http://127.0.0.1:${boundPort}/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'video-platform',
      url: 'https://www.bilibili.com/video/BV1xx',
      pageUrl: 'https://www.bilibili.com/video/BV1xx',
      title: 'demo',
    }),
  });
  const platformBody = (await platformRes.json()) as { ok?: boolean; task?: { category: string } };
  assert(platformRes.ok && platformBody.task?.category === 'video', 'platform capture categorized as video');

  const tasksRes = await fetch(`http://127.0.0.1:${boundPort}/tasks`);
  const tasksBody = (await tasksRes.json()) as { ok: boolean; tasks: unknown[] };
  assert(tasksRes.ok && tasksBody.tasks.length >= 2, 'GET /tasks lists captures');

  const badRes = await fetch(`http://127.0.0.1:${boundPort}/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'direct', url: 'file:///c:/windows/win.ini' }),
  });
  assert(badRes.status === 400, 'capture rejects file://');

  await api.stop();
  server.close();
  console.log('smoke-m3: OK');
  console.log('  protocol capture decode ok');
  console.log('  API health/capture/tasks ok');
  console.log('  video-platform category=video ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
