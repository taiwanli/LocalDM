import type { CapturePayload, Category, MediaKind } from '../../shared/types';
import { isAllowedDownloadUrl, isMagnetUrl } from '../../shared/url';

export const CAPTURE_PATH = '/capture';
export const MAX_CAPTURE_BODY_BYTES = 256 * 1024;

const ALLOWED_KINDS = new Set<MediaKind>([
  'direct',
  'video-platform',
  'sniffed-media',
  'torrent',
  'magnet',
]);
const ALLOWED_CATEGORIES = new Set<Category>([
  'video',
  'music',
  'program',
  'archive',
  'document',
  'model',
  'torrent',
  'other',
]);

export function parseCaptureBody(raw: string): CapturePayload {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_CAPTURE_BODY_BYTES) {
    throw new Error('[capture] body missing or too large');
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('[capture] invalid JSON');
  }
  if (!data || typeof data !== 'object') {
    throw new Error('[capture] payload must be object');
  }
  const payload = data as Partial<CapturePayload>;
  const urlRaw = payload.url;
  const magnet = typeof urlRaw === 'string' && isMagnetUrl(urlRaw);
  const urlOk =
    typeof urlRaw === 'string' &&
    (magnet ? urlRaw.length <= 4096 : isAllowedDownloadUrl(urlRaw));
  if (!urlOk || typeof payload.url !== 'string') {
    throw new Error('[capture] url must be http(s) or magnet and within length limit');
  }
  const kind = (payload.kind ?? 'direct') as MediaKind;
  if (!ALLOWED_KINDS.has(kind)) {
    throw new Error(`[capture] unsupported kind=${String(payload.kind)}`);
  }
  const category =
    payload.category && ALLOWED_CATEGORIES.has(payload.category) ? payload.category : undefined;
  return {
    kind,
    url: payload.url.trim(),
    pageUrl: typeof payload.pageUrl === 'string' ? payload.pageUrl.slice(0, 2048) : undefined,
    title: typeof payload.title === 'string' ? payload.title.slice(0, 500) : undefined,
    suggestedFilename:
      typeof payload.suggestedFilename === 'string'
        ? payload.suggestedFilename.slice(0, 300)
        : undefined,
    category,
    headers:
      payload.headers && typeof payload.headers === 'object'
        ? Object.fromEntries(
            Object.entries(payload.headers)
              .filter(([, value]) => typeof value === 'string')
              .slice(0, 20)
              .map(([key, value]) => [key.slice(0, 64), String(value).slice(0, 2000)]),
          )
        : undefined,
  };
}
