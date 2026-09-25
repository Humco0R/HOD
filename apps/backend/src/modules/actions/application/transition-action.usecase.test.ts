import { describe, expect, it } from 'vitest';

import type { ActionLifecycleStore, PersistedActionLifecycle } from './action-lifecycle.port';
import { TransitionActionUseCase } from './transition-action.usecase';

describe('TransitionActionUseCase', () => {
  it('derives authorization from persisted action identities', async () => {
    const action: PersistedActionLifecycle = {
      id: 'action-1',
      workspaceId: 'workspace-1',
      creatorId: 'creator-1',
      assigneeId: 'assignee-1',
      status: 'NEW',
      blockedFromStatus: null,
      expectedResultType: 'NONE',
      attachmentCount: 0,
    };
    const store: ActionLifecycleStore = {
      transition(_actionId, _workspaceId, _idempotencyKey, decide) {
        const decision = decide(action);
        return Promise.resolve({
          action: { ...action, status: decision.nextStatus },
          idempotent: false,
        });
      },
    };
    const useCase = new TransitionActionUseCase(store);

    await expect(
      useCase.execute({
        actionId: action.id,
        workspaceId: action.workspaceId,
        actorId: action.assigneeId,
        idempotencyKey: 'accept-1',
        command: 'ACCEPT',
      }),
    ).resolves.toMatchObject({ action: { status: 'ACCEPTED' }, idempotent: false });

    await expect(
      useCase.execute({
        actionId: action.id,
        workspaceId: action.workspaceId,
        actorId: action.creatorId,
        idempotencyKey: 'accept-2',
        command: 'ACCEPT',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
