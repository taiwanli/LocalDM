import {
  buildAria2Args,
  parseAria2ProgressLine,
  defaultAria2cPath,
  aria2cToolStatus,
} from '../electron/engine/torrentEngine';
import { TaskRunner, shouldUseTorrentEngine, shouldUseMediaEngine } from '../electron/engine/taskRunner';
import { isMagnetUrl, isTorrentUrl } from '../shared/url';
import path from 'node:path';
import fsp from 'node:fs/promises';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-bt] ${message}`);
}

async function main(): Promise<void> {
  const magnet = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=demo';
  assert(isMagnetUrl(magnet), 'magnet detected');
  assert(isTorrentUrl(magnet), 'magnet is torrentish');
  assert(isTorrentUrl('https://example.com/file.torrent?x=1'), 'http torrent url');
  assert(!isTorrentUrl('https://example.com/file.zip'), 'zip not torrent');

  assert(shouldUseTorrentEngine({ mediaKind: 'magnet', url: magnet }), 'magnet routes torrent');
  assert(shouldUseTorrentEngine({ mediaKind: 'direct', url: magnet }), 'magnet by url routes');
  assert(shouldUseTorrentEngine({ mediaKind: 'torrent', url: 'https://x/a.torrent' }), 'torrent kind routes');
  assert(!shouldUseTorrentEngine({ mediaKind: 'direct', url: 'https://example.com/a.zip' }), 'http not torrent');
  assert(!shouldUseMediaEngine({ mediaKind: 'magnet', url: magnet }), 'magnet not media engine');
  assert(shouldUseMediaEngine({ mediaKind: 'video-platform', url: 'https://youtube.com/x' }), 'platform still media');

  const args = buildAria2Args({
    saveDir: 'C:/dl/torrent',
    source: magnet,
    limitRateBps: 2 * 1024 * 1024,
    maxConnections: 8,
    proxy: 'http://127.0.0.1:7890',
  });
  assert(args.includes(magnet), 'aria2 args include magnet');
  assert(args.some((a) => a.startsWith('--max-overall-download-limit=2097152')), 'limit-rate arg');
  assert(args.some((a) => a === '--all-proxy=http://127.0.0.1:7890'), 'proxy arg');
  assert(args.some((a) => a === '--split=8'), 'split arg');
  assert(args.some((a) => a === '--seed-time=0'), 'seed-time 0');

  const progress = parseAria2ProgressLine(
    '[#2089b0 1.2MiB/4.5MiB(26%) CN:5 SD:3 DL:123KiB ETA:12s]',
  );
  assert(!!progress, 'progress parsed');
  assert(progress!.doneBytes > 0 && progress!.totalBytes >= progress!.doneBytes, 'progress bytes');
  assert(progress!.speedBps > 0, 'progress speed');

  const runner = new TaskRunner({
    userDataDir: path.join(process.cwd(), 'scripts', '.tmp-bt', 'userdata'),
    downloadDir: path.join(process.cwd(), 'scripts', '.tmp-bt', 'downloads'),
    maxConnections: 4,
    minSegmentBytes: 256 * 1024,
    maxConcurrentTasks: 2,
    enableBt: true,
  });
  const task = await runner.addFromCapture({ kind: 'direct', url: magnet });
  assert(task.mediaKind === 'magnet', `mediaKind magnet got=${task.mediaKind}`);
  assert(task.category === 'torrent', `category torrent got=${task.category}`);
  assert(shouldUseTorrentEngine(task), 'created task uses torrent engine');

  const disabled = new TaskRunner({
    userDataDir: path.join(process.cwd(), 'scripts', '.tmp-bt', 'userdata-off'),
    downloadDir: path.join(process.cwd(), 'scripts', '.tmp-bt', 'downloads'),
    maxConnections: 4,
    minSegmentBytes: 256 * 1024,
    maxConcurrentTasks: 1,
    enableBt: false,
  });
  const failTask = await disabled.addFromCapture({ kind: 'direct', url: magnet });
  await new Promise((r) => setTimeout(r, 300));
  const state = disabled.get(failTask.id);
  assert(
    state?.status === 'failed' && /BT\/磁力/.test(state.error || ''),
    `disabled BT fails clearly got=${state?.status} ${state?.error}`,
  );

  const detected = defaultAria2cPath(process.cwd(), '');
  const tool = aria2cToolStatus(detected);
  console.log('aria2c detection:', tool);

  try {
    await disabled.cancel(failTask.id);
    await runner.cancel(task.id);
  } catch {
    /* ignore */
  }
  try {
    await fsp.rm(path.join(process.cwd(), 'scripts', '.tmp-bt'), { recursive: true, force: true });
  } catch {
    /* ignore locked dirs */
  }
  console.log('smoke-bt: OK');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
