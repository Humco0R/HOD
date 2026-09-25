import type { InboundChatEvent, InboundChatEventHandler } from '../../workspaces';
import type { ActionCommand } from '../domain/action';
import { ActionTransitionError } from '../domain/action-errors';
import type { ActionContextStore } from './action-context.port';
import type { TransitionActionWithNotificationUseCase } from './transition-action-with-notification.usecase';

const callbackPattern = /^hod:action:(accept|start|unblock|verify|cancel):([0-9a-f-]{36})$/i;
const commandByOperation: Record<string, ActionCommand> = {
  accept: 'ACCEPT',
  start: 'START',
  unblock: 'UNBLOCK',
  verify: 'VERIFY',
  cancel: 'CANCEL',
};

export class HandleActionCallbackUseCase implements InboundChatEventHandler {
  constructor(
    private readonly contexts: ActionContextStore,
    private readonly transitions: TransitionActionWithNotificationUseCase,
  ) {}

  async handle(event: InboundChatEvent): Promise<void> {
    if (event.kind !== 'message.callback' || !event.payload) return;
    const match = callbackPattern.exec(event.payload);
    if (!match) return;
    const actionId = match[2]!;
    const actor = await this.contexts.resolveActor(actionId, event.actor.externalUserId);
    if (!actor) throw new Error('Action actor is not an active workspace member');
    const command = commandByOperation[match[1]!.toLocaleLowerCase('en-US')]!;
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
