import { describe, expect, it, vi } from 'vitest';

import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent } from '../../workspaces';
import type { AssignmentNotificationPort, DetectionRepository } from './detection.ports';
import { HandleDetectionCallbackUseCase } from './handle-detection-callback.usecase';

const detectionId = '00000000-0000-4000-8000-000000000001';
const actionId = '00000000-0000-4000-8000-000000000002';

describe('HandleDetectionCallbackUseCase', () => {
  it('confirms a group proposal with a buttonless message', async () => {
    const { useCase, publish, assignmentPublish } = harness();

    await useCase.handle(callback('900'));

    expect(assignmentPublish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      {
        target: { type: 'CHAT', externalId: '900' },
        text: '✅ Дело создано\n\nПроверить договор',
        buttons: [],
      },
      'detection-confirmed-callback-1',
    );
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
});

function callback(
  externalChatId: string | null,
): Extract<InboundChatEvent, { kind: 'message.callback' }> {
  return {
    kind: 'message.callback',
    eventId: 'callback:callback-1',
    occurredAt: new Date(),
    externalChatId,
    externalMessageId: 'message-1',
    actor: { externalUserId: '42', firstName: 'Иван', lastName: null, username: null },
    payload: `hod:detection:confirm:${detectionId}`,
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
  const assignmentPublish = vi.fn<AssignmentNotificationPort['publish']>().mockResolvedValue();
  const publish = vi.fn<NotificationPublisher['publish']>().mockResolvedValue();
  const useCase = new HandleDetectionCallbackUseCase(
    { confirm } as unknown as DetectionRepository,
    { publish: assignmentPublish },
    { publish },
  );
  return { useCase, publish, assignmentPublish };
}
