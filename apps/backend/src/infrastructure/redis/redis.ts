import Redis from 'ioredis';

export type RedisConnection = Redis;

export function createRedisConnection(redisUrl: string, forQueue = false): RedisConnection {
  return new Redis(redisUrl, {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: forQueue ? null : 1,
  });
}

export async function connectRedis(redis: RedisConnection): Promise<void> {
  if (redis.status === 'wait') {
    await redis.connect();
  }
}

export async function closeRedis(redis: RedisConnection): Promise<void> {
  if (redis.status === 'end') return;
  await redis.quit();
}
