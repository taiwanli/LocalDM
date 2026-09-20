import { parseCaptureBody } from '../electron/api/protocol';
import { isAllowedDownloadUrl, isMagnetUrl, sanitizeFilename } from '../shared/url';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-api] ${message}`);
}

assert(isAllowedDownloadUrl('https://example.com/a.bin'), 'https allowed');
assert(!isAllowedDownloadUrl('file:///etc/passwd'), 'file protocol rejected');
assert(!isAllowedDownloadUrl('javascript:alert(1)'), 'javascript rejected');
assert(sanitizeFilename('../../etc/passwd') === '.._.._etc_passwd' || !sanitizeFilename('../../etc/passwd').includes('/') , 'path traversal neutralized');
assert(sanitizeFilename('CON.txt').startsWith('_'), 'windows reserved prefixed');

const payload = parseCaptureBody(
  JSON.stringify({
    kind: 'direct',
    url: 'https://example.com/demo.zip',
    suggestedFilename: 'demo.zip',
  }),
);
assert(payload.url === 'https://example.com/demo.zip', 'capture url parsed');

let rejected = false;
try {
  parseCaptureBody(JSON.stringify({ kind: 'direct', url: 'ftp://x/y' }));
} catch {
  rejected = true;
}
assert(rejected, 'capture rejects non-http url');

const magnet = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=demo';
assert(isMagnetUrl(magnet), 'magnet url helper');
const magnetPayload = parseCaptureBody(
  JSON.stringify({ kind: 'magnet', url: magnet, category: 'torrent' }),
);
assert(magnetPayload.kind === 'magnet' && magnetPayload.category === 'torrent', 'capture accepts magnet + torrent category');

console.log('smoke-api: OK');
