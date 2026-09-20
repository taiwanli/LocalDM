import {
  effectiveMediaLimitBps,
  formatExpressionForQuality,
  limitRateArg,
} from '../electron/engine/mediaEngine';
import { TaskRunner } from '../electron/engine/taskRunner';
import { ensurePayload, startRangeServer } from './local-test-server';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { MediaQuality } from '../shared/types';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-yt-limit] ${message}`);
}

async function main(): Promise<void> {
  assert(formatExpressionForQuality('best') === 'bv*+ba/b', 'best format');
  assert(formatExpressionForQuality('1080').includes('height<=1080'), '1080 format');
  assert(formatExpressionForQuality('audio') === 'bestaudio/best', 'audio format');
  assert(formatExpressionForQuality(undefined) === 'bv*+ba/b', 'undefined default best');

  assert(limitRateArg(0) === undefined, '0 no limit-rate');
  assert(limitRateArg(undefined) === undefined, 'undef no limit-rate');
  assert(limitRateArg(2097152) === '2097152', 'limit-rate bytes');

  assert(effectiveMediaLimitBps(0, 0) === 0, 'both zero');
  assert(effectiveMediaLimitBps(1000, 0) === 1000, 'task only');
  assert(effectiveMediaLimitBps(0, 4000) === 4000, 'global only');
  assert(effectiveMediaLimitBps(3000, 5000) === 3000, 'task wins when both');
  assert(effectiveMediaLimitBps(8000, 2000) === 2000, 'global tighter');

  const workDir = path.join(process.cwd(), 'scripts', '.tmp-yt-limit');
  await fsp.rm(workDir, { recursive: true, force: true });
  const runner = new TaskRunner({
    userDataDir: path.join(workDir, 'ud'),
    downloadDir: path.join(workDir, 'dl'),
    maxConnections: 1,
    minSegmentBytes: 1024 * 1024,
    maxConcurrentTasks: 1,
    defaultMediaQuality: '1080',
  });

  const payload = ensurePayload();
  const server = await startRangeServer(payload, 18772);
  const task = await runner.addFromCapture({
    kind: 'video-platform',
    url: 'https://example.com/watch?v=demo',
    suggestedFilename: 'demo',
    category: 'video',
    title: 'demo',
  });
  const created = runner.get(task.id);
  assert(created?.mediaKind === 'video-platform', 'platform task');
  assert(created?.mediaQuality === '1080', `default quality stored, got ${created?.mediaQuality}`);
  const patched = runner.setTaskMediaQuality(task.id, '720' as MediaQuality);
  assert(patched.mediaQuality === '720', 'runner.setTaskMediaQuality');
  const limited = runner.setTaskSpeedLimit(task.id, 512 * 1024);
  assert(limited.speedLimitBps === 512 * 1024, 'speed limit stored for yt-dlp path');

  server.close();
  console.log('smoke-yt-limit: OK');
  console.log('  format/limit-rate/effective limit mapping ok');
  console.log('  runner quality + speedLimit storage ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
