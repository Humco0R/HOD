import { createHash } from 'node:crypto';

import type { JobsOptions } from 'bullmq';

import type { NotificationPublisher, OutboundNotification } from '../application/notification.port';

interface JobQueue<T> {
  add(name: string, data: T, options?: JobsOptions): Promise<unknown>;
}

export class BullMqNotificationPublisher implements NotificationPublisher {
  constructor(private readonly queue: JobQueue<OutboundNotification>) {}

  async publish(notification: OutboundNotification, idempotencyKey: string): Promise<void> {
    await this.queue.add('send-max-message', notification, {
      jobId: notificationJobId(idempotencyKey),
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
    });
  }
}

export function notificationJobId(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey).digest('hex');
}
