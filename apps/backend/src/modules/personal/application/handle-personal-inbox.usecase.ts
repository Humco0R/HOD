import type { ActionReasonSessionStore } from '../../actions';
import type { ActionEditPort } from '../../actions';
import type { DetectionJob, DetectionQueuePort } from '../../detections';
import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent, InboundChatEventHandler } from '../../workspaces';
import { PersonalActionDeadlineEditMessages } from './personal-action-deadline-edit-messages';
import { PersonalActionTextEditMessages } from './personal-action-text-edit-messages';
import { notificationId, publishPersonalHelp } from './personal-inbox-notification';
import type { PersonalActionCreateSessionStore } from './personal-action-create-session.port';
import type { PersonalActionResultSessionStore } from './personal-action-result-session.port';
import { personalMainMenu } from './personal-main-menu';
import type { PersonalActionEditSessionStore } from './personal-action-edit-session.port';
import type { PersonalWorkspaceStore } from './personal-workspace.port';

export class HandlePersonalInboxUseCase implements InboundChatEventHandler {
  private readonly textEdits: PersonalActionTextEditMessages;
  private readonly deadlineEdits: PersonalActionDeadlineEditMessages;
  constructor(
    private readonly store: PersonalWorkspaceStore,
    private readonly queue: DetectionQueuePort | null,
    private readonly notifications: NotificationPublisher,
    private readonly defaultTimezone: string,
    private readonly editSessions: PersonalActionEditSessionStore,
    actionEditor: ActionEditPort,
    private readonly createSessions: PersonalActionCreateSessionStore,
    private readonly resultSessions: PersonalActionResultSessionStore,
    private readonly reasonSessions: ActionReasonSessionStore,
  ) {
    this.textEdits = new PersonalActionTextEditMessages(editSessions, actionEditor, notifications);
    this.deadlineEdits = new PersonalActionDeadlineEditMessages(
      editSessions,
      actionEditor,
      notifications,
    );
  }

  async handle(event: InboundChatEvent): Promise<void> {
    if (
      event.kind === 'message.callback' &&
      event.payload &&
      (event.payload.startsWith('hod:action:block:') ||
        event.payload.startsWith('hod:action:return:'))
    ) {
      await this.editSessions.clear(event.actor.externalUserId);
      return;
    }
    if (event.kind === 'personal.started') {
      await this.store.bootstrap({
        externalDialogId: event.externalDialogId,
        user: event.actor,
        timezone: this.defaultTimezone,
      });
      await this.publishWelcome(event.actor.externalUserId, event.eventId);
      return;
    }
    if (event.kind !== 'personal.message.created') return;

    const externalUserId = event.author.externalUserId;
    let personal = await this.store.findByExternalUserId(externalUserId);
    if (isStartCommand(event.text)) {
      if (!personal) {
        await this.store.bootstrap({
          externalDialogId: null,
          user: event.author,
          timezone: this.defaultTimezone,
        });
      }
      await this.publishWelcome(externalUserId, event.eventId);
      return;
    }

    if (await this.createSessions.get(externalUserId)) return;
    if (await this.resultSessions.get(externalUserId)) return;
    if (await this.reasonSessions.get(externalUserId)) return;

    const editSession = await this.editSessions.get(externalUserId);

    if (editSession && !event.forwardedMessage) {
      if (!personal) {
        await this.editSessions.clear(externalUserId);

        return;
      }

      if (editSession.mode === 'DEADLINE_DATE' || editSession.mode === 'DEADLINE_DATETIME') {
        await this.deadlineEdits.handle(event, personal, editSession);
      } else {
        await this.textEdits.handle(event, personal, editSession);
      }
      return;
    }

    if (!personal && event.forwardedMessage) {
      personal = await this.store.bootstrap({
        externalDialogId: null,
        user: event.author,
        timezone: this.defaultTimezone,
      });
    }
    if (!personal) {
      await publishPersonalHelp(
        this.notifications,
        externalUserId,
        'Сначала нажмите «Начать» в профиле бота, затем перешлите сообщение с задачей.',
        event.eventId,
      );
      return;
    }
    if (!event.forwardedMessage) {
      await publishPersonalHelp(
        this.notifications,
        externalUserId,
        'Нажми «Создать дело», чтобы заполнить его в чате, или перешли сюда сообщение с задачей.',
        event.eventId,
      );
      return;
    }
    const sourceText = combineForwardedText(event.text, event.forwardedMessage.text);
    if (!sourceText) {
      await publishPersonalHelp(
        this.notifications,
        externalUserId,
        'В этой версии ХОД распознаёт текст пересланного сообщения. Добавьте к пересылке текст задачи.',
        event.eventId,
      );
      return;
    }
    if (!this.queue) {
      await publishPersonalHelp(
        this.notifications,
        externalUserId,
        'Распознавание задач сейчас не настроено. Нужен включённый AI provider.',
        event.eventId,
      );
      return;
    }

    const contextMessage = {
      messageId: event.externalMessageId,
      senderMaxUserId: externalUserId,
      timestamp: event.occurredAt.toISOString(),
      text: sourceText,
    };
    const job: DetectionJob = {
      sourceMode: 'PERSONAL_FORWARD',
      assignmentStrategy: 'SOURCE_AUTHOR',
      proposalTarget: { type: 'USER', externalId: externalUserId },
      workspaceId: personal.workspaceId,
      chatId: personal.chatId,
      externalChatId: `personal:${externalUserId}`,
      sourceMessageId: event.externalMessageId,
      sourceSenderId: personal.userId,
      sourceSenderExternalId: externalUserId,
      occurredAt: event.occurredAt.toISOString(),
      text: sourceText,
      attachmentMetadata: event.forwardedMessage.attachmentMetadata,
      context: [contextMessage],
    };
    await this.queue.publish(job, event.eventId);
    await this.notifications.publish(
      {
        target: { type: 'USER', externalId: externalUserId },
        text: 'Получил пересланное сообщение. Проверяю, можно ли превратить его в дело.',
        buttons: [{ text: '🏠 Главное меню', payload: 'hod:personal:menu' }],
      },
      notificationId('personal-received', event.eventId),
    );
  }

  private publishWelcome(externalUserId: string, eventId: string): Promise<void> {
    return this.notifications.publish(
      personalMainMenu(externalUserId),
      notificationId('personal-welcome', eventId),
    );
  }
}

function isStartCommand(text: string | null): boolean {
  return /^\/start(?:\s|$)/iu.test(text?.trim() ?? '');
}

function combineForwardedText(note: string | null, forwarded: string | null): string | null {
  const parts = [forwarded?.trim(), note?.trim()]
    .filter((value): value is string => Boolean(value))
    .map((value, index) => (index === 0 ? value : `Комментарий пользователя: ${value}`));
  return parts.length ? parts.join('\n\n') : null;
}
