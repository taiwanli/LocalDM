/** Map engine/exception strings to short Chinese guidance for UI. */
export function friendlyTaskError(raw: string | undefined | null): string {
  const s = String(raw || '').trim();
  if (!s) return '下载失败，可点「重试」或查看任务日志。';

  if (/BT\/磁力未启用|enableBt/i.test(s)) {
    return 'BT/磁力未启用：请到设置打开「启用 BT/磁力下载」后重试。';
  }
  if (/未找到 aria2c|ENOENT.*aria2|aria2c/i.test(s) && /未找到|ENOENT|aria2c/i.test(s)) {
    return '未找到 aria2c：请在设置中指定路径，或把 aria2c.exe 放到 resources/bin。';
  }
  if (/status=567|安全策略|网关拦截/i.test(s)) {
    return '站点安全策略/网关限流，已尝试自动降并发；请稍后重试，或改用浏览器下载。';
  }
  if (/status=429|请求过于频繁|限流/i.test(s)) {
    return '请求过于频繁，已自动降并发并冷却；请稍后重试。';
  }
  if (/status=401|status=403|授权|Cookie|Token/i.test(s)) {
    return '链接需要登录或授权：可在高级选项添加 Cookie/Token，或在浏览器登录后下载。';
  }
  if (/status=404|文件不存在|链接已失效/i.test(s)) {
    return '文件不存在或链接已失效，请检查地址后重试。';
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(s)) {
    return '网络不可达或服务未启动，请检查网络/代理后重试。';
  }
  if (/probe failed status=416/i.test(s)) {
    return '服务器不支持当前下载方式，可稍后重试或换链接。';
  }
  if (/yt-dlp/i.test(s) && /404|Unable to download/i.test(s)) {
    return '视频页解析失败（yt-dlp）：链接可能无效或受地区限制。';
  }
  if (/yt-dlp|MediaEngine/i.test(s)) {
    return '媒体下载失败：请查看任务日志中的 yt-dlp 输出。';
  }
  if (/HLS|HlsEngine|m3u8/i.test(s)) {
    return 'HLS 下载失败：可关闭「内置 HLS」后改用 yt-dlp，或稍后重试。';
  }
  if (/AES|加密/i.test(s)) {
    return '该 HLS 为加密流，请改用 yt-dlp 路径（关闭内置 HLS）。';
  }
  // Fallback: keep original but cap length
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

export function taskLogHint(taskId: string): string {
  return `任务日志：UserData/LocalDM/logs/tasks/${taskId}.log`;
}
