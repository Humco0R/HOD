import { randomUUID } from 'node:crypto';

import type { ActionCreatePort } from '../../actions';
import type { NotificationPublisher, OutboundNotification } from '../../notifications';
import type { InboundChatEvent, InboundChatEventHandler } from '../../workspaces';
import type {
  PersonalActionCreateSession,
  PersonalActionCreateSessionStore,
  PersonalCreateStep,
} from './personal-action-create-session.port';
import type { PersonalActionEditSessionStore } from './personal-action-edit-session.port';
import { setPersonalCreateDeadline } from './personal-create-deadline';
import { personalCreatePrompt } from './personal-create-prompt';
import { personalMainMenu } from './personal-main-menu';
import type { PersonalWorkspaceStore } from './personal-workspace.port';

const callbackPattern = /^hod:personal:create:([a-z-]+):([0-9a-f-]{36})$/i;

export class HandlePersonalCreateUseCase implements InboundChatEventHandler {
  constructor(
    private readonly workspaces: PersonalWorkspaceStore,
    private readonly sessions: PersonalActionCreateSessionStore,
    private readonly editSessions: PersonalActionEditSessionStore,
    private readonly actions: ActionCreatePort,
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
    if (
      event.payload === 'hod:personal:menu' ||
      event.payload === 'hod:personal:help' ||
      event.payload === 'hod:personal:actions' ||
      event.payload.startsWith('hod:personal:actions:') ||
      event.payload.startsWith('hod:personal:action:') ||
      event.payload.startsWith('hod:action:block:') ||
      event.payload.startsWith('hod:action:return:')
    ) {
      await this.sessions.clear(userId);
      return;
    }
    if (event.payload === 'hod:personal:create') {
      await this.start(event);
      return;
    }
    const match = callbackPattern.exec(event.payload);
    if (!match) return;
    const session = await this.sessions.get(userId);
    if (!session || session.id !== match[2]) {
      if (match[1] === 'confirm') {
        const personal = await this.workspaces.findByExternalUserId(userId);
        if (personal && (await this.actions.exists(match[2]!, personal.userId))) return;
      }
      await this.publish(
        userId,
        {
          target: { type: 'USER', externalId: userId },
          text: 'Этот черновик больше не активен. Начни создание заново.',
          buttons: [
            { text: '➕ Создать дело', payload: 'hod:personal:create', row: 0 },
            { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 1 },
          ],
        },
        event.eventId,
      );
      return;
    }
    if (session.lastHandledEventId === event.eventId) {
      await this.publishPrompt(userId, session, event.eventId);
      return;
    }
    await this.handleCallback(event, session, match[1]!);
  }

  private async start(event: Extract<InboundChatEvent, { kind: 'message.callback' }>) {
    const userId = event.actor.externalUserId;
    const personal = await this.workspaces.findByExternalUserId(userId);
    if (!personal) {
      await this.publish(
        userId,
        {
          target: { type: 'USER', externalId: userId },
          text: 'Сначала нажми «Начать» в профиле бота.',
          buttons: [],
        },
        event.eventId,
      );
      return;
    }
    await this.editSessions.clear(userId);
    let session = await this.sessions.get(userId);
    if (!session) {
      session = {
        id: randomUUID(),
        step: 'TITLE',
        navigationStack: [],
        lastHandledEventId: null,
        title: null,
        description: null,
        deadlineKind: 'UNKNOWN',
        deadlineDate: null,
        deadlineAt: null,
        deadlineRaw: null,
      };
      await this.sessions.set(userId, session);
    }
    await this.publishPrompt(userId, session, event.eventId);
  }

  private async handleMessage(
    event: Extract<InboundChatEvent, { kind: 'personal.message.created' }>,
  ): Promise<void> {
    const userId = event.author.externalUserId;
    if (/^\/start(?:\s|$)/iu.test(event.text?.trim() ?? '')) {
      await this.sessions.clear(userId);
      return;
    }
    const session = await this.sessions.get(userId);
    if (!session) return;
    if (event.forwardedMessage) {
      await this.sessions.clear(userId);
      return;
    }
    if (session.lastHandledEventId === event.eventId) {
      await this.publishPrompt(userId, session, event.eventId, undefined, true);
      return;
    }
    if (event.attachmentMetadata.length) {
      await this.publishPrompt(userId, session, event.eventId, 'На этом шаге отправь текст.', true);
      return;
    }
    const value = event.text?.trim() ?? '';
    let notice: string | undefined;
    if (session.step === 'TITLE') {
      if (!value || value.length > 200) {
        notice = 'Название должно содержать от 1 до 200 символов.';
      } else {
        session.title = value;
        advance(session, session.navigationStack.includes('EDIT') ? 'REVIEW' : 'DESCRIPTION');
      }
    } else if (session.step === 'DESCRIPTION') {
      if (!value || value.length > 2000) {
        notice = 'Описание должно содержать от 1 до 2000 символов. Его можно пропустить кнопкой.';
      } else {
        session.description = value;
        advance(session, session.navigationStack.includes('EDIT') ? 'REVIEW' : 'DEADLINE');
      }
    } else if (session.step === 'DEADLINE_DATE' || session.step === 'DEADLINE_DATETIME') {
      const personal = await this.workspaces.findByExternalUserId(userId);
      if (!personal) return;
      notice = setPersonalCreateDeadline(session, value, personal.timezone, event.occurredAt);
      if (!notice) advance(session, 'REVIEW');
    } else {
      notice = 'Выбери действие кнопкой.';
    }
    if (!notice) {
      session.lastHandledEventId = event.eventId;
      await this.sessions.set(userId, session);
    }
    await this.publishPrompt(userId, session, event.eventId, notice, true);
  }

