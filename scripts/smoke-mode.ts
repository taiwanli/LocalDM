/**
 * Download policy smoke — user-facing modes removed.
 * Product behavior is always: default Range concurrency + adaptive rate-limit degrade.
 */
import { DEFAULT_SETTINGS } from '../shared/types';
import {
  isRateLimitStatus,
  nextAdaptiveConnections,
  rateLimitHint,
} from '../shared/limits';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-mode] ${message}`);
}

assert(DEFAULT_SETTINGS.maxConnections === 8, 'default range connections 8');
assert(DEFAULT_SETTINGS.maxConcurrentTasks === 3, 'default concurrent 3');
assert(DEFAULT_SETTINGS.adaptiveDegrade === true, 'adaptive on by default');
assert(isRateLimitStatus(567) && isRateLimitStatus(403), 'rate limit codes');
assert(nextAdaptiveConnections(8) === 4, 'adaptive halves');
assert(nextAdaptiveConnections(1) === 1, 'min 1');
assert(rateLimitHint(567).length > 0, 'hint text');

console.log('smoke-mode: OK (Range+adaptive, no UI modes)');
