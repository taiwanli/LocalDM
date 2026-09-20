/**
 * Rate-limit / WAF status helpers for adaptive download degradation.
 * Functional policy inspired by public download-manager behavior; original code.
 */

export const RATE_LIMIT_STATUSES = new Set([401, 403, 410, 429, 503, 567]);

export function isRateLimitStatus(status: number): boolean {
  return RATE_LIMIT_STATUSES.has(status);
}

export function extractHttpStatus(message: string): number {
  const m = /status=(\d+)/.exec(message);
  return m ? Number(m[1]) : 0;
}

export function isRateLimitMessage(message: string): boolean {
  const status = extractHttpStatus(message);
  if (status && isRateLimitStatus(status)) return true;
  return /限流|安全策略|too many|rate.?limit/i.test(message);
}

/** Shared task-wide cooldown after WAF/rate-limit; also halves connection budget. */
export function nextAdaptiveConnections(current: number): number {
  const n = Math.max(1, Math.floor(current || 1));
  return Math.max(1, Math.floor(n / 2));
}

export function adaptiveCooldownMs(round: number, baseMs = 3000): number {
  const r = Math.max(1, Math.floor(round));
  return Math.min(baseMs * 2 ** (r - 1), 30000);
}

export function rateLimitHint(status: number): string {
  if (status === 567 || status === 403) {
    return '站点安全策略/网关拦截，已自动降低并发并冷却';
  }
  if (status === 429 || status === 503) {
    return '请求过于频繁，已自动降低并发并冷却';
  }
  if (status === 401 || status === 410) {
    return '链接可能过期或需授权，正在重探测';
  }
  return '疑似限流，已自动降并发';
}

export function shouldUseSingleConnection(message: string): boolean {
  return /ignored Range|status=200.*collapse|不支持多线程|single-stream/i.test(message);
}
