import {
  buildDownloadProtocolUrl,
  classifyClipboardDownloadText,
  decodeProtocolCapture,
} from '../shared/protocolUrl';
import { isMagnetUrl } from '../shared/url';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-takeover] ${message}`);
}

const magnet = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=demo';
const httpUrl = 'https://example.com/pkg.zip';

const proto = buildDownloadProtocolUrl(httpUrl);
assert(proto.startsWith('localdm://download?url='), 'protocol prefix');
const decoded = decodeProtocolCapture(proto) as { kind: string; url: string };
assert(decoded.url === httpUrl && decoded.kind === 'direct', 'decode download shortcut');

const magnetProto = buildDownloadProtocolUrl(magnet);
const magnetDecoded = decodeProtocolCapture(magnetProto) as { kind: string; url: string };
assert(magnetDecoded.kind === 'magnet' && isMagnetUrl(magnetDecoded.url), 'decode magnet shortcut');

assert(classifyClipboardDownloadText(httpUrl)?.kind === 'direct', 'clipboard http');
assert(classifyClipboardDownloadText(magnet)?.kind === 'magnet', 'clipboard magnet');
assert(classifyClipboardDownloadText('see https://example.com/a.zip later') === null, 'clipboard sentence rejected');
assert(classifyClipboardDownloadText('') === null, 'clipboard empty');
assert(classifyClipboardDownloadText('ftp://x/y') === null, 'clipboard non-http');

console.log('smoke-takeover: OK');
