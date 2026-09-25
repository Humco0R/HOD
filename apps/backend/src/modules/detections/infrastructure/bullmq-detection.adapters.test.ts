import { describe, expect, it, vi } from 'vitest';

import type { NotificationPublisher } from '../../notifications';
import { BullMqDetectionMessaging } from './bullmq-detection.adapters';

describe('BullMqDetectionMessaging', () => {
  it('names the creator in a new assignment', async () => {
    const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
    const messaging = new BullMqDetectionMessaging({ publish });

    await messaging.publish({
      actionId: '00000000-0000-4000-8000-000000000001',
      assigneeExternalUserId: '42',
      creatorName: 'Анна Соколова',
      title: 'Проверить договор',
    });

    expect(publish.mock.lastCall?.[0].text).toContain('Постановщик: Анна Соколова');
    expect(publish.mock.lastCall?.[0].buttons).toContainEqual({
      text: '📄 Открыть дело',
      payload: 'hod:personal:action:detail:00000000-0000-4000-8000-000000000001',
      row: 1,
    });
  });

  it('offers assignee selection in chat for ambiguous proposals', async () => {
    const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
    const messaging = new BullMqDetectionMessaging({ publish });
    const detectionId = '00000000-0000-4000-8000-000000000001';
    await messaging.publish({
      detectionId,
      target: { type: 'CHAT', externalId: 'chat-1' },
      candidate: {
        classification: 'ACTIONABLE',
        title: 'Проверить договор',
        assigneeReference: 'Иван',
        deadlineKind: 'UNKNOWN',
        deadlineAt: null,
        deadlineDate: null,
        deadlineDependency: null,
        deadlineRaw: null,
        expectedResultType: 'NONE',
        expectedResultText: null,
        location: null,
        confidence: 0.9,
        raw: {},
      },
      assignee: { status: 'AMBIGUOUS', userId: null },
      assigneeLabel: null,
    });
    expect(publish.mock.lastCall?.[0].buttons).toContainEqual({
      text: '👤 Выбрать исполнителя',
      payload: `hod:detection:assignees:${detectionId}:0`,
      row: 0,
    });
    expect(publish.mock.lastCall?.[0].buttons).toEqual([
      {
        text: '👤 Выбрать исполнителя',
        payload: `hod:detection:assignees:${detectionId}:0`,
        row: 0,
      },
      { text: '❌ Отменить', payload: `hod:detection:reject:${detectionId}`, row: 1 },
    ]);
  });

  it('offers only three task actions for a resolved group proposal', async () => {
    const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
    const messaging = new BullMqDetectionMessaging({ publish });
    const detectionId = '00000000-0000-4000-8000-000000000001';
    await messaging.publish({
      detectionId,
      target: { type: 'CHAT', externalId: '900' },
      candidate: {
        classification: 'ACTIONABLE',
        title: 'Проверить договор',
        assigneeReference: 'Иван',
        deadlineKind: 'UNKNOWN',
        deadlineAt: null,
        deadlineDate: null,
        deadlineDependency: null,
        deadlineRaw: null,
        expectedResultType: 'NONE',
        expectedResultText: null,
        location: null,
        confidence: 0.9,
        raw: {},
      },
      assignee: { status: 'RESOLVED', userId: 'user-1' },
      assigneeLabel: 'Иван',
    });

    expect(publish.mock.lastCall?.[0].buttons).toEqual([
      { text: '✅ Принять', payload: `hod:detection:confirm:${detectionId}`, row: 0 },
      {
        text: '👤 Изменить исполнителя',
        payload: `hod:detection:assignees:${detectionId}:0`,
        row: 1,
      },
      { text: '❌ Отменить', payload: `hod:detection:reject:${detectionId}`, row: 2 },
    ]);
  });
});
