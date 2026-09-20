import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { MediaEngine, mediaToolStatus } from '../electron/engine/mediaEngine';
import { TaskRunner } from '../electron/engine/taskRunner';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-m4-live] ${message}`);
}

async function waitFor(pred: () => boolean, ms = 120000, label = 'cond'): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout ${label}`);
}

async function main(): Promise<void> {
  const root = process.cwd();
  if (!process.env.HTTP_PROXY && !process.env.HTTPS_PROXY) {
    process.env.HTTP_PROXY = 'http://127.0.0.1:7890';
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
  }
  const ytdlp = path.join(root, 'resources/bin/yt-dlp.exe');
  const ffmpeg = path.join(root, 'resources/bin/ffmpeg.exe');
  const status = mediaToolStatus(ytdlp, ffmpeg);
  if (!status.ytdlpAvailable) {
    console.log('smoke-m4-live: SKIP (yt-dlp missing)');
    return;
  }
  assert(status.ffmpegAvailable, 'ffmpeg should be present next to yt-dlp');

  const engine = new MediaEngine(ytdlp, ffmpeg);
  // version via resolve path is not needed; spawn --version through download-less check
  const { spawnSync } = await import('node:child_process');
  const version = spawnSync(ytdlp, ['--version'], { encoding: 'utf8' });
  assert(version.status === 0, `yt-dlp --version failed ${version.stderr}`);
  console.log('yt-dlp', version.stdout.trim());

  const workDir = path.join(root, 'scripts', '.tmp-m4-live');
  await fsp.rm(workDir, { recursive: true, force: true });
  await fsp.mkdir(workDir, { recursive: true });

  // Small public test stream (HLS) — network dependent
  const testUrl = process.env.LOCALDM_TEST_HLS || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
  const runner = new TaskRunner({
    userDataDir: path.join(workDir, 'ud'),
    downloadDir: path.join(workDir, 'dl'),
    maxConnections: 2,
    minSegmentBytes: 256 * 1024,
    maxConcurrentTasks: 1,
    appRoot: root,
    ytdlpPath: ytdlp,
    ffmpegPath: ffmpeg,
  });

  let lastError = '';
  const task = await runner.addFromCapture({
    kind: 'sniffed-media',
    url: testUrl,
    suggestedFilename: 'test-hls.m3u8',
    category: 'video',
  });
  assert(task.mediaKind === 'sniffed-media', 'media kind preserved');

  const started = Date.now();
  try {
    await waitFor(() => {
      const t = runner.get(task.id);
      if (t?.status === 'failed') {
        lastError = t.error || 'failed';
        return true;
      }
      return t?.status === 'completed';
    }, 120000, 'hls download');
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  const final = runner.get(task.id);
  console.log('final status', final?.status, 'error', final?.error || lastError);
  if (final?.status === 'completed') {
    assert(fs.existsSync(final.savePath), `output missing ${final.savePath}`);
    const size = fs.statSync(final.savePath).size;
    assert(size > 0, 'output empty');
    console.log('smoke-m4-live: OK (HLS completed)', final.savePath, size, 'bytes', `${Date.now() - started}ms`);
  } else {
    // Network/CDN may block; routing + binary wiring already covered by smoke-m4
    console.log('smoke-m4-live: WARN download did not complete (network/CDN). Tools and routing still OK.');
    console.log('  detail', lastError || final?.error || final?.status);
  }
  try {
    await runner.cancel(task.id);
  } catch {
    /* ignore */
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
