/** yt-dlp platform hosts (IA alignment; original code). */
export const YTDLP_HOSTS =
  /(^|\.)(youtube\.com|youtu\.be|twitter\.com|x\.com|reddit\.com|redd\.it|tiktok\.com|vimeo\.com|bilibili\.com|facebook\.com|instagram\.com|twitch\.tv|dailymotion\.com|nicovideo\.jp|weibo\.com|douyin\.com|iesdouyin\.com)$/i;

/** Hosts that typically need --cookies-from-browser when cookieBrowser is set. */
export const COOKIE_SENSITIVE_HOSTS =
  /(^|\.)(douyin\.com|iesdouyin\.com)$/i;

export function isYtDlpPlatformHost(hostname: string): boolean {
  return YTDLP_HOSTS.test(hostname || '');
}

export function needsBrowserCookies(url: string): boolean {
  try {
    return COOKIE_SENSITIVE_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export type CookieBrowser = '' | 'chrome' | 'edge' | 'firefox' | 'twinkstar';

/** Normalize pasted URLs: add https, rewrite platform share links. */
export function normalizeDownloadUrl(raw: string): string {
  if (typeof raw !== 'string') return raw;
  let s = raw.trim();
  if (!s) return s;
  if (/^magnet:/i.test(s)) return s;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (s.startsWith('//')) s = 'https:' + s;
    else if (/^[\w-]+(\.[\w-]+)+([:/?#]|$)/.test(s)) s = 'https://' + s;
    else return s;
  }
  return rewritePlatformUrl(s);
}

export function rewritePlatformUrl(s: string): string {
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./i, '');
    // Douyin: modal_id → standard /video/id
    if (/(^|\.)douyin\.com$/i.test(host) || /(^|\.)iesdouyin\.com$/i.test(host)) {
      const modal = u.searchParams.get('modal_id');
      if (modal && /^\d+$/.test(modal)) {
        return `https://www.douyin.com/video/${modal}`;
      }
    }
    // TikTok: keep /@user/video/id, drop noisy query
    if (/(^|\.)tiktok\.com$/i.test(host)) {
      const m = u.pathname.match(/\/@[\w.-]+\/video\/(\d+)/);
      if (m) return `https://www.tiktok.com${u.pathname}`;
    }
  } catch {
    /* keep original */
  }
  return s;
}

export function isYtDlpUrl(raw: string): boolean {
  const url = normalizeDownloadUrl(raw);
  try {
    return isYtDlpPlatformHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function isM3u8Url(raw: string): boolean {
  return /\.(m3u8)(\?|$)/i.test(raw) || /\/hls\//i.test(raw);
}

export function cookieBrowserArgs(
  browser: CookieBrowser | string | undefined,
  url: string,
): string[] {
  const raw = String(browser || '').trim();
  if (!raw) return [];
  if (!needsBrowserCookies(url)) return [];
  const lower = raw.toLowerCase();
  // Resolved to chrome:<userData> by MediaEngine before this helper.
  if (lower === 'twinkstar') return [];
  if (['chrome', 'edge', 'firefox', 'chromium', 'brave'].includes(lower)) {
    return ['--cookies-from-browser', lower];
  }
  // chrome:C:\Users\...\User Data — keep path casing
  const m = raw.match(/^(chrome|chromium|edge|brave):(.+)$/i);
  if (m) return ['--cookies-from-browser', `${m[1].toLowerCase()}:${m[2]}`];
  return [];
}
