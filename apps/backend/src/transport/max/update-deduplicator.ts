import { createHash } from 'node:crypto';

import type { RedisConnection } from '../../infrastructure/redis/redis';

export interface UpdateDeduplicator {
  execute(key: string, operation: () => Promise<void>): Promise<boolean>;
}

export class RedisUpdateDeduplicator implements UpdateDeduplicator {
  constructor(
    private readonly redis: RedisConnection,
    private readonly ttlSeconds = 7 * 24 * 60 * 60,
  ) {}

  async execute(key: string, operation: () => Promise<void>): Promise<boolean> {
    const redisKey = `max:update:${createHash('sha256').update(key).digest('hex')}`;
    const acquired = await this.redis.set(redisKey, '1', 'EX', this.ttlSeconds, 'NX');
    if (acquired !== 'OK') return false;

    try {
      await operation();
      return true;
    } catch (error) {
      await this.redis.del(redisKey);
      throw error;
    }
  }
}
