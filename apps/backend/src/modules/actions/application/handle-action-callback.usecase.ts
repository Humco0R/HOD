import type { InboundChatEvent, InboundChatEventHandler } from '../../workspaces';
import type { ActionCommand } from '../domain/action';
import { ActionTransitionError } from '../domain/action-errors';
import type { ActionContextStore } from './action-context.port';
import type { TransitionActionWithNotificationUseCase } from './transition-action-with-notification.usecase';
import type { PendingActionInboxSessionStore } from './pending-action-inbox.port';

const callbackPattern =
  /^hod:action:(accept|reject|start|unblock|verify|cancel):([0-9a-f-]{36})(?::([a-f0-9]{16}))?$/i;
const commandByOperation: Record<string, ActionCommand> = {
  accept: 'ACCEPT',
  reject: 'REJECT',
  start: 'START',
  unblock: 'UNBLOCK',
  verify: 'VERIFY',
  cancel: 'CANCEL',
};

export class HandleActionCallbackUseCase implements InboundChatEventHandler {
  constructor(
    private readonly contexts: ActionContextStore,
    private readonly transitions: TransitionActionWithNotificationUseCase,
    private readonly pendingSessions?: PendingActionInboxSessionStore,
  ) {}

  async handle(event: InboundChatEvent): Promise<void> {
    if (event.kind !== 'message.callback' || !event.payload) return;
    const match = callbackPattern.exec(event.payload);
    if (!match) return;
    const operation = match[1]!.toLocaleLowerCase('en-US');
    const revision = match[3];
    if ((operation === 'accept' || operation === 'reject') && this.pendingSessions && !revision) {
      return;
    }
    if (
      revision &&
      (!this.pendingSessions ||
        !(await this.pendingSessions.isCurrent(event.actor.externalUserId, revision)))
    ) {
      return;
    }
    const actionId = match[2]!;
    const actor = await this.contexts.resolveActor(actionId, event.actor.externalUserId);
    if (!actor) throw new Error('Action actor is not an active workspace member');
    const command = commandByOperation[operation]!;
    try {
      await this.transitions.execute({
        actionId,
        workspaceId: actor.workspaceId,
        actorId: actor.actorId,
        idempotencyKey: `max-callback:${event.callbackId}`,
        command,
      });
    } catch (error) {
      if (
        command === 'CANCEL' &&
        error instanceof ActionTransitionError &&
        error.code === 'INVALID_TRANSITION'
      ) {
        const context = await this.contexts.getNotificationContext(actionId);
        if (
          context.status === 'CANCELLED' &&
          context.creatorExternalUserId === event.actor.externalUserId
        ) {
          return;
        }
      }
      throw error;
    }
  }
}
