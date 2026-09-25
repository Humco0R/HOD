import { randomUUID } from 'node:crypto';

import type { ActionReadPort } from './action-read.port';
import type { ActionContextStore } from './action-context.port';
import type { ActionReasonSession, ActionReasonSessionStore } from './action-reason-session.port';
import type { TransitionActionWithNotificationUseCase } from './transition-action-with-notification.usecase';
import type { NotificationPublisher, OutboundNotification } from '../../notifications';
import type { InboundChatEvent, InboundChatEventHandler } from '../../workspaces';

const startPattern = /^hod:action:(block|return):([0-9a-f-]{36})$/i;
const stepPattern = /^hod:action:reason:(confirm|edit|cancel):([0-9a-f-]{36})$/i;
const maxReasonLength = 2000;

export class HandleActionReasonUseCase implements InboundChatEventHandler {
  constructor(
    private readonly contexts: ActionContextStore,
    private readonly actions: ActionReadPort,
    private readonly transitions: TransitionActionWithNotificationUseCase,
    private readonly sessions: ActionReasonSessionStore,
    private readonly notifications: NotificationPublisher,
  ) {}

  async handle(event: InboundChatEvent): Promise<void> {
    if (event.kind === 'personal.started') {
      await this.sessions.clear(event.actor.externalUserId);
      return;
    }
    if (event.kind === 'personal.message.created') {
      await this.handleMessage(event);
      return;
    }
    if (event.kind !== 'message.callback' || !event.payload) return;
    const userId = event.actor.externalUserId;
    const start = startPattern.exec(event.payload);
    if (start) {
      if (event.externalChatId !== null) {
        await this.notifications.publish(
          {
            target: { type: 'CHAT', externalId: event.externalChatId },
            text: 'Причину нужно отправить в личном чате с ботом. Открой там карточку дела.',
            buttons: [],
          },
          `action-reason-${event.eventId}`,
        );
        return;
      }
      const actionId = start[2]!;
      const actor = await this.contexts.resolveActor(actionId, userId);
      const action = actor
        ? await this.actions.getDetail(actor.actorId, actionId, new Date())
        : null;
      const command = start[1]!.toLowerCase() === 'block' ? 'BLOCK' : 'RETURN';
      const allowed =
        action &&
        (command === 'BLOCK'
          ? action.assignee.id === actor!.actorId &&
            ['ACCEPTED', 'IN_PROGRESS'].includes(action.status)
          : action.creator.id === actor!.actorId && action.status === 'DONE');
      if (!allowed) {
        await this.publish(
          userId,
          'Сейчас это действие недоступно.',
          detailButtons(actionId),
          event.eventId,
        );
        return;
      }
      const session: ActionReasonSession = {
        id: randomUUID(),
        actionId,
        command,
        reason: null,
        lastMessageId: null,
      };
      await this.sessions.set(userId, session);
      await this.publishPrompt(userId, session, event.eventId);
      return;
    }
    const step = stepPattern.exec(event.payload);
    if (step) {
      await this.handleStep(event, step[1]!.toLowerCase(), step[2]!);
      return;
    }
    if (isNavigation(event.payload)) await this.sessions.clear(userId);
  }

  private async handleMessage(
    event: Extract<InboundChatEvent, { kind: 'personal.message.created' }>,
  ): Promise<void> {
    const userId = event.author.externalUserId;
    const session = await this.sessions.get(userId);
    if (!session) return;
    if (/^\/start(?:\s|$)/iu.test(event.text?.trim() ?? '')) {
      await this.sessions.clear(userId);
      return;
    }
    if (session.lastMessageId === event.externalMessageId) return;
    const reason = event.text?.trim() ?? '';
    if (!reason || reason.length > maxReasonLength || event.attachmentMetadata.length) {
      await this.publish(
        userId,
        `Напиши причину текстом, до ${maxReasonLength} символов.`,
        inputButtons(session),
        event.eventId,
      );
      return;
    }
    session.reason = reason;
    session.lastMessageId = event.externalMessageId;
    await this.sessions.set(userId, session);
    await this.publishPrompt(userId, session, event.eventId);
  }

