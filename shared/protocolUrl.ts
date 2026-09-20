import { isMagnetUrl } from './url';

export const CAPTURE_PATH = '/capture';

/** localdm://download?url=<http(s)|magnet> — system/external handoff shortcut. */
export function buildDownloadProtocolUrl(targetUrl: string): string {
  return `localdm://download?url=${encodeURIComponent(targetUrl)}`;
}

export function decodeProtocolCapture(protocolUrl: string): unknown {
  if (typeof protocolUrl !== 'string' || !protocolUrl.toLowerCase().startsWith('localdm://')) {
    throw new Error('[protocol] not a localdm url');
  }
  let parsed: URL;
  try {
    parsed = new URL(protocolUrl);
  } catch {
    throw new Error('[protocol] invalid url');
  }
  // Shortcut: localdm://download?url=...
  const host = (parsed.hostname || parsed.pathname.replace(/^\//, '')).toLowerCase();
  if (host === 'download') {
    const target = parsed.searchParams.get('url') || parsed.searchParams.get('u');
    if (!target) throw new Error('[protocol] download missing url');
    return {
      kind: isMagnetUrl(target) ? 'magnet' : 'direct',
      url: target,
    };
  }
  const data = parsed.searchParams.get('data');
  if (!data) throw new Error('[protocol] missing data');
  const json = Buffer.from(data, 'base64').toString('utf8');
  return JSON.parse(json);
}

/** Clipboard text → capture payload, or null if not a download URL. */
export function classifyClipboardDownloadText(
  text: string,
): { kind: 'direct' | 'magnet'; url: string } | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  if (/\s/.test(trimmed) && !isMagnetUrl(trimmed)) return null;
  if (isMagnetUrl(trimmed)) return { kind: 'magnet', url: trimmed };
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  return { kind: 'direct', url: trimmed };
}
