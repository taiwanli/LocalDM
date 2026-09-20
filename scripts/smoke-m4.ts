import {
  defaultFfmpegPath,
  defaultYtdlpPath,
  isStreamUrl,
  mediaToolStatus,
  parseProgressTemplateLine,
} from '../electron/engine/mediaEngine';
import { shouldUseMediaEngine, shouldUseNativeHls } from '../electron/engine/taskRunner';
import path from 'node:path';
import fs from 'node:fs';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-m4] ${message}`);
}

function main(): void {
  assert(isStreamUrl('https://cdn.example.com/live/index.m3u8'), 'm3u8 is stream');
  assert(isStreamUrl('https://cdn.example.com/v/manifest.mpd?token=1'), 'mpd query is stream');
  assert(!isStreamUrl('https://example.com/file.mp4'), 'mp4 is not stream');

  assert(shouldUseMediaEngine({ mediaKind: 'video-platform', url: 'https://x.com/a' }), 'platform uses media engine');
  assert(
    shouldUseNativeHls({ mediaKind: 'direct', url: 'https://a/b.m3u8' }, true),
    'm3u8 uses native HLS when enabled',
  );
  assert(
    !shouldUseMediaEngine({ mediaKind: 'direct', url: 'https://a/b.m3u8' }),
    'm3u8 not routed to yt-dlp when reserved for native HLS',
  );
  assert(shouldUseMediaEngine({ mediaKind: 'direct', url: 'https://a/b.mpd' }), 'mpd uses media engine');
  assert(!shouldUseMediaEngine({ mediaKind: 'direct', url: 'https://a/b.zip' }), 'zip uses range engine');

  const progress = parseProgressTemplateLine(
    'download:1048576|5242880|5242880|2097152.5|2',
  );
  assert(!!progress, 'progress line parsed');
  assert(progress!.doneBytes === 1048576, 'done bytes');
  assert(progress!.totalBytes === 5242880, 'total bytes');
  assert(progress!.speedBps === 2097152.5, 'speed');
  assert(progress!.etaSeconds === 2, 'eta');
  assert(parseProgressTemplateLine('[download] Destination: x.mp4') === null, 'non template ignored');

  const root = process.cwd();
  const ytdlp = defaultYtdlpPath(root, '');
  const ffmpeg = defaultFfmpegPath(root, '');
  const status = mediaToolStatus(ytdlp, ffmpeg);
  console.log('yt-dlp path', ytdlp, 'exists', status.ytdlpAvailable);
  console.log('ffmpeg path', ffmpeg, 'exists', status.ffmpegAvailable);

  if (status.ytdlpAvailable) {
    console.log('yt-dlp binary present — optional live resolve can be run manually');
  } else {
    console.log('yt-dlp binary missing — command/path logic verified only');
  }
  assert(ytdlp.endsWith('yt-dlp.exe') || ytdlp.endsWith('yt-dlp'), 'default ytdlp path shape');
  assert(ffmpeg.endsWith('ffmpeg.exe') || ffmpeg.endsWith('ffmpeg'), 'default ffmpeg path shape');
  assert(path.isAbsolute(ytdlp), 'ytdlp absolute');

  const fakeDir = path.join(root, 'scripts', '.tmp-m4-bin');
  fs.mkdirSync(fakeDir, { recursive: true });
  const fakeYtdlp = path.join(fakeDir, 'yt-dlp.exe');
  fs.writeFileSync(fakeYtdlp, 'stub');
  const resolved = defaultYtdlpPath(root, fakeYtdlp);
  assert(resolved === fakeYtdlp, 'configured ytdlp path preferred when exists');
  const status2 = mediaToolStatus(resolved, ffmpeg);
  assert(status2.ytdlpAvailable, 'configured path marked available');

  console.log('smoke-m4: OK');
  console.log('  stream/platform routing ok');
  console.log('  progress template parse ok');
  console.log('  tool path resolution ok');
}

main();
