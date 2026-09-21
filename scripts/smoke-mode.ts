/**
 * Download mode smoke — four user-facing modes including adaptive.
 */
import {
  DEFAULT_SETTINGS,
  DOWNLOAD_MODE_LABELS,
  DOWNLOAD_MODE_PRESETS,
} from '../shared/types';
import {
  downloadModePreset,
  resolveDownloadMode,
  applyModeToEngineDeps,
} from '../shared/downloadMode';
import {
  isRateLimitStatus,
  nextAdaptiveConnections,
  rateLimitHint,
} from '../shared/limits';
import {
  parseAria2ProgressLine,
  buildAria2Args,
  MAGNET_PUBLIC_TRACKERS,
} from '../electron/engine/torrentEngine';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-mode] ${message}`);
}

assert(resolveDownloadMode('adaptive') === 'adaptive', 'resolve adaptive');
assert(resolveDownloadMode('nope') === 'adaptive', 'resolve default adaptive');
assert(DOWNLOAD_MODE_LABELS.adaptive === '自适应', 'adaptive label');
assert(DOWNLOAD_MODE_PRESETS.adaptive.adaptiveDegrade === true, 'adaptive forces degrade');
assert(DOWNLOAD_MODE_PRESETS.adaptive.useSettingsConnections === true, 'adaptive uses settings conn');
assert(downloadModePreset('turbo').maxConnections === 16, 'turbo preset conn 16');

const appliedTurbo = applyModeToEngineDeps(
  { maxConnections: 8, maxConnectionsPerServer: 8, maxConcurrentTasks: 3 },
  'turbo',
);
assert(appliedTurbo.maxConnections === 16, 'turbo overrides connections');
const appliedAdaptive = applyModeToEngineDeps(
  { maxConnections: 8, maxConnectionsPerServer: 8, maxConcurrentTasks: 3 },
  'adaptive',
);
assert(appliedAdaptive.maxConnections === 8, 'adaptive keeps settings connections');
assert(appliedAdaptive.maxConcurrentTasks === 3, 'adaptive keeps settings concurrent');

assert(DEFAULT_SETTINGS.downloadMode === 'adaptive', 'default mode adaptive');
assert(DEFAULT_SETTINGS.adaptiveDegrade === true, 'adaptive on by default');
assert(isRateLimitStatus(567) && isRateLimitStatus(403), 'rate limit codes');
assert(nextAdaptiveConnections(8) === 4, 'adaptive halves');
assert(rateLimitHint(567).length > 0, 'hint text');

const meta = parseAria2ProgressLine('[#2d3a08 0B/0B CN:0 SD:0 DL:0B]');
assert(!!meta && meta.doneBytes === 0, 'aria2 metadata line parsed');
const active = parseAria2ProgressLine('[#2089b0 1.2MiB/4.5MiB(26%) CN:5 SD:3 DL:123KiB ETA:12s]');
assert(!!active && active.doneBytes > 0, 'aria2 active line parsed');

const magnet = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567';
const args = buildAria2Args({
  saveDir: 'C:/dl/torrent',
  source: magnet,
  maxConnections: 4,
  userDataDir: 'C:/Users/x/AppData/Roaming/LocalDM/LocalDM',
});
assert(args.some((a) => a.startsWith('--dht-file-path=')), 'dht path userData');
assert(args.some((a) => a === '--listen-port=51413-52413'), 'listen port range');
assert(args.some((a) => a.startsWith('--bt-tracker=')), 'trackers present');
assert(args.length >= MAGNET_PUBLIC_TRACKERS.length, 'tracker count');

console.log('smoke-mode: OK (4 modes + magnet dht/ports)');
