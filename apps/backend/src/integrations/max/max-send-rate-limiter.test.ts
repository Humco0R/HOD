import { describe, expect, it, vi } from 'vitest';

import type { RedisConnection } from '../../infrastructure/redis/redis';
import { RedisMaxSendRateLimiter } from './max-send-rate-limiter';

describe('RedisMaxSendRateLimiter', () => {
  it('allows two sends per target and waits before the third without slowing another target', async () => {
    let now = 0;
    const expiresAt = new Map<string, number>();
    const redis = {
      set: vi.fn((key: string, _value: string, _mode: string, ttl: number) => {
        if ((expiresAt.get(key) ?? 0) > now) return Promise.resolve(null);
        expiresAt.set(key, now + ttl);
        return Promise.resolve('OK');
      }),
      pttl: vi.fn((key: string) => Promise.resolve(Math.max(-2, (expiresAt.get(key) ?? 0) - now))),
    } as unknown as Pick<RedisConnection, 'set' | 'pttl'>;
    const wait = vi.fn((milliseconds: number) => {
      now += milliseconds;
      return Promise.resolve();
    });
    const limiter = new RedisMaxSendRateLimiter(redis, wait);
    const chat = { type: 'CHAT' as const, externalId: '42' };

    await limiter.acquire(chat);
    await limiter.acquire(chat);
    await limiter.acquire({ type: 'CHAT', externalId: '43' });
    expect(wait).not.toHaveBeenCalled();

    await limiter.acquire(chat);
    expect(wait).toHaveBeenCalledExactlyOnceWith(1_105);
    expect(redis.set).toHaveBeenCalledTimes(7);
  });
});