  private async handleStep(
    event: Extract<InboundChatEvent, { kind: 'message.callback' }>,
    operation: string,
    sessionId: string,
  ): Promise<void> {
    const userId = event.actor.externalUserId;
    const session = await this.sessions.get(userId);
    if (!session || session.id !== sessionId) {
      await this.publish(userId, 'Этот запрос больше не активен.', menuButtons(), event.eventId);
      return;
    }
    if (operation === 'cancel') {
      await this.sessions.clear(userId);
      await this.publish(
        userId,
        'Действие отменено.',
        detailButtons(session.actionId),
        event.eventId,
      );
      return;
    }
    if (operation === 'edit') {
      session.reason = null;
      await this.sessions.set(userId, session);
      await this.publishPrompt(userId, session, event.eventId);
      return;
    }
    if (operation !== 'confirm' || !session.reason) {
      await this.publishPrompt(userId, session, event.eventId);
      return;
    }
    const actor = await this.contexts.resolveActor(session.actionId, userId);
    if (!actor) {
      await this.sessions.clear(userId);
      await this.publish(userId, 'Нет доступа к делу.', menuButtons(), event.eventId);
      return;
    }
    try {
      await this.transitions.execute({
        actionId: session.actionId,
        workspaceId: actor.workspaceId,
        actorId: actor.actorId,
        idempotencyKey: `max-reason:${session.id}`,
        command: session.command,
        reason: session.reason,
      });
    } catch {
      await this.sessions.clear(userId);
      await this.publish(
        userId,
        'Статус дела изменился. Открой карточку и проверь его.',
        detailButtons(session.actionId),
        event.eventId,
      );
      return;
    }
    await this.sessions.clear(userId);
    await this.publish(
      userId,
      session.command === 'BLOCK'
        ? '⛔ Препятствие отправлено постановщику.'
        : '↩️ Результат возвращён исполнителю.',
      detailButtons(session.actionId),
      event.eventId,
    );
  }

  private publishPrompt(
    userId: string,
    session: ActionReasonSession,
    eventId: string,
  ): Promise<void> {
    return this.publish(
      userId,
      session.reason
        ? `${session.command === 'BLOCK' ? 'Сообщить о препятствии' : 'Вернуть результат'}?\n\nПричина: ${session.reason}`
        : session.command === 'BLOCK'
          ? 'Что мешает выполнить дело? Напиши причину сообщением.'
          : 'Почему результат нужно доработать? Напиши причину сообщением.',
      session.reason
        ? [
            { text: '✅ Подтвердить', payload: stepPayload('confirm', session), row: 0 },
            { text: '✏️ Изменить причину', payload: stepPayload('edit', session), row: 1 },
            { text: '❌ Отмена', payload: stepPayload('cancel', session), row: 2 },
            ...menuButtons(),
          ]
        : inputButtons(session),
      eventId,
    );
  }

  private publish(
    userId: string,
    text: string,
    buttons: OutboundNotification['buttons'],
    eventId: string,
  ): Promise<void> {
    return this.notifications.publish(
      { target: { type: 'USER', externalId: userId }, text, buttons },
      `action-reason-${eventId}`,
    );
  }
}

function stepPayload(operation: string, session: ActionReasonSession): string {
  return `hod:action:reason:${operation}:${session.id}`;
}

function inputButtons(session: ActionReasonSession): OutboundNotification['buttons'] {
  return [{ text: '⬅️ Назад', payload: stepPayload('cancel', session), row: 0 }, ...menuButtons()];
}

function detailButtons(actionId: string): OutboundNotification['buttons'] {
  return [
    { text: '📄 Открыть дело', payload: `hod:personal:action:detail:${actionId}`, row: 0 },
    ...menuButtons(),
  ];
}

function menuButtons(): OutboundNotification['buttons'] {
  return [{ text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 3 }];
}

function isNavigation(payload: string): boolean {
  return (
    payload === 'hod:personal:menu' ||
    payload.startsWith('hod:personal:action:') ||
    payload === 'hod:personal:actions'
  );
}
