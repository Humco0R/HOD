import type { ActionLifecycleNotificationPort, ActionContextStore } from './action-context.port';
import type { TransitionActionRequest, TransitionActionUseCase } from './transition-action.usecase';
import type { StoredActionTransition } from './action-lifecycle.port';

export class TransitionActionWithNotificationUseCase {
  constructor(
    private readonly transitions: TransitionActionUseCase,
    private readonly contexts: ActionContextStore,
    private readonly notifications: ActionLifecycleNotificationPort,
  ) {}

  async execute(request: TransitionActionRequest): Promise<StoredActionTransition> {
    const result = await this.transitions.execute(request);
    if (
      request.command === 'SUBMIT_RESULT' &&
      result.action.creatorId === result.action.assigneeId
    ) {
      if (result.action.status === 'VERIFIED') return result;
      const verification = await this.transitions.execute({
        ...request,
        command: 'VERIFY',
        idempotencyKey: `${request.idempotencyKey}:self-verify`,
      });
      return {
        action: verification.action,
        idempotent: result.idempotent && verification.idempotent,
      };
    }
    if (!result.idempotent) {
      await this.notifications.publish({
        context: await this.contexts.getNotificationContext(request.actionId),
        command: request.command,
        reason: request.reason?.trim() || null,
        idempotencyKey: `action-${request.actionId}-${request.idempotencyKey}`,
      });
    }
    return result;
  }
}