  private async handleCallback(
    event: Extract<InboundChatEvent, { kind: 'message.callback' }>,
    session: PersonalActionCreateSession,
    operation: string,
  ): Promise<void> {
    const userId = event.actor.externalUserId;
    if (operation === 'cancel') {
      await this.publish(userId, personalMainMenu(userId), event.eventId);
      await this.sessions.clear(userId);
      return;
    }
    if (operation === 'back') {
      const previous = session.navigationStack.pop();
      if (!previous) {
        await this.publish(userId, personalMainMenu(userId), event.eventId);
        await this.sessions.clear(userId);
        return;
      }
      session.step = previous;
    } else if (operation === 'skip-description' && session.step === 'DESCRIPTION') {
      session.description = null;
      advance(session, session.navigationStack.includes('EDIT') ? 'REVIEW' : 'DEADLINE');
    } else if (operation === 'date' && session.step === 'DEADLINE') {
      advance(session, 'DEADLINE_DATE');
    } else if (operation === 'datetime' && session.step === 'DEADLINE') {
      advance(session, 'DEADLINE_DATETIME');
    } else if (operation === 'no-deadline' && session.step === 'DEADLINE') {
      session.deadlineKind = 'UNKNOWN';
      session.deadlineDate = null;
      session.deadlineAt = null;
      session.deadlineRaw = null;
      advance(session, 'REVIEW');
    } else if (operation === 'edit' && session.step === 'REVIEW') {
      advance(session, 'EDIT');
    } else if (operation.startsWith('field-') && session.step === 'EDIT') {
      const field: Record<string, PersonalCreateStep> = {
        'field-title': 'TITLE',
        'field-description': 'DESCRIPTION',
        'field-deadline': 'DEADLINE',
      };
      const next = field[operation];
      if (!next) return;
      advance(session, next);
    } else if (operation === 'confirm' && session.step === 'REVIEW') {
      await this.confirm(event, session);
      return;
    } else {
      return;
    }
    session.lastHandledEventId = event.eventId;
    await this.sessions.set(userId, session);
    await this.publishPrompt(userId, session, event.eventId);
  }

  private async confirm(
    event: Extract<InboundChatEvent, { kind: 'message.callback' }>,
    session: PersonalActionCreateSession,
  ): Promise<void> {
    const userId = event.actor.externalUserId;
    const personal = await this.workspaces.findByExternalUserId(userId);
    if (!personal || !session.title) throw new Error('Personal action draft is incomplete');
    const result = await this.actions.create({
      id: session.id,
      workspaceId: personal.workspaceId,
      chatId: personal.chatId,
      actorUserId: personal.userId,
      title: session.title,
      description: session.description,
      deadlineKind: session.deadlineKind,
      deadlineDate: session.deadlineDate,
      deadlineAt: session.deadlineAt ? new Date(session.deadlineAt) : null,
      deadlineRaw: session.deadlineRaw,
    });
    await this.notifications.publish(
      {
        target: { type: 'USER', externalId: userId },
        text: `✅ Дело создано\n\n${session.title}`,
        buttons: [
          {
            text: '📄 Открыть дело',
            payload: `hod:personal:action:detail:${result.actionId}`,
            row: 0,
          },
          { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 1 },
        ],
      },
      `personal-create-done-${session.id}`,
    );
    await this.sessions.clear(userId);
  }

  private publish(userId: string, notification: OutboundNotification, eventId: string) {
    return this.notifications.publish(notification, `personal-create-prompt-${userId}-${eventId}`);
  }

  private publishPrompt(
    userId: string,
    session: PersonalActionCreateSession,
    eventId: string,
    notice?: string,
    replacePrevious = false,
  ) {
    return this.publish(
      userId,
      {
        ...personalCreatePrompt(userId, session, notice),
        screen: { key: session.id, replacePrevious },
      },
      eventId,
    );
  }
}

function advance(session: PersonalActionCreateSession, next: PersonalCreateStep): void {
  session.navigationStack.push(session.step);
  session.step = next;
}
