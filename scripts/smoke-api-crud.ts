import http from 'node:http';
import { LocalApiServer } from '../electron/api/server';
import { parseHeadersText, isHuggingFaceUrl } from '../shared/url';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-api-crud] ${message}`);
}

async function main(): Promise<void> {
  assert(isHuggingFaceUrl('https://huggingface.co/org/model/resolve/main/a.bin'), 'hf host match');
  assert(!isHuggingFaceUrl('https://example.com/a.bin'), 'non-hf rejected');
  const headers = parseHeadersText('Cookie: a=1\nAuthorization: Bearer x\n# comment\n');
  assert(headers.Cookie === 'a=1' && headers.Authorization === 'Bearer x', 'headers text parse');

  const createdIds: string[] = [];
  const server = new LocalApiServer({
    port: 18780,
    token: 'test-token',
    requireToken: true,
    onCapture: async (payload) => ({ id: 'cap-1', url: payload.url }),
    tasks: {
      list: () => [{ id: 't1', url: 'https://example.com/a.bin', status: 'queued' }],
      get: (id) => (id === 't1' ? { id: 't1', status: 'queued' } : undefined),
      create: async (body) => {
        const task = { id: `t-${createdIds.length + 1}`, url: body.url, headers: body.headers };
        createdIds.push(task.id);
        return task;
      },
      pause: async () => undefined,
      resume: async () => undefined,
      remove: async () => undefined,
    },
    settings: {
      get: () => ({ maxConnections: 32 }),
      update: async (partial) => ({ maxConnections: 16, ...partial }),
    },
  });
  await server.start();

  const base = 'http://127.0.0.1:18780';
  const auth = { Authorization: 'Bearer test-token' };

  const health = await fetch(`${base}/health`);
  assert(health.ok, 'health ok without token');

  const tasksNoAuth = await fetch(`${base}/tasks`);
  assert(tasksNoAuth.status === 401, 'tasks requires token');

  const tasks = await fetch(`${base}/tasks`, { headers: auth });
  const tasksBody = (await tasks.json()) as { ok: boolean; tasks: Array<{ id: string }> };
  assert(tasks.ok && tasksBody.tasks[0]?.id === 't1', 'tasks list with token');

  const createRes = await fetch(`${base}/tasks`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/x.bin', headers: { Cookie: 'c=1' } }),
  });
  const createBody = (await createRes.json()) as { ok: boolean; task: { id: string } };
  assert(createRes.ok && createBody.task.id === 't-1', 'create task');

  const getRes = await fetch(`${base}/tasks/t1`, { headers: auth });
  assert(getRes.ok, 'get task by id');

  const pauseRes = await fetch(`${base}/tasks/t1/pause`, { method: 'POST', headers: auth });
  assert(pauseRes.ok, 'pause task');
  const resumeRes = await fetch(`${base}/tasks/t1/resume`, { method: 'POST', headers: auth });
  assert(resumeRes.ok, 'resume task');

  const delRes = await fetch(`${base}/tasks/t1?deleteFiles=1`, { method: 'DELETE', headers: auth });
  assert(delRes.ok, 'delete task');

  const events = await fetch(`${base}/events`, { headers: auth });
  assert(events.ok, 'events polling endpoint');

  const settings = await fetch(`${base}/settings`, { headers: auth });
  assert(settings.ok, 'get settings');
  const putSettings = await fetch(`${base}/settings`, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxConnections: 8 }),
  });
  const putBody = (await putSettings.json()) as { settings: { maxConnections: number } };
  assert(putSettings.ok && putBody.settings.maxConnections === 8, 'update settings');

  const captureNoToken = await fetch(`${base}/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'direct', url: 'https://example.com/c.bin' }),
  });
  assert(captureNoToken.ok, 'capture still allowed on loopback without token');

  await server.stop();
  console.log('smoke-api-crud: OK');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
