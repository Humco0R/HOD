import { describe, expect, it, vi } from 'vitest';

import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent } from '../../workspaces';
import type { AssignmentNotificationPort, DetectionRepository } from './detection.ports';
import { HandleDetectionCallbackUseCase } from './handle-detection-callback.usecase';

const detectionId = '00000000-0000-4000-8000-000000000001';
const actionId = '00000000-0000-4000-8000-000000000002';

describe('HandleDetectionCallbackUseCase', () => {
  it('confirms a group proposal without posting a confirmation to the chat', async () => {
    const { useCase, publish, assignmentPublish } = harness();

    await useCase.handle(callback('900'));

    expect(assignmentPublish).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });

  it('rejects a group proposal without posting a response to the chat', async () => {
    const { useCase, publish, reject } = harness();

    await useCase.handle(callback('900', 'reject'));

    expect(reject).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps navigation in a personal confirmation', async () => {
    const { useCase, publish } = harness();

    await useCase.handle(callback(null));

    expect(publish.mock.lastCall?.[0]).toMatchObject({
      target: { type: 'USER', externalId: '42' },
      buttons: [
        { payload: `hod:personal:action:detail:${actionId}` },
        { payload: 'hod:personal:menu' },
      ],
    });
  });

  it('keeps navigation in a personal rejection', async () => {
    const { useCase, publish, reject } = harness();

    await useCase.handle(callback(null, 'reject'));

    expect(reject).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      {
        target: { type: 'USER', externalId: '42' },
        text: 'Предложение отклонено.',
        buttons: [{ text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 0 }],
      },
      'detection-rejected-callback-1',
    );
  });
});

function callback(
  externalChatId: string | null,
  operation: 'confirm' | 'reject' = 'confirm',
): Extract<InboundChatEvent, { kind: 'message.callback' }> {
  return {
    kind: 'message.callback',
    eventId: 'callback:callback-1',
    occurredAt: new Date(),
    externalChatId,
    externalMessageId: 'message-1',
    actor: { externalUserId: '42', firstName: 'Иван', lastName: null, username: null },
    payload: `hod:detection:${operation}:${detectionId}`,
    callbackId: 'callback-1',
  };
}

function harness() {
  const confirm = vi.fn<DetectionRepository['confirm']>().mockResolvedValue({
    actionId,
    idempotent: false,
    assigneeExternalUserId: '43',
    creatorName: 'Иван',
    title: 'Проверить договор',
  });
  const reject = vi.fn<DetectionRepository['reject']>().mockResolvedValue({ idempotent: false });
  const assignmentPublish = vi.fn<AssignmentNotificationPort['publish']>().mockResolvedValue();
  const publish = vi.fn<NotificationPublisher['publish']>().mockResolvedValue();
  const useCase = new HandleDetectionCallbackUseCase(
    { confirm, reject } as unknown as DetectionRepository,
    { publish: assignmentPublish },
    { publish },
  );
  return { useCase, publish, assignmentPublish, reject };
}
