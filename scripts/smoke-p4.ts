import { buildProxyUrl, effectiveHttpProxy, parseProxyUrl } from '../shared/proxy';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-p4] ${message}`);
}

assert(
  buildProxyUrl({
    proxyEnabled: true,
    proxyType: 'http',
    proxyHost: '127.0.0.1',
    proxyPort: '7890',
  }) === 'http://127.0.0.1:7890',
  'http proxy',
);
assert(
  buildProxyUrl({
    proxyEnabled: true,
    proxyType: 'socks',
    proxyHost: '1.2.3.4',
    proxyPort: 1080,
    proxyUser: 'u',
    proxyPass: 'p@1',
  }) === 'socks5://u:p%401@1.2.3.4:1080',
  'socks auth encode',
);
assert(buildProxyUrl({ proxyEnabled: false, proxyHost: 'x', proxyPort: 1 }) === '', 'disabled');
assert(buildProxyUrl({ proxyHost: '', proxyPort: 80 }) === '', 'missing host');

const parsed = parseProxyUrl('socks5://user:pass@10.0.0.2:1080');
assert(parsed.proxyType === 'socks5' && parsed.proxyHost === '10.0.0.2', 'parse host');
assert(parsed.proxyPort === '1080' && parsed.proxyUser === 'user' && parsed.proxyPass === 'pass', 'parse auth');

assert(
  effectiveHttpProxy({
    proxyType: 'http',
    proxyHost: '127.0.0.1',
    proxyPort: '7890',
    httpProxy: '',
  } as never) === 'http://127.0.0.1:7890',
  'composed from structured',
);
assert(
  effectiveHttpProxy({
    proxyHost: '',
    httpProxy: 'http://legacy:3128',
  } as never) === 'http://legacy:3128',
  'legacy string fallback',
);

console.log('smoke-p4: OK');
