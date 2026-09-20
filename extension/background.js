/**
 * LocalDM MV3 background (original implementation).
 * Stronger media sniff + takeover notifications + platform routing to desktop yt-dlp.
 */

const DEFAULT_PORT = 37280;
const MIN_MEDIA_SIZE = 200 * 1024;

/** Platform hosts → desktop yt-dlp (page URL), not fragment sniff. */
const VIDEO_PLATFORMS =
  /(^|\.)(youtube\.com|youtu\.be|twitter\.com|x\.com|reddit\.com|redd\.it|tiktok\.com|vimeo\.com|bilibili\.com|facebook\.com|instagram\.com|twitch\.tv|dailymotion\.com|douyin\.com|iesdouyin\.com|kuaishou\.com|ixigua\.com|zhihu\.com|xiaohongshu\.com|xhslink\.com|weibo\.com|nicovideo\.jp)$/i;

const PLATFORM_PATH = /\/(watch|status|video|videos|reel|shorts|video_id|modal_id|v\/|tv\/|note|explore)/i;

const MEDIA_EXT =
  /\.(m3u8|mpd|mp4|m4v|webm|mkv|mov|avi|flv|ts|m4s|m3u|mp3|m4a|aac|flac|wav|ogg|opus|weba)(\?|#|$)/i;

const NOISE_URL =
  /videoplayback|googlevideo|\/live\/\d+|\/avatar|\/profile|\/thumb|placeholder|sprite|\.jpg$|\.jpeg$|\.png$|\.gif$|\.webp$|\.svg$|\.ico$/i;

const CATEGORY_EXT = {
  video: ['mp4', 'm4v', 'mkv', 'mov', 'avi', 'webm', 'flv', 'ts', 'm4s'],
  music: ['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'weba'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz'],
  program: ['exe', 'msi', 'dmg', 'deb', 'rpm'],
  document: ['pdf', 'doc', 'docx', 'txt', 'epub'],
  model: ['gguf', 'safetensors', 'bin', 'ckpt', 'pt', 'pth', 'onnx'],
  torrent: ['torrent'],
};

function isInternalBrowserUrl(url) {
  return /^(chrome|edge|about|devtools|chrome-extension|moz-extension|brave|vivaldi):/i.test(
    String(url || ''),
  );
}

function isMagnetLink(url) {
  return typeof url === 'string' && url.trim().toLowerCase().startsWith('magnet:?');
}

function isTorrentLink(url) {
  return isMagnetLink(url) || /\.torrent(\?|$)/i.test(String(url || ''));
}

function isHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

async function getSettings() {
  return chrome.storage.local.get({
    apiPort: DEFAULT_PORT,
    takeoverEnabled: false,
    systemTakeover: false,
    sniffEnabled: true,
    apiToken: '',
    minMediaKb: 200,
  });
}

async function resolveTakeoverEnabled() {
  const settings = await getSettings();
  if (settings.takeoverEnabled || settings.systemTakeover) return true;
  try {
    const port = Number(settings.apiPort) || DEFAULT_PORT;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await res.json();
    return Boolean(body && body.systemTakeoverEnabled);
  } catch {
    return false;
  }
}

function authHeaders(token) {
  const value = (token || '').trim();
  return value ? { Authorization: `Bearer ${value}` } : {};
}

async function getDesktopEndpoint() {
  const { apiPort } = await getSettings();
  const port = Number(apiPort) || DEFAULT_PORT;
  return `http://127.0.0.1:${port}/capture`;
}

function categoryFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.includes('.') ? pathname.split('.').pop().toLowerCase() : '';
    for (const [category, list] of Object.entries(CATEGORY_EXT)) {
      if (list.includes(ext)) return category;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function isVideoPlatform(hostname) {
  return VIDEO_PLATFORMS.test(hostname || '');
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isPlatformPageUrl(pageUrl) {
  return isVideoPlatform(hostnameOf(pageUrl || ''));
}

function absolutize(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last.split('?')[0] || 'media';
  } catch {
    return String(url || 'media').split('/').pop() || 'media';
  }
}

/** Stronger filter: keep playable media / playlists; drop blob, posters, platform noise. */
function isSniffableMedia(url, contentLength, minBytes) {
  if (!isHttpUrl(url)) return false;
  if (NOISE_URL.test(url)) return false;
  if (!MEDIA_EXT.test(url)) return false;
  // Platform video pages/CDN fragments: let desktop yt-dlp own the page URL.
  const host = hostnameOf(url);
  if (isVideoPlatform(host) && !/\.(m3u8|mpd|mp4|mp3|m4a)(\?|$)/i.test(url)) {
    // allow direct media files even on platform CDNs
    if (/videoplayback|m3u8|\/seg/i.test(url) && !/\.mp4(\?|$)/i.test(url)) return false;
  }
  const min = Number(minBytes) > 0 ? Number(minBytes) * 1024 : MIN_MEDIA_SIZE;
  if (contentLength != null && contentLength > 0 && contentLength < min) {
    // playlists stay even if small
    if (!/\.(m3u8|mpd)(\?|$)/i.test(url)) return false;
  }
  return true;
}

function encodeProtocolData(payload) {
  const json = JSON.stringify(payload);
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)));
}

