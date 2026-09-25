import { randomUUID } from 'node:crypto';

import type {
  ActionContextStore,
  ActionReadPort,
  TransitionActionWithNotificationUseCase,
} from '../../actions';
import type { NotificationPublisher, OutboundNotification } from '../../notifications';
import type { InboundChatEvent, InboundChatEventHandler } from '../../workspaces';
import type { PersonalActionCreateSessionStore } from './personal-action-create-session.port';
import type { PersonalActionEditSessionStore } from './personal-action-edit-session.port';
import type {
  PersonalActionResultSession,
  PersonalActionResultSessionStore,
} from './personal-action-result-session.port';
import type { PersonalResultMaterialPort } from './personal-result-material.port';

const startPattern = /^hod:action:submit:([0-9a-f-]{36})$/i;
const stepPattern = /^hod:personal:complete:([a-z-]+):([0-9a-f-]{36})$/i;
const previewPattern = /^hod:personal:complete:preview:([0-9a-f-]{36}):([0-9a-f-]{36})$/i;
const maxMaterials = 10;
const maxCommentLength = 2_000;

export class HandlePersonalActionResultUseCase implements InboundChatEventHandler {
  private readonly pendingByUser = new Map<string, Promise<void>>();

  constructor(
    private readonly actions: ActionReadPort,
    private readonly contexts: ActionContextStore,
    private readonly transitions: TransitionActionWithNotificationUseCase,
    private readonly sessions: PersonalActionResultSessionStore,
    private readonly materials: PersonalResultMaterialPort,
    private readonly notifications: NotificationPublisher,
    private readonly createSessions: PersonalActionCreateSessionStore,
    private readonly editSessions: PersonalActionEditSessionStore,
  ) {}

