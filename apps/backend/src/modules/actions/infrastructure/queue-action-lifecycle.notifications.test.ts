import { describe, expect, it, vi } from 'vitest';

import type { NotificationPublisher } from '../../notifications';
import { QueueActionLifecycleNotifications } from './queue-action-lifecycle.notifications';

describe('QueueActionLifecycleNotifications', () => {
  it('does not send a self-assigned result back for approval', async () => {
    const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
    const notifications = new QueueActionLifecycleNotifications({ publish });
    const context = {
      actionId: '00000000-0000-4000-8000-000000000001',
      title: 'Личное дело',
      status: 'VERIFIED' as const,
      creatorExternalUserId: '42',
      assigneeExternalUserId: '42',
      attachmentCount: 1,
    };

    await notifications.publish({
      context,
      command: 'SUBMIT_RESULT',
      reason: null,
      idempotencyKey: 'submit-self',
    });
    await notifications.publish({
      context,
      command: 'VERIFY',
      reason: null,
      idempotencyKey: 'verify-self',
    });

    expect(publish).not.toHaveBeenCalled();
  });

  it('notifies the creator about a pending result without action buttons', async () => {
    const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
    const notifications = new QueueActionLifecycleNotifications({ publish });
    const actionId = '00000000-0000-4000-8000-000000000001';
    await notifications.publish({
      context: {
        actionId,
        title: 'Подготовить отчёт',
        status: 'DONE',
        creatorExternalUserId: '42',
        assigneeExternalUserId: '43',
        attachmentCount: 2,
      },
      command: 'SUBMIT_RESULT',
      reason: 'Готово',
      idempotencyKey: 'notify-1',
    });

    const sent = publish.mock.lastCall?.[0];
    expect(sent?.target).toEqual({ type: 'USER', externalId: '42' });
    expect(sent?.text).toContain('Дело поступило на проверку');
    expect(sent?.text).toContain('Подготовить отчёт');
    expect(sent?.text).toContain('«Мои дела» → «На проверке»');
    expect(sent?.buttons).toEqual([]);
    expect(sent?.hideMainMenu).toBe(true);
  });

  it('opens the action card in chat after work starts', async () => {
    const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
    const notifications = new QueueActionLifecycleNotifications({ publish });
    const actionId = '00000000-0000-4000-8000-000000000001';
    await notifications.publish({
      context: {
        actionId,
        title: 'Подготовить отчёт',
        status: 'IN_PROGRESS',
        creatorExternalUserId: '42',
        assigneeExternalUserId: '43',
      },
      command: 'START',
      reason: null,
      idempotencyKey: 'start-1',
    });
    const buttons = publish.mock.lastCall?.[0].buttons;
    expect(buttons).toContainEqual({
      text: '📄 Открыть дело',
      payload: `hod:personal:action:detail:${actionId}`,
      row: 0,
    });
    expect(buttons).not.toContainEqual(
      expect.objectContaining({
        payload: `hod:action:block:${actionId}`,
      }),
    );
    expect(buttons?.some((button) => 'startParam' in button)).toBe(false);
  });
});
