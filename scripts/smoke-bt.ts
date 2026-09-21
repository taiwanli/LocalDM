/**
 * BT/magnet smoke — RPC daemon args, BT options, trackers, timeout helpers.
 */
import {
  buildAria2Args,
  buildAria2DaemonArgs,
  buildBtRpcTaskOptions,
  mergeTrackers,
  parseAria2ProgressLine,
  defaultAria2cPath,
  aria2cToolStatus,
  getAria2Daemon,
  MAGNET_PUBLIC_TRACKERS,
  DEFAULT_METADATA_TIMEOUT_MS,
} from '../electron/engine/torrentEngine';
import {
  TaskRunner,
  shouldUseTorrentEngine,
  shouldUseMediaEngine,
} from '../electron/engine/taskRunner';
import { isMagnetUrl, isTorrentUrl } from '../shared/url';
import path from 'node:path';
import fsp from 'node:fs/promises';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-bt] ${message}`);
}

async function main(): Promise<void> {
  const magnet = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=demo';
  assert(isMagnetUrl(magnet), 'magnet detected');
  assert(shouldUseTorrentEngine({ mediaKind: 'magnet', url: magnet }), 'magnet routes torrent');
  assert(!shouldUseMediaEngine({ mediaKind: 'magnet', url: magnet }), 'magnet not media engine');

  // Daemon args: shared RPC + BT strategy + trackers
  const daemonArgs = buildAria2DaemonArgs({
    aria2cPath: 'aria2c',
    port: 6810,
    secret: 'secret123',
    userDataDir: 'C:/Users/x/AppData/Roaming/LocalDM/LocalDM',
    extraTrackers: ['http://custom.example/announce'],
  });
  assert(daemonArgs.includes('--enable-rpc=true'), 'rpc enabled');
  assert(daemonArgs.includes('--rpc-listen-port=6810'), 'rpc port');
  assert(daemonArgs.includes('--bt-max-peers=128'), 'bt-max-peers');
  assert(daemonArgs.includes('--bt-save-metadata=true'), 'save metadata');
  assert(daemonArgs.includes('--listen-port=51413-52413'), 'listen range');
  assert(
    daemonArgs.some((a) => a.startsWith('--dht-file-path=')),
    'dht path',
  );
  assert(
    daemonArgs.some((a) => a === '--bt-tracker=http://custom.example/announce'),
    'custom tracker in daemon',
  );
  assert(!daemonArgs.some((a) => a.startsWith('--split=')), 'no HTTP split on daemon');
  assert(DEFAULT_METADATA_TIMEOUT_MS === 180_000, 'default metadata timeout');

  const merged = mergeTrackers('udp://my.tracker:1/announce\n# comment\n');
  assert(merged.includes('udp://my.tracker:1/announce'), 'merge custom');
  assert(merged.length > MAGNET_PUBLIC_TRACKERS.length, 'merged longer than defaults');

  const taskOpts = buildBtRpcTaskOptions({
    saveDir: 'C:/dl/torrent',
    source: magnet,
    limitRateBps: 1024 * 1024,
    extraTrackers: ['http://t.acg.rip:6699/announce'],
  });
  assert(taskOpts.dir === 'C:/dl/torrent', 'rpc dir');
  assert(taskOpts['bt-max-peers'] === '128', 'rpc bt-max-peers');
  assert(taskOpts['bt-save-metadata'] === 'true', 'rpc save metadata');
  assert(!!taskOpts['bt-tracker']?.includes('opentrackr'), 'rpc trackers');
  assert(taskOpts['max-overall-download-limit'] === String(1024 * 1024), 'rpc rate limit');
  assert(!('split' in taskOpts), 'no split key on BT options');

  // CLI fallback args still valid for magnet without HTTP split
  const cli = buildAria2Args({
    saveDir: 'C:/dl/torrent',
    source: magnet,
    limitRateBps: 2 * 1024 * 1024,
    proxy: 'http://127.0.0.1:7890',
    userDataDir: 'C:/ud',
  });
  assert(cli.includes(magnet), 'cli magnet');
  assert(cli.some((a) => a === '--all-proxy=http://127.0.0.1:7890'), 'cli proxy');
  assert(cli.some((a) => a === '--bt-max-peers=128'), 'cli bt peers');
  assert(!cli.some((a) => a === '--split=8'), 'cli no http split');
  assert(cli.some((a) => a.startsWith('--bt-tracker=')), 'cli trackers');

  const progress = parseAria2ProgressLine(
    '[#2089b0 1.2MiB/4.5MiB(26%) CN:5 SD:3 DL:123KiB ETA:12s]',
  );
  assert(!!progress && progress.connections === 5 && progress.seeders === 3, 'progress CN/SD');
  const meta = parseAria2ProgressLine('[#abc123 0B/0B CN:0 SD:0 DL:0B]');
  assert(!!meta && meta.doneBytes === 0, 'metadata progress');

  const runner = new TaskRunner({
    userDataDir: path.join(process.cwd(), 'scripts', '.tmp-bt', 'userdata'),
    downloadDir: path.join(process.cwd(), 'scripts', '.tmp-bt', 'downloads'),
    maxConnections: 4,
    minSegmentBytes: 256 * 1024,
    maxConcurrentTasks: 2,
    enableBt: true,
    btTrackers: 'http://extra.example/announce',
    btMetadataTimeoutSec: 60,
  });
  const task = await runner.addFromCapture({ kind: 'direct', url: magnet });
  assert(task.mediaKind === 'magnet', `mediaKind magnet got=${task.mediaKind}`);
  assert(task.category === 'torrent', `category torrent got=${task.category}`);

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
  console.log('aria2c detection:', aria2cToolStatus(detected));

  try {
    await disabled.cancel(failTask.id);
    await runner.cancel(task.id);
  } catch {
    /* ignore */
  }
  try {
    await getAria2Daemon().shutdown();
  } catch {
    /* ignore */
  }
  try {
    await fsp.rm(path.join(process.cwd(), 'scripts', '.tmp-bt'), {
      recursive: true,
      force: true,
    });
  } catch {
    /* ignore locked dirs */
  }
  console.log('smoke-bt: OK');
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
