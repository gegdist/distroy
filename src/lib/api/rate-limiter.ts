import type { RateLimitHeaders } from '@/lib/types/discord';
import { sleep } from '@/lib/sleep';

export function parseRateLimitHeaders(headers: Headers): RateLimitHeaders {
  const remaining = headers.get('x-ratelimit-remaining');
  const resetAfter = headers.get('x-ratelimit-reset-after');
  const bucket = headers.get('x-ratelimit-bucket');
  const retryAfter = headers.get('retry-after');

  return {
    remaining: remaining !== null ? Number(remaining) : null,
    resetAfter: resetAfter !== null ? Number(resetAfter) : null,
    bucket,
    retryAfter: retryAfter !== null ? Number(retryAfter) : null,
  };
}

interface QueueEntry {
  execute: () => Promise<Response>;
  resolve: (res: Response) => void;
  reject: (err: unknown) => void;
}

interface BucketState {
  remaining: number;
  resetAt: number; // Date.now()-relative timestamp
  adaptiveDelayMs: number;
}

const DEFAULT_DELAY_MS = 1100;
const MIN_DELAY_MS = 250;
const MAX_DELAY_MS = 10_000;
const BACKOFF_MULTIPLIER = 1.8;
const RECOVERY_FACTOR = 0.85;
const JITTER_MS = 180;
const MAX_RETRIES = 5;

/**
 * Serialises requests per rate-limit bucket, respecting Discord's headers.
 * The caller provides the raw fetch thunk; the limiter decides *when* to fire it.
 */
export class RateLimiter {
  private buckets = new Map<string, BucketState>();
  private queues = new Map<string, QueueEntry[]>();
  private processing = new Set<string>();
  private globalResetAt = 0;

  async enqueue(bucketHint: string, execute: () => Promise<Response>): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      const queue = this.queues.get(bucketHint) ?? [];
      queue.push({ execute, resolve, reject });
      this.queues.set(bucketHint, queue);
      this.drain(bucketHint);
    });
  }

  private async drain(bucketHint: string): Promise<void> {
    if (this.processing.has(bucketHint)) return;
    this.processing.add(bucketHint);

    try {
      while (true) {
        const queue = this.queues.get(bucketHint);
        if (!queue || queue.length === 0) break;

        const entry = queue.shift()!;
        const response = await this.executeWithBackoff(bucketHint, entry.execute);
        entry.resolve(response);
      }
    } catch (err) {
      const queue = this.queues.get(bucketHint);
      if (queue) {
        for (const e of queue) e.reject(err);
        queue.length = 0;
      }
    } finally {
      this.processing.delete(bucketHint);
    }
  }

  private async executeWithBackoff(
    bucketHint: string,
    execute: () => Promise<Response>,
  ): Promise<Response> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await this.waitForBucket(bucketHint);

      const res = await execute();
      const rl = parseRateLimitHeaders(res.headers);

      const realBucket = rl.bucket ?? bucketHint;
      const knownBucket = this.getOrCreateBucket(realBucket);
      if (rl.remaining !== null && rl.resetAfter !== null) {
        knownBucket.remaining = rl.remaining;
        knownBucket.resetAt = Date.now() + rl.resetAfter * 1000;
        this.buckets.set(realBucket, knownBucket);
      }

      if (res.status === 429) {
        const isGlobal = res.headers.get('x-ratelimit-global') === 'true';
        const waitMs = (rl.retryAfter ?? 5) * 1000;

        if (isGlobal) {
          this.globalResetAt = Date.now() + waitMs;
        } else {
          const bucket = this.getOrCreateBucket(realBucket);
          bucket.remaining = 0;
          bucket.resetAt = Date.now() + waitMs;
          bucket.adaptiveDelayMs = Math.min(
            MAX_DELAY_MS,
            Math.round(bucket.adaptiveDelayMs * BACKOFF_MULTIPLIER),
          );
          this.buckets.set(realBucket, bucket);
        }

        console.warn(`[rate-limiter] 429 hit (${isGlobal ? 'global' : realBucket}), waiting ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }

      const bucket = this.getOrCreateBucket(realBucket);
      bucket.adaptiveDelayMs = Math.max(
        MIN_DELAY_MS,
        Math.round(bucket.adaptiveDelayMs * RECOVERY_FACTOR),
      );
      this.buckets.set(realBucket, bucket);

      return res;
    }

    throw new Error(`[rate-limiter] Exceeded ${MAX_RETRIES} retries for bucket ${bucketHint}`);
  }

  private async waitForBucket(bucketHint: string): Promise<void> {
    const now = Date.now();

    if (this.globalResetAt > now) {
      await sleep(this.globalResetAt - now);
    }

    const state = this.buckets.get(bucketHint);
    if (state && state.remaining <= 0 && state.resetAt > Date.now()) {
      await sleep(state.resetAt - Date.now());
    }

    const adaptiveBase = state?.adaptiveDelayMs ?? DEFAULT_DELAY_MS;
    await sleep(withJitter(adaptiveBase));
  }

  private getOrCreateBucket(bucketName: string): BucketState {
    return (
      this.buckets.get(bucketName) ?? {
        remaining: 1,
        resetAt: 0,
        adaptiveDelayMs: DEFAULT_DELAY_MS,
      }
    );
  }
}

function withJitter(ms: number): number {
  const delta = Math.floor(Math.random() * (JITTER_MS * 2 + 1)) - JITTER_MS;
  return Math.max(0, ms + delta);
}
