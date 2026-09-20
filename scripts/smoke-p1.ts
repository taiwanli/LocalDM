import { friendlyTaskError } from '../shared/errorMessages';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke-p1] ${message}`);
}

assert(friendlyTaskError('[RangeEngine] probe failed status=567 host=x').includes('安全策略'), '567');
assert(friendlyTaskError('HTTP status=429 too many').includes('频繁'), '429');
assert(friendlyTaskError('status=404').includes('失效') || friendlyTaskError('status=404').includes('不存在'), '404');
assert(friendlyTaskError('[TaskRunner] BT/磁力未启用：x').includes('设置'), 'bt off');
assert(friendlyTaskError('未找到 aria2c（C:\\x）').includes('aria2c'), 'aria2');
assert(friendlyTaskError('fetch failed').includes('网络'), 'network');
assert(friendlyTaskError('').length > 0, 'empty fallback');
assert(friendlyTaskError('[RangeEngine] probe failed status=567 host=drivers.amd.com（请求过于频繁/网关限流，请降低并发或稍后重试）').includes('限流'), '567 chinese');

console.log('smoke-p1: OK');
