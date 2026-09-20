import {
  applyContentTypeExtension,
  sanitizeFilename,
  uniqueFilename,
} from '../shared/url';
import { logTask, taskLogPath } from '../electron/logger';
import fsp from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-p3] ${message}`);
}

async function main(): Promise<void> {
  assert(applyContentTypeExtension('download', 'application/zip') === 'download.zip', 'ct zip');
  assert(applyContentTypeExtension('file', 'video/mp4') === 'file.mp4', 'ct mp4');
  assert(applyContentTypeExtension('model.safetensors', 'application/octet-stream') === 'model.safetensors', 'keep long ext');
  assert(applyContentTypeExtension('download', 'application/octet-stream').startsWith('download_'), 'placeholder name');

  const dir = path.join(process.cwd(), 'scripts', '.tmp-p3');
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  const exists = (p: string) => fs.existsSync(p);
  await fsp.writeFile(path.join(dir, 'a.zip'), 'x');
  const n1 = uniqueFilename(dir, 'a.zip', exists);
  assert(n1 === 'a (1).zip', `unique1 got ${n1}`);
  await fsp.writeFile(path.join(dir, n1), 'x');
  const n2 = uniqueFilename(dir, 'a.zip', exists);
  assert(n2 === 'a (2).zip', `unique2 got ${n2}`);

  const logDir = path.join(dir, 'logs');
  await fsp.mkdir(logDir, { recursive: true });
  // task logger uses initLogger userDataDir
  const { initLogger } = await import('../electron/logger');
  initLogger(dir);
  const taskId = 'p3-task-001';
  logTask(taskId, 'hello smoke');
  const lp = taskLogPath(taskId);
  assert(fs.existsSync(lp), `task log exists ${lp}`);
  const text = await fsp.readFile(lp, 'utf8');
  assert(text.includes('hello smoke'), 'log content');
  assert(sanitizeFilename('CON.txt').startsWith('_'), 'reserved still ok');

  await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  console.log('smoke-p3: OK');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
