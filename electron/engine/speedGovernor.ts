/** Shared token-bucket limiter for all RangeEngine workers (global speed cap). */

const MAX_BURST_SECONDS = 2;
const MAX_WAIT_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class SpeedGovernor {
  private tokens = 0;
  private lastRefillAt = Date.now();
  private limitBps: number;

  constructor(limitBps: number) {
    this.limitBps = Math.max(0, Math.floor(limitBps));
  }

  setLimit(limitBps: number): void {
    this.limitBps = Math.max(0, Math.floor(limitBps));
  }

  getLimit(): number {
    return this.limitBps;
  }

  async consume(bytes: number): Promise<void> {
    if (this.limitBps <= 0 || bytes <= 0) return;
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillAt) / 1000;
    this.lastRefillAt = now;
    const burstCap = this.limitBps * MAX_BURST_SECONDS;
    this.tokens = Math.min(burstCap, this.tokens + elapsedSec * this.limitBps);
    this.tokens -= bytes;
    if (this.tokens >= 0) return;
    const waitSec = -this.tokens / this.limitBps;
    const waitMs = Math.min(MAX_WAIT_MS, Math.max(1, waitSec * 1000));
    await sleep(waitMs);
  }
}
