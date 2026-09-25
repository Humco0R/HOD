import { describe, expect, it, vi } from 'vitest';

import { BullMqNotificationPublisher, notificationJobId } from './bullmq-notification.publisher';

describe('BullMqNotificationPublisher', () => {
  it('uses a deterministic BullMQ-safe job id for idempotency keys containing colons', async () => {
    const add = vi.fn(() => Promise.resolve());
    const publisher = new BullMqNotificationPublisher({ add });
    const idempotencyKey = 'action:00000000-0000-4000-8000-000000000001:start:callback-1';

    await publisher.publish(
      { target: { type: 'USER', externalId: '42' }, text: 'Дело принято', buttons: [] },
      idempotencyKey,
    );

    expect(notificationJobId(idempotencyKey)).toMatch(/^[a-f0-9]{64}$/u);
    expect(add).toHaveBeenCalledWith(
      'send-max-message',
      expect.any(Object),
      expect.objectContaining({ jobId: notificationJobId(idempotencyKey), attempts: 5 }),
    );
  });
});
