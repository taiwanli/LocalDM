const statusEl = document.getElementById('status');
const portEl = document.getElementById('port');
const tokenEl = document.getElementById('token');
const minSizeEl = document.getElementById('minSize');
const sniffEnabledEl = document.getElementById('sniffEnabled');
const takeoverEnabledEl = document.getElementById('takeoverEnabled');
const systemTakeoverEl = document.getElementById('systemTakeover');
const listEl = document.getElementById('list');

async function loadSettings() {
  const data = await chrome.storage.local.get({
    apiPort: 37280,
    sniffEnabled: true,
    takeoverEnabled: false,
    systemTakeover: false,
    minMediaKb: 200,
    apiToken: '',
  });
  portEl.value = String(data.apiPort);
  tokenEl.value = data.apiToken || '';
  takeoverEnabledEl.checked = Boolean(data.takeoverEnabled);
  systemTakeoverEl.checked = Boolean(data.systemTakeover);
  sniffEnabledEl.checked = Boolean(data.sniffEnabled);
  takeoverEnabledEl.checked = Boolean(data.takeoverEnabled);
  minSizeEl.value = String(data.minMediaKb);
  return data;
}

async function refreshHealth() {
  const response = await chrome.runtime.sendMessage({ type: 'localdm:health' });
  if (response && response.ok) {
    statusEl.textContent = `桌面端已连接 · 127.0.0.1:${response.port}`;
    statusEl.classList.add('ok');
    statusEl.classList.remove('bad');
  } else {
    statusEl.textContent = `桌面端未运行（端口 ${portEl.value}）· 可用 localdm:// 冷启动`;
    statusEl.classList.add('bad');
    statusEl.classList.remove('ok');
  }
}

async function refreshResources() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id ?? 0;
  const response = await chrome.runtime.sendMessage({ type: 'localdm:list-resources', tabId });
  const resources = (response && response.resources) || [];
  listEl.innerHTML = '';
  if (!resources.length) {
    const empty = document.createElement('div');
    empty.className = 'row';
    empty.textContent = '本页暂无独立媒体。抖音/YouTube 等请用「按当前页面送入」（yt-dlp）。';
    listEl.appendChild(empty);
    return;
  }
  for (const item of resources) {
    const row = document.createElement('div');
    row.className = 'item';
    const url = document.createElement('div');
    url.className = 'url';
    url.title = item.url || '';
    const src = item.source ? ` · ${item.source}` : '';
    url.textContent = (item.filename || item.url || '') + src;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '下载';
    btn.addEventListener('click', () => {
      const isMedia = /\.(m3u8|mpd|mp4|mp3|m4a|webm|mkv|mov)(\?|$)/i.test(item.url || '');
      chrome.runtime.sendMessage({
        type: 'localdm:capture',
        payload: {
          kind: isMedia ? 'sniffed-media' : 'direct',
          url: item.url,
          pageUrl: tab?.url || item.url,
          title: tab?.title || item.title || '',
          suggestedFilename: item.filename,
        },
      });
    });
    row.appendChild(url);
    row.appendChild(btn);
    listEl.appendChild(row);
  }
}

document.getElementById('save').addEventListener('click', async () => {
  const systemOn = Boolean(systemTakeoverEl?.checked);
  await chrome.storage.local.set({
    apiPort: Number(portEl.value) || 37280,
    sniffEnabled: sniffEnabledEl.checked,
    takeoverEnabled: takeoverEnabledEl.checked,
    systemTakeover: systemOn,
    minMediaKb: Number(minSizeEl.value) || 200,
    apiToken: (tokenEl.value || '').trim(),
  });
  // Best-effort: push system takeover flag to desktop settings when token present.
  try {
    const port = Number(portEl.value) || 37280;
    const token = (tokenEl.value || '').trim();
    if (token) {
      await fetch(`http://127.0.0.1:${port}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ systemTakeoverEnabled: systemOn }),
      });
    }
  } catch {
    /* desktop may not require token or may be offline */
  }
  await refreshHealth();
});

document.getElementById('refresh').addEventListener('click', () => {
  void refreshResources();
});

document.getElementById('sendPage').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  let host = '';
  try {
    host = new URL(tab.url).hostname;
  } catch {
    host = '';
  }
  const platform =
    /(^|\.)(youtube\.com|youtu\.be|twitter\.com|x\.com|reddit\.com|redd\.it|tiktok\.com|vimeo\.com|bilibili\.com|facebook\.com|instagram\.com|twitch\.tv|dailymotion\.com)$/i.test(
      host,
    );
  await chrome.runtime.sendMessage({
    type: 'localdm:capture',
    payload: {
      kind: platform ? 'video-platform' : 'direct',
      url: tab.url,
      pageUrl: tab.url,
      title: tab.title || '',
    },
  });
});

void loadSettings().then(() => Promise.all([refreshHealth(), refreshResources()]));
