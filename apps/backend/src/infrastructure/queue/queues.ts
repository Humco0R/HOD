import { Queue } from 'bullmq';

import type { RedisConnection } from '../redis/redis';

export const queueNames = ['detection', 'notification', 'reminder', 'maintenance'] as const;
export type QueueName = (typeof queueNames)[number];

export type ApplicationQueues = Record<QueueName, Queue<unknown>>;

export function createApplicationQueues(connection: RedisConnection): ApplicationQueues {
  return Object.fromEntries(
    queueNames.map((name) => [name, new Queue<unknown>(name, { connection, prefix: 'hod' })]),
  ) as ApplicationQueues;
}

export async function closeApplicationQueues(queues: ApplicationQueues): Promise<void> {
  await Promise.all(Object.values(queues).map(async (queue) => queue.close()));
}