  async handle(event: InboundChatEvent): Promise<void> {
    const userId =
      event.kind === 'personal.started' || event.kind === 'message.callback'
        ? event.actor.externalUserId
        : event.kind === 'personal.message.created'
          ? event.author.externalUserId
          : null;
    if (!userId) return;
    const previous = this.pendingByUser.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.handleForUser(event));
    this.pendingByUser.set(userId, current);
    try {
      await current;
    } finally {
      if (this.pendingByUser.get(userId) === current) this.pendingByUser.delete(userId);
    }
  }

  private async handleForUser(event: InboundChatEvent): Promise<void> {
    if (event.kind === 'personal.started') {
      const userId = event.actor.externalUserId;
      const session = await this.sessions.get(userId);
      if (session) await this.cancel(userId, session);
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
        await this.publish(
          userId,
          'Открой дело в личном чате с ботом, чтобы завершить его.',
          [],
          event.eventId,
        );
        return;
      }
      await this.start(event, start[1]!);
      return;
    }
    const step = stepPattern.exec(event.payload);
    const preview = previewPattern.exec(event.payload);
    if (preview) {
      await this.previewMaterial(event, preview[1]!, preview[2]!);
      return;
    }
    if (step) {
      await this.handleStep(event, step[1]!, step[2]!);
      return;
    }
    if (isNavigation(event.payload)) {
      const session = await this.sessions.get(userId);
      if (session) await this.cancel(userId, session);
    }
  }

  private async previewMaterial(
    event: Extract<InboundChatEvent, { kind: 'message.callback' }>,
    sessionId: string,
    materialId: string,
  ): Promise<void> {
    const userId = event.actor.externalUserId;
    const session = await this.sessions.get(userId);
    const material =
      session?.id === sessionId ? session.materials.find((item) => item.id === materialId) : null;
    if (!session || !material) {
      await this.publish(userId, 'Материал больше недоступен.', menuButtons(), event.eventId);
      return;
    }
    const actor = await this.contexts.resolveActor(session.actionId, userId);
    const action = actor
      ? await this.actions.getDetail(actor.actorId, session.actionId, new Date())
      : null;
    if (!action?.attachments.some((item) => item.id === materialId)) {
      await this.publish(userId, 'Материал больше недоступен.', menuButtons(), event.eventId);
      return;
    }
    await this.notifications.publish(
      {
        target: { type: 'USER', externalId: userId },
        text: `${material.kind === 'PHOTO' ? '📷' : '📎'} ${material.name}`,
        media: { attachmentId: material.id, requesterUserId: actor!.actorId },
        buttons: [
          {
            text: '⬅️ К подтверждению',
            payload: `hod:personal:complete:review:${session.id}`,
            row: 0,
          },
        ],
      },
      `personal-result-preview-${event.callbackId}`,
    );
  }

  private async start(
    event: Extract<InboundChatEvent, { kind: 'message.callback' }>,
    actionId: string,
  ): Promise<void> {
    const userId = event.actor.externalUserId;
    const actor = await this.contexts.resolveActor(actionId, userId);
    const action = actor ? await this.actions.getDetail(actor.actorId, actionId, new Date()) : null;
    if (!action || action.assignee.id !== actor!.actorId || action.status !== 'IN_PROGRESS') {
      await this.publish(userId, 'Это дело сейчас нельзя завершить.', menuButtons(), event.eventId);
      return;
    }
    await this.createSessions.clear(userId);
    await this.editSessions.clear(userId);
    let session = await this.sessions.get(userId);
    if (session && session.actionId !== actionId) {
      await this.cancel(userId, session);
      session = null;
    }
    if (!session) {
      session = {
        id: randomUUID(),
        actionId,
        step: 'OFFER',
        inputReturnStep: 'OFFER',
        reviewReturnStep: 'OFFER',
        comments: [],
        materials: [],
        lastHandledMessageId: null,
      };
      await this.sessions.set(userId, session);
    }
    await this.publishPrompt(userId, session, event.eventId);
  }

  private async handleMessage(
    event: Extract<InboundChatEvent, { kind: 'personal.message.created' }>,
  ): Promise<void> {
    const userId = event.author.externalUserId;
    const session = await this.sessions.get(userId);
    if (!session) return;
    if (/^\/start(?:\s|$)/iu.test(event.text?.trim() ?? '')) {
      await this.cancel(userId, session);
      return;
    }
    if (session.lastHandledMessageId === event.externalMessageId) return;
    if (session.step === 'COMMENT') {
      const comment = event.text?.trim() ?? '';
      if (!comment || event.attachmentMetadata.length) {
        await this.publishPrompt(userId, session, event.eventId, 'Отправь комментарий текстом.');
        return;
      }
      if (!addComment(session, comment)) {
        await this.publishPrompt(
          userId,
          session,
          event.eventId,
          'Комментарий слишком длинный. Всего можно до 2000 символов.',
        );
        return;
      }
      session.lastHandledMessageId = event.externalMessageId;
      await this.sessions.set(userId, session);
      await this.publishPrompt(userId, session, event.eventId, 'Комментарий добавлен.');
      return;
    }
    if (session.step !== 'PHOTO' && session.step !== 'FILE') return;
    const kind = session.step;
    const matching = event.attachmentMetadata.filter(
      (attachment) => attachment.type === (kind === 'PHOTO' ? 'image' : 'file'),
    );
    if (!matching.length) {
      await this.publishPrompt(
        userId,
        session,
        event.eventId,
        kind === 'PHOTO' ? 'Отправь фото сообщением в MAX.' : 'Отправь файл сообщением в MAX.',
      );
      return;
    }
    const actor = await this.contexts.resolveActor(session.actionId, userId);
    if (!actor) return;
    let saved = 0;
    let failed = false;
    for (const attachment of matching.slice(
      0,
      Math.max(0, maxMaterials - session.materials.length),
    )) {
      try {
        const material = await this.materials.save({
          actionId: session.actionId,
          userId: actor.actorId,
          kind,
          attachment,
        });
        session.materials.push(material);
        saved += 1;
        await this.sessions.set(userId, session);
      } catch {
        failed = true;
      }
    }
    if (event.text?.trim() && !addComment(session, event.text.trim())) failed = true;
    session.lastHandledMessageId = event.externalMessageId;
    await this.sessions.set(userId, session);
    const notice = saved
      ? `Добавлено: ${saved}.${failed ? ' Часть материалов не удалось сохранить; отправь их ещё раз.' : ''}`
      : session.materials.length >= maxMaterials
        ? 'Можно приложить не более 10 материалов.'
        : 'Не получилось сохранить вложение. Проверь размер и отправь ещё раз.';
    await this.publishPrompt(userId, session, event.eventId, notice);
  }

  private async handleStep(
    event: Extract<InboundChatEvent, { kind: 'message.callback' }>,
    operation: string,
    sessionId: string,
  ): Promise<void> {
    const userId = event.actor.externalUserId;
    const session = await this.sessions.get(userId);
    if (!session || session.id !== sessionId) {
      await this.publish(
        userId,
        'Этот черновик выполнения больше не активен.',
        menuButtons(),
        event.eventId,
      );
      return;
    }
    if (operation === 'cancel') {
      await this.cancel(userId, session);
      await this.publish(
        userId,
        'Выполнение отменено. Дело осталось в работе.',
        detailButtons(session.actionId),
        event.eventId,
      );
      return;
    }
    if (operation === 'confirm') {
      if (session.step !== 'REVIEW') {
        await this.publishPrompt(userId, session, event.eventId);
        return;
      }
      const actor = await this.contexts.resolveActor(session.actionId, userId);
      if (!actor) {
        await this.publish(userId, 'Нет доступа к этому делу.', menuButtons(), event.eventId);
        return;
      }
      let result: Awaited<ReturnType<TransitionActionWithNotificationUseCase['execute']>>;
      try {
        result = await this.transitions.execute({
          actionId: session.actionId,
          workspaceId: actor.workspaceId,
          actorId: actor.actorId,
          idempotencyKey: `max-result:${session.id}`,
          command: 'SUBMIT_RESULT',
          ...(session.comments.length ? { reason: session.comments.join('\n\n') } : {}),
        });
      } catch {
        await this.publish(
          userId,
          'Не получилось завершить дело. Проверь его статус и попробуй ещё раз.',
          detailButtons(session.actionId),
          event.eventId,
        );
        return;
      }
      await this.sessions.clear(userId);
      await this.publish(
        userId,
        result.action.status === 'VERIFIED'
          ? '✅ Дело выполнено и подтверждено.'
          : '✅ Результат отправлен. Дело ждёт подтверждения.',
        detailButtons(session.actionId),
        event.eventId,
      );
      return;
    }
    if (operation === 'remove-file') {
      const material = session.materials.at(-1);
      if (material) {
        const actor = await this.contexts.resolveActor(session.actionId, userId);
        if (!actor) return;
        await this.materials.remove({
          actionId: session.actionId,
          userId: actor.actorId,
          materialId: material.id,
        });
        session.materials.pop();
      }
      session.step = 'EDIT';
    } else if (operation === 'remove-comment') {
      session.comments.pop();
      session.step = 'EDIT';
    } else if (operation === 'back') {
      if (session.step === 'OFFER') {
        await this.cancel(userId, session);
        await this.publish(
          userId,
          'Дело осталось в работе.',
          detailButtons(session.actionId),
          event.eventId,
        );
        return;
      }
      session.step =
        session.step === 'EDIT'
          ? 'REVIEW'
          : session.step === 'REVIEW'
            ? session.reviewReturnStep
            : session.inputReturnStep;
    } else if (operation === 'photo' || operation === 'file' || operation === 'comment') {
      session.inputReturnStep = session.step === 'EDIT' ? 'EDIT' : 'OFFER';
      session.step = operation.toUpperCase() as 'PHOTO' | 'FILE' | 'COMMENT';
    } else if (operation === 'review') {
      session.reviewReturnStep =
        session.step === 'OFFER'
          ? 'OFFER'
          : session.step === 'EDIT'
            ? 'EDIT'
            : session.inputReturnStep;
      session.step = 'REVIEW';
    } else if (operation === 'edit') {
      session.step = 'EDIT';
    } else {
      return;
    }
    await this.sessions.set(userId, session);
    await this.publishPrompt(userId, session, event.eventId);
  }

  private async cancel(userId: string, session: PersonalActionResultSession): Promise<void> {
    const actor = await this.contexts.resolveActor(session.actionId, userId);
    if (actor) {
      for (const material of session.materials) {
        await this.materials.remove({
          actionId: session.actionId,
          userId: actor.actorId,
          materialId: material.id,
        });
      }
    }
    await this.sessions.clear(userId);
  }

  private publishPrompt(
    userId: string,
    session: PersonalActionResultSession,
    eventId: string,
    notice?: string,
  ): Promise<void> {
    return this.notifications.publish(
      renderPrompt(userId, session, notice),
      `personal-result-${eventId}`,
    );
  }

  private publish(
    userId: string,
    message: string,
    buttons: OutboundNotification['buttons'],
    eventId: string,
  ): Promise<void> {
    return this.notifications.publish(
      { target: { type: 'USER', externalId: userId }, text: message, buttons },
      `personal-result-${eventId}`,
    );
  }
}

