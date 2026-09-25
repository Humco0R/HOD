import type { InboundChatEvent, InboundChatEventHandler } from '../../workspaces';
import type { NotificationPublisher, OutboundNotification } from '../../notifications';
import type { AssignmentNotificationPort, DetectionRepository } from './detection.ports';

const callbackPattern = /^hod:detection:(confirm|reject):([0-9a-f-]{36})$/i;

export class HandleDetectionCallbackUseCase implements InboundChatEventHandler {
  constructor(
    private readonly repository: DetectionRepository,
    private readonly assignments: AssignmentNotificationPort,
    private readonly notifications?: NotificationPublisher,
  ) {}

  async handle(event: InboundChatEvent): Promise<void> {
    if (event.kind !== 'message.callback' || !event.payload) return;
    const match = callbackPattern.exec(event.payload);
    if (!match) return;
    const operation = match[1];
    const detectionId = match[2]!;

    if (operation === 'reject') {
      await this.repository.reject({
        detectionId,
        actorExternalUserId: event.actor.externalUserId,
      });
      if (this.notifications)
        await this.notifications.publish(
          {
            target: responseTarget(event),
            text: 'Предложение отклонено.',
            buttons: event.externalChatId
              ? []
              : [{ text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 0 }],
          },
          `detection-rejected-${event.callbackId}`,
        );
      return;
    }

    const result = await this.repository.confirm({
      detectionId,
      actorExternalUserId: event.actor.externalUserId,
      idempotencyKey: `max-callback:${event.callbackId}`,
    });
    if (!result.idempotent) {
      await this.assignments.publish({
        actionId: result.actionId,
        assigneeExternalUserId: result.assigneeExternalUserId,
        creatorName: result.creatorName,
        title: result.title,
      });
    }
    if (this.notifications)
      await this.notifications.publish(
        {
          target: responseTarget(event),
          text: `✅ Дело создано\n\n${result.title}`,
          buttons: event.externalChatId
            ? []
            : [
                {
                  text: '📄 Открыть дело',
                  payload: `hod:personal:action:detail:${result.actionId}`,
                  row: 0,
                },
                { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 1 },
              ],
        },
        `detection-confirmed-${event.callbackId}`,
      );
  }
}

function responseTarget(
  event: Extract<InboundChatEvent, { kind: 'message.callback' }>,
): OutboundNotification['target'] {
  return event.externalChatId
    ? { type: 'CHAT', externalId: event.externalChatId }
    : { type: 'USER', externalId: event.actor.externalUserId };
}

export class CompositeInboundChatEventHandler implements InboundChatEventHandler {
  constructor(private readonly handlers: InboundChatEventHandler[]) {}

  async handle(event: InboundChatEvent): Promise<void> {
    for (const handler of this.handlers) await handler.handle(event);
  }
}
