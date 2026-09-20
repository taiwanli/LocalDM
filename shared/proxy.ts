import type { AppSettings } from './types';

export type ProxyType = 'http' | 'https' | 'socks5' | 'socks4';

export function buildProxyUrl(input: {
  proxyEnabled?: boolean;
  proxyType?: string;
  proxyHost?: string;
  proxyPort?: string | number;
  proxyUser?: string;
  proxyPass?: string;
}): string {
  if (input.proxyEnabled === false) return '';
  const host = String(input.proxyHost || '').trim();
  const port = Number(input.proxyPort);
  if (!host || !Number.isFinite(port) || port <= 0) return '';
  let type = String(input.proxyType || 'http').toLowerCase();
  if (type === 'socks') type = 'socks5';
  if (!['http', 'https', 'socks5', 'socks4'].includes(type)) type = 'http';
  const auth = input.proxyUser
    ? `${encodeURIComponent(String(input.proxyUser))}:${encodeURIComponent(String(input.proxyPass || ''))}@`
    : '';
  return `${type}://${auth}${host}:${port}`;
}

export function parseProxyUrl(url: string): {
  proxyType: ProxyType;
  proxyHost: string;
  proxyPort: string;
  proxyUser: string;
  proxyPass: string;
} {
  const empty = {
    proxyType: 'http' as ProxyType,
    proxyHost: '',
    proxyPort: '',
    proxyUser: '',
    proxyPass: '',
  };
  const raw = String(url || '').trim();
  if (!raw) return empty;
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    const type = u.protocol.replace(':', '').toLowerCase();
    return {
      proxyType:
        type === 'socks5' || type === 'socks4' || type === 'https' ? (type as ProxyType) : 'http',
      proxyHost: u.hostname,
      proxyPort: u.port || '',
      proxyUser: decodeURIComponent(u.username || ''),
      proxyPass: decodeURIComponent(u.password || ''),
    };
  } catch {
    return empty;
  }
}

/** Compose AppSettings.httpProxy from structured fields (legacy string wins if no host). */
export function effectiveHttpProxy(settings: Partial<AppSettings>): string {
  const structured = buildProxyUrl({
    proxyEnabled: true,
    proxyType: settings.proxyType,
    proxyHost: settings.proxyHost,
    proxyPort: settings.proxyPort,
    proxyUser: settings.proxyUser,
    proxyPass: settings.proxyPass,
  });
  return structured || String(settings.httpProxy || '').trim();
}