function notifyLocalDm(title, message) {
  try {
    chrome.notifications.create(
      `localdm-${Date.now()}`,
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title,
        message,
        priority: 0,
      },
      () => undefined,
    );
  } catch {
    /* notifications optional */
  }
}

async function sendCapture(payload, { silent } = {}) {
  if (!payload || !payload.url || isInternalBrowserUrl(payload.url)) {
    return { ok: false, error: 'invalid_url' };
  }
  if (!isHttpUrl(payload.url) && !isMagnetLink(payload.url) && !isTorrentLink(payload.url)) {
    return { ok: false, error: 'invalid_url' };
  }
  const endpoint = await getDesktopEndpoint();
  const settings = await getSettings();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(settings.apiToken) },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body && body.ok !== false) {
      if (!silent) {
        notifyLocalDm('LocalDM', `已交给 LocalDM 下载：${payload.suggestedFilename || payload.title || filenameFromUrl(payload.url)}`);
      }
      return { ok: true, via: 'http', task: body.task };
    }
  } catch {
    /* fall through */
  }
  const proto = `localdm://capture?data=${encodeURIComponent(encodeProtocolData(payload))}`;
  try {
    await chrome.tabs.create({ url: proto });
    if (!silent) {
      notifyLocalDm('LocalDM', `已通过协议交给 LocalDM：${filenameFromUrl(payload.url)}`);
    }
    return { ok: true, via: 'protocol' };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function resourceScore(item) {
  const url = item.url || '';
  let score = 0;
  if (/\.(m3u8|mpd)(\?|$)/i.test(url)) score += 50;
  if (/\.(mp4|mkv|mov|webm|mp3|m4a|flac)(\?|$)/i.test(url)) score += 40;
  if (/\.ts$|\.m4s/i.test(url)) score += 5;
  if (item.bytes && item.bytes >= MIN_MEDIA_SIZE) score += 20;
  return score;
}

async function pushResource(tabId, resource) {
  if (!tabId || !resource || !resource.url) return;
  const key = `res:${tabId}`;
  const data = await chrome.storage.session.get(key);
  const list = Array.isArray(data[key]) ? data[key] : [];
  if (list.some((item) => item.url === resource.url)) return;
  list.unshift({ ...resource, at: Date.now() });
  list.sort((a, b) => resourceScore(b) - resourceScore(a) || b.at - a.at);
  await chrome.storage.session.set({ [key]: list.slice(0, 80) });
}

/** Platform page → yt-dlp page URL. Otherwise sniffed media direct. */
function classifyForCapture(url, pageUrl) {
  const pageIsPlatform = isPlatformPageUrl(pageUrl || url);
  const urlHost = hostnameOf(url);
  if (isVideoPlatform(urlHost) && !MEDIA_EXT.test(url)) {
    return { kind: 'video-platform', url, pageUrl: pageUrl || url, category: 'video' };
  }
  if (pageIsPlatform && !isVideoPlatform(urlHost)) {
    // media on non-platform CDN from a platform page still often needs yt-dlp headers
    return { kind: 'video-platform', url: pageUrl || url, pageUrl: pageUrl || url, category: 'video' };
  }
  return {
    kind: 'sniffed-media',
    url,
    pageUrl: pageUrl || url,
    category: categoryFromUrl(url),
  };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'localdm-dl',
      title: '使用 LocalDM 下载此链接',
      contexts: ['link'],
    });
    chrome.contextMenus.create({
      id: 'localdm-bt',
      title: '使用 LocalDM 下载磁力/种子',
      contexts: ['link', 'page', 'selection'],
    });
    chrome.contextMenus.create({
      id: 'localdm-video',
      title: '使用 LocalDM 下载此视频（含抖音/YouTube/B站等）',
      contexts: ['page', 'video'],
    });
    chrome.contextMenus.create({
      id: 'localdm-all',
      title: '嗅探本页媒体到 LocalDM',
      contexts: ['page'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const pageUrl = tab?.url || info.pageUrl || '';
  if (info.menuItemId === 'localdm-all') {
    if (isPlatformPageUrl(pageUrl)) {
      await sendCapture({
        kind: 'video-platform',
        url: pageUrl,
        pageUrl,
        title: tab?.title || '',
        category: 'video',
      });
      return;
    }
    const key = `res:${tab?.id ?? 0}`;
    const data = await chrome.storage.session.get(key);
    const list = Array.isArray(data[key]) ? data[key] : [];
    if (!list.length) {
      await sendCapture({
        kind: 'direct',
        url: pageUrl,
        pageUrl,
        title: tab?.title || '',
      });
      return;
    }
    const seen = new Set();
    for (const item of list.slice(0, 8)) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      const classified = classifyForCapture(item.url, pageUrl);
      await sendCapture(
        {
          ...classified,
          title: tab?.title || item.title || '',
          suggestedFilename: item.filename,
        },
        { silent: true },
      );
    }
    notifyLocalDm('LocalDM', `已送入 ${seen.size} 条嗅探资源`);
    return;
  }

  const url = info.linkUrl || info.srcUrl || info.pageUrl;
  if (!url) return;
  if (info.menuItemId === 'localdm-bt' || isTorrentLink(url)) {
    const btUrl = isMagnetLink(url)
      ? url
      : isMagnetLink(info.selectionText || '')
        ? (info.selectionText || '').trim()
        : url;
    const magnetish = isMagnetLink(btUrl) || isTorrentLink(btUrl);
    if (!magnetish && info.menuItemId !== 'localdm-bt') return;
    await sendCapture({
      kind: isMagnetLink(btUrl) ? 'magnet' : 'torrent',
      url: btUrl,
      pageUrl,
      title: tab?.title || '',
      category: 'torrent',
    });
    return;
  }

  let host = hostnameOf(url);
  const platformPage = isVideoPlatform(host) || isPlatformPageUrl(pageUrl);
  const kind =
    info.menuItemId === 'localdm-video' || platformPage ? 'video-platform' : 'direct';
  const target =
    kind === 'video-platform' && !info.linkUrl ? pageUrl || url : url;
  await sendCapture({
    kind,
    url: target,
    pageUrl: pageUrl || target,
    title: tab?.title || '',
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'localdm:capture') {
    void sendCapture(message.payload).then((result) => sendResponse(result));
    return true;
  }
  if (message.type === 'localdm:sniff-seen') {
    const tabId = sender.tab?.id;
    void pushResource(tabId, message.resource || {}).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'localdm:list-resources') {
    const key = `res:${message.tabId ?? 0}`;
    void chrome.storage.session.get(key).then((data) => {
      sendResponse({ ok: true, resources: data[key] || [] });
    });
    return true;
  }
  if (message.type === 'localdm:health') {
    void (async () => {
      const { apiPort } = await getSettings();
      const port = Number(apiPort) || DEFAULT_PORT;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        const body = await res.json();
        sendResponse({ ok: res.ok, port, body });
      } catch (error) {
        sendResponse({ ok: false, port, error: String(error) });
      }
    })();
    return true;
  }
  return undefined;
});

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    void (async () => {
      const { sniffEnabled, minMediaKb } = await getSettings();
      if (!sniffEnabled) return;
      const url = details.url;
      if (!isHttpUrl(url)) return;
      if (isInternalBrowserUrl(url)) return;
      let contentLength;
      const header = (details.responseHeaders || []).find(
        (item) => item.name && item.name.toLowerCase() === 'content-length',
      );
      if (header?.value) contentLength = Number(header.value);
      if (!isSniffableMedia(url, contentLength, minMediaKb)) return;
      await pushResource(details.tabId, {
        url,
        title: '',
        filename: filenameFromUrl(url),
        bytes: contentLength || 0,
        source: 'webRequest',
      });
    })();
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders'],
);

