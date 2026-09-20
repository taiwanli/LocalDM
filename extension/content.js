(function () {
  if (window.__localdmInjected) return;
  window.__localdmInjected = true;

  const MIN_WIDTH = 120;
  const MIN_HEIGHT = 80;
  const BUTTON_ID = 'localdm-hover-btn';
  const PLATFORM_HOST =
    /(^|\.)(youtube\.com|youtu\.be|twitter\.com|x\.com|reddit\.com|redd\.it|tiktok\.com|vimeo\.com|bilibili\.com|facebook\.com|instagram\.com|twitch\.tv|dailymotion\.com|douyin\.com|iesdouyin\.com|kuaishou\.com|ixigua\.com|zhihu\.com|xiaohongshu\.com|xhslink\.com|weibo\.com|nicovideo\.jp)$/i;

  const MEDIA_RE =
    /\.(m3u8|mpd|mp4|m4v|webm|mkv|mov|avi|flv|m3u|mp3|m4a|aac|flac|wav|ogg|opus)(\?|#|$)/i;
  const NOISE_RE =
    /blob:|data:|videoplayback|googlevideo|placeholder|sprite|\.jpg$|\.jpeg$|\.png$|\.gif$|\.webp$|\.svg$/i;

  function isPlatformPage() {
    return PLATFORM_HOST.test(location.hostname || '');
  }

  function report(url, source, extra) {
    if (!url || !/^https?:/i.test(url)) return;
    if (NOISE_RE.test(url)) return;
    if (!MEDIA_RE.test(url) && source !== 'page-platform') return;
    if (isPlatformPage() && source !== 'page-platform') return;
    try {
      url = new URL(url, location.href).href;
    } catch {
      /* keep raw */
    }
    chrome.runtime.sendMessage({
      type: 'localdm:sniff-seen',
      resource: {
        url,
        title: document.title || '',
        filename: (url.split('/').pop() || '').split('?')[0] || 'media',
        source,
        bytes: extra && extra.bytes,
      },
    });
  }

  function ensureStyles() {
    if (document.getElementById('localdm-style')) return;
    const style = document.createElement('style');
    style.id = 'localdm-style';
    style.textContent = `
      #${BUTTON_ID} {
        position: fixed;
        z-index: 2147483646;
        min-width: 120px;
        min-height: 32px;
        padding: 0 14px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.65);
        background: rgba(0,122,255,0.92);
        color: #fff;
        font: 500 12px/32px "Segoe UI", "PingFang SC", sans-serif;
        box-shadow: 0 8px 24px rgba(0,0,0,0.18);
        cursor: pointer;
        display: none;
      }
      #${BUTTON_ID}:hover { filter: brightness(1.05); }
    `;
    document.documentElement.appendChild(style);
  }

  function getButton() {
    ensureStyles();
    let btn = document.getElementById(BUTTON_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = BUTTON_ID;
      btn.type = 'button';
      btn.textContent = '下载该视频';
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const video = document.querySelector('video');
        // Platform (抖音/YouTube/B站等): always send PAGE url → desktop yt-dlp.
        // Non-platform: prefer real media src when present.
        let url;
        let kind;
        if (isPlatformPage()) {
          url = location.href;
          kind = 'video-platform';
        } else {
          url = video?.currentSrc || video?.src || '';
          kind = url && /^https?:/i.test(url) && MEDIA_RE.test(url) ? 'sniffed-media' : 'direct';
          if (!url || !/^https?:/i.test(url)) url = location.href;
        }
        chrome.runtime.sendMessage({
          type: 'localdm:capture',
          payload: {
            kind,
            url,
            pageUrl: location.href,
            title: document.title || '',
          },
        });
        btn.style.display = 'none';
      });
      document.documentElement.appendChild(btn);
    }
    return btn;
  }

  function placeButton(video) {
    const btn = getButton();
    const rect = video.getBoundingClientRect();
    if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) {
      btn.style.display = 'none';
      return;
    }
    btn.style.left = `${Math.max(8, rect.right - 132)}px`;
    btn.style.top = `${Math.max(8, rect.top + 8)}px`;
    btn.style.display = 'block';
  }

  function scanVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach((video) => {
      if (!(video instanceof HTMLVideoElement)) return;
      if (!video.__localdmTracked) {
        video.__localdmTracked = true;
        video.addEventListener('mouseenter', () => placeButton(video));
        video.addEventListener('mousemove', () => placeButton(video));
        video.addEventListener('mouseleave', () => {
          const btn = document.getElementById(BUTTON_ID);
          if (btn) btn.style.display = 'none';
        });
        video.addEventListener('loadedmetadata', () => scanVideos());
      }
      const src = video.currentSrc || video.src;
      if (src && !isPlatformPage()) report(src, 'video-element');
      const sources = video.querySelectorAll && video.querySelectorAll('source');
      if (sources) {
        sources.forEach((node) => {
          const s = node.getAttribute && node.getAttribute('src');
          if (s && !isPlatformPage()) report(s, 'source-element');
        });
      }
    });
  }

  function hookFetch() {
    if (window.fetch.__localdm) return;
    const original = window.fetch;
    const wrapped = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : input && input.url;
        if (url) report(url, 'fetch');
      } catch {
        /* ignore */
      }
      return original.apply(this, arguments);
    };
    wrapped.__localdm = true;
    window.fetch = wrapped;
  }

  function hookXhr() {
    const proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (!proto || proto.open.__localdm) return;
    const open = proto.open;
    proto.open = function (method, url) {
      try {
        this.__localdmUrl = typeof url === 'string' ? url : '';
      } catch {
        /* ignore */
      }
      return open.apply(this, arguments);
    };
    proto.open.__localdm = true;
    const send = proto.send;
    proto.send = function () {
      try {
        if (this.__localdmUrl) report(this.__localdmUrl, 'xhr');
      } catch {
        /* ignore */
      }
      return send.apply(this, arguments);
    };
  }

  function scanPerformanceEntries() {
    try {
      const entries = performance.getEntriesByType('resource') || [];
      for (const entry of entries) {
        if (entry && entry.name) {
          report(entry.name, 'performance', { bytes: entry.transferSize || entry.decodedBodySize });
        }
      }
    } catch {
      /* ignore */
    }
  }

  function scanMediaLinks() {
    try {
      document.querySelectorAll('a[href], video source, audio source').forEach((el) => {
        const href = el.getAttribute && el.getAttribute('href');
        const src = el.getAttribute && el.getAttribute('src');
        report(href || src, 'dom');
      });
    } catch {
      /* ignore */
    }
  }

  scanVideos();
  hookFetch();
  hookXhr();
  scanPerformanceEntries();
  scanMediaLinks();
  const observer = new MutationObserver(() => {
    scanVideos();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => {
    scanVideos();
    scanPerformanceEntries();
    scanMediaLinks();
  }, 4000);
})();
