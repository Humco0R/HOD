import { describe, expect, it, vi } from 'vitest';

import type { InboundChatEvent } from '../../workspaces';
import type { ActionContextStore } from './action-context.port';
import { HandleActionCallbackUseCase } from './handle-action-callback.usecase';
import type { PendingActionInboxSessionStore } from './pending-action-inbox.port';
import type { TransitionActionWithNotificationUseCase } from './transition-action-with-notification.usecase';

const actionId = '00000000-0000-4000-8000-000000000001';

describe('HandleActionCallbackUseCase', () => {
  it('rejects a new action for its assignee', async () => {
    const execute = vi
      .fn<TransitionActionWithNotificationUseCase['execute']>()
      .mockResolvedValue(undefined as never);
    const { contexts } = contextStore();
    const useCase = new HandleActionCallbackUseCase(contexts, {
      execute,
    } as unknown as TransitionActionWithNotificationUseCase);

    await useCase.handle(callback(`hod:action:reject:${actionId}`));

    expect(execute).toHaveBeenCalledWith({
      actionId,
      workspaceId: 'workspace-1',
      actorId: 'user-1',
      idempotencyKey: 'max-callback:callback-1',
      command: 'REJECT',
    });
  });

  it('ignores a button from an outdated pending inbox', async () => {
    const execute = vi.fn<TransitionActionWithNotificationUseCase['execute']>();
    const { contexts, resolveActor } = contextStore();
    const sessions = {
      isCurrent: vi.fn().mockResolvedValue(false),
    } satisfies PendingActionInboxSessionStore;
    const useCase = new HandleActionCallbackUseCase(
      contexts,
      { execute } as unknown as TransitionActionWithNotificationUseCase,
      sessions,
    );

    await useCase.handle(callback(`hod:action:accept:${actionId}:0123456789abcdef`));

    expect(sessions.isCurrent).toHaveBeenCalledWith('42', '0123456789abcdef');
    expect(resolveActor).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

function contextStore() {
  const resolveActor = vi
    .fn<ActionContextStore['resolveActor']>()
    .mockResolvedValue({ workspaceId: 'workspace-1', actorId: 'user-1' });
  return {
    contexts: { resolveActor, getNotificationContext: vi.fn() },
    resolveActor,
  };
}

function callback(payload: string): Extract<InboundChatEvent, { kind: 'message.callback' }> {
  return {
    kind: 'message.callback',
    eventId: 'event-1',
    occurredAt: new Date('2026-09-29T00:00:00Z'),
    externalChatId: null,
    externalMessageId: 'message-1',
    actor: {
      externalUserId: '42',
      firstName: 'Иван',
      lastName: null,
      username: null,
    },
    payload,
    callbackId: 'callback-1',
  };
}