const capturedDownloadUrls = new Map();

function markCaptured(url) {
  const now = Date.now();
  for (const [u, t] of capturedDownloadUrls) {
    if (now - t > 8000) capturedDownloadUrls.delete(u);
  }
  if (capturedDownloadUrls.has(url)) return false;
  capturedDownloadUrls.set(url, now);
  return true;
}

chrome.downloads.onCreated.addListener((item) => {
  void (async () => {
    const enabled = await resolveTakeoverEnabled();
    if (!enabled) return;
    const url = item.finalUrl || item.url || '';
    if (!url || isInternalBrowserUrl(url) || /^(blob:|data:|file:)/i.test(url)) return;
    if (!isHttpUrl(url) && !isMagnetLink(url)) return;
    if (item.filename && /(^|[\\/])LocalDM([\\/]|$)/.test(item.filename)) return;
    if (!markCaptured(url)) {
      try {
        await chrome.downloads.cancel(item.id);
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      await chrome.downloads.cancel(item.id);
    } catch {
      /* already gone */
    }
    try {
      await chrome.downloads.erase({ id: item.id });
    } catch {
      /* ignore */
    }

    const filename = (item.filename || filenameFromUrl(url)).split(/[\\/]/).pop();
    const category = categoryFromUrl(url);
    const kind = isMagnetLink(url)
      ? 'magnet'
      : /\.torrent(\?|$)/i.test(url)
        ? 'torrent'
        : 'direct';
    await sendCapture({
      kind,
      url,
      suggestedFilename: filename || undefined,
      category: kind === 'direct' ? category : 'torrent',
    });
  })();
});

chrome.downloads.onDeterminingFilename.addListener(async (item, suggest) => {
  const enabled = await resolveTakeoverEnabled();
  if (!enabled || !item.finalUrl || !item.filename) {
    suggest({});
    return;
  }
  try {
    const category = categoryFromUrl(item.finalUrl);
    if (!category) {
      suggest({});
      return;
    }
    const filename = item.filename.split(/[\\/]/).pop() || item.filename;
    suggest({ filename: `LocalDM/${category}/${filename}` });
  } catch {
    suggest({});
  }
});
