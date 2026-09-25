import { transitionAction } from '../domain/transition-action';
import type { ActionCommand } from '../domain/action';
import type {
  ActionLifecycleStore,
  ActionTransitionWrite,
  StoredActionTransition,
} from './action-lifecycle.port';

export interface TransitionActionRequest {
  actionId: string;
  workspaceId: string;
  actorId: string;
  idempotencyKey: string;
  command: ActionCommand;
  reason?: string;
}

export class TransitionActionUseCase {
  constructor(private readonly store: ActionLifecycleStore) {}

  async execute(request: TransitionActionRequest): Promise<StoredActionTransition> {
    if (!request.idempotencyKey.trim()) {
      throw new Error('Idempotency key is required');
    }

    const result = await this.store.transition(
      request.actionId,
      request.workspaceId,
      request.idempotencyKey,
      (action): ActionTransitionWrite => {
        const transition = transitionAction({
          action,
          actor: {
            isAssignee: action.assigneeId === request.actorId,
            isCreator: action.creatorId === request.actorId,
          },
          command: request.command,
          ...(request.reason === undefined ? {} : { reason: request.reason }),
        });

        return {
          ...transition,
          actorId: request.actorId,
          idempotencyKey: request.idempotencyKey,
          metadata: { command: request.command },
        };
      },
    );
    return result;
  }
}
