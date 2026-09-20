import {
  adaptiveCooldownMs,
  extractHttpStatus,
  isRateLimitMessage,
  isRateLimitStatus,
  nextAdaptiveConnections,
  rateLimitHint,
  shouldUseSingleConnection,
} from '../shared/limits';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-adaptive] ${message}`);
}

assert(isRateLimitStatus(567), '567 is rate limit');
assert(isRateLimitStatus(403), '403 is rate limit');
assert(isRateLimitStatus(429), '429 is rate limit');
assert(!isRateLimitStatus(404), '404 not rate limit');
assert(extractHttpStatus('probe failed status=567 host=x') === 567, 'extract status');
assert(isRateLimitMessage('[RangeEngine] probe failed status=567'), 'message 567');
assert(isRateLimitMessage('请求过于频繁/网关限流'), 'chinese hint');
assert(nextAdaptiveConnections(8) === 4, '8→4');
assert(nextAdaptiveConnections(4) === 2, '4→2');
assert(nextAdaptiveConnections(2) === 1, '2→1');
assert(nextAdaptiveConnections(1) === 1, 'min 1');
assert(adaptiveCooldownMs(1, 3000) === 3000, 'round1');
assert(adaptiveCooldownMs(2, 3000) === 6000, 'round2');
assert(adaptiveCooldownMs(20, 3000) === 30000, 'cap 30s');
assert(rateLimitHint(567).includes('安全策略'), '567 hint');
assert(shouldUseSingleConnection('[RangeEngine] server ignored Range status=200 collapse'), 'collapse msg');

console.log('smoke-adaptive: OK');
