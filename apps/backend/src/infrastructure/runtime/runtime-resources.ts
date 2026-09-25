import type { Logger } from 'pino';

import type { RuntimeConfig } from '@hod/config';

import { toSafeErrorLog } from '../../shared/logger';
import { createDatabase, type Database } from '../db/client';
import { createPostgresConnection, type PostgresConnection } from '../db/postgres';
import {
  closeApplicationQueues,
  createApplicationQueues,
  type ApplicationQueues,
} from '../queue/queues';
import {
  closeRedis,
  connectRedis,
  createRedisConnection,
  type RedisConnection,
} from '../redis/redis';

export type DependencyStatus = 'up' | 'down';

export interface ReadinessResult {
  postgres: DependencyStatus;
  redis: DependencyStatus;
}

export interface RuntimeResources {
  readonly postgres: PostgresConnection;
  readonly database: Database;
  readonly redis: RedisConnection;
  readonly queues: ApplicationQueues;
  start(): Promise<void>;
  readiness(): Promise<ReadinessResult>;
  close(): Promise<void>;
}

export function createRuntimeResources(config: RuntimeConfig, logger: Logger): RuntimeResources {
  const postgres = createPostgresConnection(config.DATABASE_URL);
  const database = createDatabase(postgres.pool);
  const redis = createRedisConnection(config.REDIS_URL);
  const queueRedis = createRedisConnection(config.REDIS_URL, true);
  const queues = createApplicationQueues(queueRedis);

  redis.on('error', (error) =>
    logger.warn({ err: toSafeErrorLog(error) }, 'Redis connection error'),
  );
  queueRedis.on('error', (error) =>
    logger.warn({ err: toSafeErrorLog(error) }, 'Queue Redis connection error'),
  );
  postgres.pool.on('error', (error) =>
    logger.error({ err: toSafeErrorLog(error) }, 'PostgreSQL pool error'),
  );

  return {
    postgres,
    database,
    redis,
    queues,
    async start() {
      await Promise.all([postgres.check(), connectRedis(redis), connectRedis(queueRedis)]);
    },
    async readiness() {
      const [postgresResult, redisResult] = await Promise.allSettled([
        postgres.check(),
        redis.ping(),
      ]);
      return {
        postgres: postgresResult.status === 'fulfilled' ? 'up' : 'down',
        redis: redisResult.status === 'fulfilled' ? 'up' : 'down',
      };
    },
    async close() {
      await Promise.allSettled([
        closeApplicationQueues(queues),
        closeRedis(redis),
        closeRedis(queueRedis),
        postgres.close(),
      ]);
    },
  };
}
