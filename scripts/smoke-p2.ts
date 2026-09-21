import {
  cookieBrowserArgs,
  isYtDlpUrl,
  needsBrowserCookies,
  normalizeDownloadUrl,
} from '../shared/media';
import {
  pickHlsVariant,
  parseHlsMaster,
  parseHlsMediaSegments,
  isHlsUrl,
} from '../electron/engine/hlsEngine';
import { formatExpressionForQuality } from '../electron/engine/mediaEngine';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-p2] ${message}`);
}

assert(normalizeDownloadUrl('bilibili.com/video/BV1xx') === 'https://bilibili.com/video/BV1xx', 'add https');
assert(
  normalizeDownloadUrl('https://www.douyin.com/?modal_id=12345') === 'https://www.douyin.com/video/12345',
  'douyin modal',
);
assert(
  normalizeDownloadUrl('https://www.tiktok.com/@u/video/123?x=1') === 'https://www.tiktok.com/@u/video/123',
  'tiktok clean',
);
assert(isYtDlpUrl('https://www.youtube.com/watch?v=demo'), 'yt host');
assert(isYtDlpUrl('youtube.com/watch?v=x'), 'yt host no scheme');
assert(!isYtDlpUrl('https://example.com/a.zip'), 'not yt');
assert(needsBrowserCookies('https://www.douyin.com/video/1'), 'douyin cookie');
assert(!needsBrowserCookies('https://www.youtube.com/watch?v=1'), 'yt no cookie default');
assert(
  cookieBrowserArgs('chrome', 'https://www.douyin.com/video/1').join(' ') === '--cookies-from-browser chrome',
  'cookie args',
);
assert(cookieBrowserArgs('', 'https://www.douyin.com/video/1').length === 0, 'no cookie browser');
assert(cookieBrowserArgs('chrome', 'https://example.com/a.zip').length === 0, 'cookie only sensitive hosts');
assert(cookieBrowserArgs('twinkstar', 'https://www.douyin.com/video/1').length === 0, 'twinkstar resolved upstream');
assert(
  cookieBrowserArgs(
    'chrome:C:\\Users\\x\\AppData\\Local\\Twinkstar\\User Data',
    'https://www.douyin.com/video/1',
  ).join(' ') ===
    '--cookies-from-browser chrome:C:\\Users\\x\\AppData\\Local\\Twinkstar\\User Data',
  'chrome profile path args',
);

assert(isHlsUrl('https://cdn.example/live/index.m3u8'), 'hls url');
const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
hi.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
hd.m3u8
`;
const variants = parseHlsMaster(master, 'https://cdn.example/live/master.m3u8');
assert(variants.length === 3, '3 variants');
assert(pickHlsVariant(variants)?.height === 1080, 'pick best');
assert(pickHlsVariant(variants, 720)?.height === 720, 'pick cap 720');
assert(variants[0].uri.includes('cdn.example/live/low.m3u8'), 'absolute uri');

const media = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4.0,
seg0.ts
#EXTINF:4.0,
seg1.ts
#EXT-X-ENDLIST
`;
const { segments, encrypted } = parseHlsMediaSegments(media, 'https://cdn.example/live/hi.m3u8');
assert(!encrypted && segments.length === 2, 'media segments');
assert(segments[1].endsWith('/seg1.ts'), 'seg uri');

const enc = parseHlsMediaSegments('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\ns.ts\n', 'https://x/y.m3u8');
assert(enc.encrypted, 'aes detected');

assert(formatExpressionForQuality('1080').includes('1080'), 'quality 1080');
assert(formatExpressionForQuality('audio') === 'bestaudio/best', 'audio format');

console.log('smoke-p2: OK');
