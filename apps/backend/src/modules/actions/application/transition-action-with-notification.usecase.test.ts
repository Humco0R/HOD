import { describe, expect, it, vi } from 'vitest';

import type { ActionContextStore, ActionLifecycleNotificationPort } from './action-context.port';
import type { StoredActionTransition } from './action-lifecycle.port';
import { TransitionActionWithNotificationUseCase } from './transition-action-with-notification.usecase';
import type { TransitionActionUseCase } from './transition-action.usecase';

const actionId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const workspaceId = '00000000-0000-4000-8000-000000000003';

describe('TransitionActionWithNotificationUseCase', () => {
  it('automatically verifies a result submitted to oneself, including on retry', async () => {
    const transition = vi
      .fn<TransitionActionUseCase['execute']>()
      .mockResolvedValueOnce(stored('DONE', false))
      .mockResolvedValueOnce(stored('VERIFIED', false))
      .mockResolvedValueOnce(stored('VERIFIED', true));
    const publish = vi.fn<ActionLifecycleNotificationPort['publish']>(() => Promise.resolve());
    const getNotificationContext = vi.fn<ActionContextStore['getNotificationContext']>();
    const useCase = new TransitionActionWithNotificationUseCase(
      { execute: transition } as unknown as TransitionActionUseCase,
      { resolveActor: vi.fn(), getNotificationContext } satisfies ActionContextStore,
      { publish },
    );
    const request = {
      actionId,
      workspaceId,
      actorId: userId,
      command: 'SUBMIT_RESULT' as const,
      idempotencyKey: 'submit-self',
    };

    const first = await useCase.execute(request);
    expect(first.action.status).toBe('VERIFIED');
    expect(first.idempotent).toBe(false);
    expect(transition).toHaveBeenNthCalledWith(2, {
      ...request,
      command: 'VERIFY',
      idempotencyKey: 'submit-self:self-verify',
    });
    expect(publish).not.toHaveBeenCalled();

    const retry = await useCase.execute(request);
    expect(retry.action.status).toBe('VERIFIED');
    expect(retry.idempotent).toBe(true);
    expect(transition).toHaveBeenCalledTimes(3);
    expect(publish).not.toHaveBeenCalled();
    expect(getNotificationContext).not.toHaveBeenCalled();
  });
});

function stored(status: 'DONE' | 'VERIFIED', idempotent: boolean): StoredActionTransition {
  return {
    action: {
      id: actionId,
      workspaceId,
      creatorId: userId,
      assigneeId: userId,
      status,
      blockedFromStatus: null,
      expectedResultType: 'NONE',
      attachmentCount: 0,
    },
    idempotent,
  };
}
