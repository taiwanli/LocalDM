export const MAX_URL_LENGTH = 2048;
export const MAX_FILENAME_LENGTH = 180;

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

const INVALID_NAME_CHARS = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

export function isAllowedDownloadUrl(raw: string): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol);
}

export function sanitizeFilename(raw: string | null | undefined): string {
  const fallback = 'download.bin';
  if (!raw || typeof raw !== 'string') return fallback;
  let name = raw.trim();
  for (const ch of INVALID_NAME_CHARS) {
    name = name.split(ch).join('_');
  }
  let cleaned = '';
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code >= 32) cleaned += ch;
  }
  name = cleaned.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!name) return fallback;
  if (name.length > MAX_FILENAME_LENGTH) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
    name = name.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext;
  }
  const stem = name.split('.')[0]?.toUpperCase() ?? '';
  if (WINDOWS_RESERVED.has(stem)) {
    name = `_${name}`;
  }
  return name;
}

export function categoryFromFilename(filename: string): import('./types').Category {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  if (['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv'].includes(ext)) return 'video';
  if (['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg'].includes(ext)) return 'music';
  if (['exe', 'msi', 'dmg', 'app', 'deb', 'rpm', 'msix'].includes(ext)) return 'program';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return 'archive';
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'epub', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext))
    return 'document';
  if (['gguf', 'safetensors', 'bin', 'ckpt', 'pt', 'pth', 'onnx', 'h5', 'tflite'].includes(ext))
    return 'model';
  if (ext === 'torrent') return 'torrent';
  return 'other';
}

export function filenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const last = decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? '');
    return sanitizeFilename(last || 'download.bin');
  } catch {
    return 'download.bin';
  }
}

/** Split stem/ext and return `stem (n).ext` when the name already exists on disk. */
export function uniqueFilename(dir: string, name: string, exists: (p: string) => boolean): string {
  const candidate = sanitizeFilename(name) || 'download.bin';
  const sep = dir.includes('/') && !dir.includes('\\') ? '/' : '\\';
  const full = (n: string) => `${dir.replace(/[\\/]+$/, '')}${sep}${n}`;
  if (!exists(full(candidate))) return candidate;
  const dot = candidate.lastIndexOf('.');
  const stem = dot > 0 ? candidate.slice(0, dot) : candidate;
  const ext = dot > 0 ? candidate.slice(dot) : '';
  for (let i = 1; i < 10000; i += 1) {
    const next = `${stem} (${i})${ext}`;
    if (!exists(full(next))) return next;
  }
  return `${stem} (${Date.now()})${ext}`;
}

const CONTENT_TYPE_EXT: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/x-rar-compressed': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/gzip': '.gz',
  'application/pdf': '.pdf',
  'application/x-msdownload': '.exe',
  'application/vnd.apple.mpegurl': '.m3u8',
  'application/json': '.json',
  'text/plain': '.txt',
};

/** Append extension from Content-Type only when filename has no safe extension. */
export function applyContentTypeExtension(
  filename: string,
  contentType: string | null | undefined,
): string {
  const base = sanitizeFilename(filename) || 'download.bin';
  const ctype = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!ctype) return base;
  const hasExt = /\.[A-Za-z0-9]{1,12}$/.test(base) && !/\s\.[A-Za-z0-9]+$/.test(base);
  if (hasExt && !/^download$/i.test(base)) return base;
  let ext = CONTENT_TYPE_EXT[ctype] || '';
  if (!ext) {
    if (ctype.startsWith('video/')) ext = '.mp4';
    else if (ctype.startsWith('audio/')) ext = '.m4a';
    else if (ctype.startsWith('image/')) ext = '.' + ctype.slice(6).replace('jpeg', 'jpg');
  }
  if (!ext) {
    return /^download$/i.test(base) ? `download_${Date.now()}` : base;
  }
  const stem = /^download$/i.test(base) ? 'download' : base.replace(/\.[^.]+$/, '');
  return stem + ext;
}

export function isHuggingFaceUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'huggingface.co' || host.endsWith('.huggingface.co') || host === 'hf.co' || host.endsWith('.hf.co');
  } catch {
    return false;
  }
}

export function isMagnetUrl(raw: string): boolean {
  return typeof raw === 'string' && raw.trim().toLowerCase().startsWith('magnet:?');
}

export function isTorrentUrl(raw: string): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (isMagnetUrl(trimmed)) return true;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return /\.torrent(\?|$)/i.test(parsed.pathname + parsed.search);
  } catch {
    return false;
  }
}

/** Parse `Key: Value` lines into a header map. */
export function parseHeadersText(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!text) return headers;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}