function addComment(session: PersonalActionResultSession, value: string): boolean {
  const comment = value.trim();
  if (!comment || [...session.comments, comment].join('\n\n').length > maxCommentLength)
    return false;
  session.comments.push(comment);
  return true;
}

function renderPrompt(
  userId: string,
  session: PersonalActionResultSession,
  notice?: string,
): OutboundNotification {
  const payload = (operation: string) => `hod:personal:complete:${operation}:${session.id}`;
  const counts = `Фото: ${session.materials.filter((item) => item.kind === 'PHOTO').length} · файлы: ${session.materials.filter((item) => item.kind === 'FILE').length} · комментарии: ${session.comments.length}`;
  const base = [notice, counts].filter(Boolean).join('\n\n');
  let text: string;
  let buttons: OutboundNotification['buttons'];
  if (session.step === 'OFFER') {
    text = `Хотите приложить результат выполнения?\n\n${base}`;
    buttons = [
      { text: '📷 Добавить фото', payload: payload('photo'), row: 0 },
      { text: '📎 Добавить файл', payload: payload('file'), row: 1 },
      { text: '💬 Добавить комментарий', payload: payload('comment'), row: 2 },
      {
        text:
          session.materials.length || session.comments.length
            ? '➡️ К подтверждению'
            : '✅ Завершить без вложения',
        payload: payload('review'),
        row: 3,
      },
      { text: '⬅️ Назад', payload: payload('back'), row: 4 },
    ];
  } else if (session.step === 'PHOTO' || session.step === 'FILE' || session.step === 'COMMENT') {
    text = `${session.step === 'PHOTO' ? 'Отправь фото' : session.step === 'FILE' ? 'Отправь файл' : 'Отправь комментарий текстом'} в этот чат. Можно отправить несколько сообщений.\n\n${base}`;
    buttons = [
      { text: '➡️ К подтверждению', payload: payload('review'), row: 0 },
      { text: '⬅️ Назад', payload: payload('back'), row: 1 },
    ];
  } else if (session.step === 'EDIT') {
    text = `Изменить результат выполнения\n\n${base}`;
    buttons = [
      { text: '📷 Добавить фото', payload: payload('photo'), row: 0 },
      { text: '📎 Добавить файл', payload: payload('file'), row: 1 },
      { text: '💬 Добавить комментарий', payload: payload('comment'), row: 2 },
      ...(session.materials.length
        ? [{ text: '🗑 Убрать последнее вложение', payload: payload('remove-file'), row: 3 }]
        : []),
      ...(session.comments.length
        ? [{ text: '🗑 Убрать последний комментарий', payload: payload('remove-comment'), row: 4 }]
        : []),
      { text: '➡️ К подтверждению', payload: payload('review'), row: 5 },
      { text: '⬅️ Назад', payload: payload('back'), row: 6 },
    ];
  } else {
    const filenames = session.materials
      .map((material, index) => `${index + 1}. ${Array.from(material.name).slice(0, 50).join('')}`)
      .join('\n');
    text = `Подтвердить выполнение задачи?\n\n${base}${filenames ? `\n\nМатериалы:\n${filenames}` : ''}${session.comments.length ? `\n\nКомментарий:\n${session.comments.join('\n\n')}` : ''}`;
    buttons = [
      ...session.materials.map((material, index) => ({
        text: `${material.kind === 'PHOTO' ? '📷' : '📎'} Посмотреть ${index + 1}`,
        payload: `hod:personal:complete:preview:${session.id}:${material.id}`,
        row: index,
      })),
      { text: '✅ Да, завершить', payload: payload('confirm'), row: 10 },
      { text: '✏️ Изменить', payload: payload('edit'), row: 11 },
      { text: '❌ Отмена', payload: payload('cancel'), row: 12 },
      { text: '⬅️ Назад', payload: payload('back'), row: 13 },
    ];
  }
  return { target: { type: 'USER', externalId: userId }, text, buttons };
}

function detailButtons(actionId: string): OutboundNotification['buttons'] {
  return [
    { text: '📄 Открыть дело', payload: `hod:personal:action:detail:${actionId}`, row: 0 },
    ...menuButtons(),
  ];
}

function menuButtons(): OutboundNotification['buttons'] {
  return [{ text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 1 }];
}

function isNavigation(payload: string): boolean {
  return (
    payload === 'hod:personal:menu' ||
    payload === 'hod:personal:help' ||
    payload === 'hod:personal:create' ||
    payload === 'hod:personal:actions' ||
    payload.startsWith('hod:personal:actions:') ||
    payload.startsWith('hod:personal:action:') ||
    payload.startsWith('hod:action:block:') ||
    payload.startsWith('hod:action:return:')
  );
}
