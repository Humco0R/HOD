import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { RedisConnection } from '../../infrastructure/redis/redis';
import type { OutboundNotification } from '../../modules/notifications';

type Target = OutboundNotification['target'];

export interface MaxSendRateLimiter {
  acquire(target: Target): Promise<void>;
}

// MAX allows two messages per second to one dialog or chat. Separate expiring
// slots make reservations atomic across workers without limiting other targets.
export class RedisMaxSendRateLimiter implements MaxSendRateLimiter {
  constructor(
    private readonly redis: Pick<RedisConnection, 'set' | 'pttl'>,
    private readonly wait: (milliseconds: number) => Promise<unknown> = delay,
  ) {}

  async acquire(target: Target): Promise<void> {
    const targetHash = createHash('sha256')
      .update(`${target.type}:${target.externalId}`)
      .digest('hex');
    const prefix = `hod:max:send-rate:${targetHash}`;

    for (;;) {
      for (let slot = 0; slot < 2; slot += 1) {
        if (await this.redis.set(`${prefix}:${slot}`, '1', 'PX', 1_100, 'NX')) return;
      }

      const remaining = await Promise.all([
        this.redis.pttl(`${prefix}:0`),
        this.redis.pttl(`${prefix}:1`),
      ]);
      const nextExpiry = Math.min(...remaining.filter((ttl) => ttl > 0));
      await this.wait(Number.isFinite(nextExpiry) ? nextExpiry + 5 : 20);
    }
  }
}
