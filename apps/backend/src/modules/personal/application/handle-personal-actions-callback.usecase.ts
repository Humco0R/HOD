import type { ActionContextStore, ActionEditPort, ActionReadPort } from '../../actions';
import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent, InboundChatEventHandler } from '../../workspaces';

import type { PersonalWorkspaceStore } from './personal-workspace.port';

import type { PersonalActionEditSessionStore } from './personal-action-edit-session.port';
import { actionCreatorLabel } from './personal-action-creator';
import {
  buildActionButtons,
  buildReadOnlyActionButtons,
  canDeleteAction,
  formatDeadline,
  formatExpectedResult,
  formatStatus,
  participantLabel,
} from './personal-action-card';
import { PersonalActionDeadlineCallbacks } from './personal-action-deadline-callbacks';
import { PersonalActionEditCallbacks } from './personal-action-edit-callbacks';
import { personalMainMenu } from './personal-main-menu';

const detailPattern =
  /^hod:personal:action:detail:([0-9a-f-]{36})(?::(?:(received|given):)?(active|today|overdue|completed):(\d{1,4}))?$/i;
const reviewDetailPattern = /^hod:personal:action:review:([0-9a-f-]{36}):(\d{1,4})$/i;

const editPattern = /^hod:personal:action:edit:([0-9a-f-]{36})$/i;

const editTitlePattern = /^hod:personal:action:edit-title:([0-9a-f-]{36})$/i;

const editDescriptionPattern = /^hod:personal:action:edit-description:([0-9a-f-]{36})$/i;

const editLocationPattern = /^hod:personal:action:edit-location:([0-9a-f-]{36})$/i;

const editDeadlinePattern = /^hod:personal:action:edit-deadline:([0-9a-f-]{36})$/i;

const editDeadlineDatePattern = /^hod:personal:action:edit-deadline-date:([0-9a-f-]{36})$/i;

const editDeadlineDatetimePattern = /^hod:personal:action:edit-deadline-datetime:([0-9a-f-]{36})$/i;

const editDeadlineClearPattern = /^hod:personal:action:edit-deadline-clear:([0-9a-f-]{36})$/i;

const deletePattern = /^hod:personal:action:delete:([0-9a-f-]{36})$/i;

const editCancelPattern = /^hod:personal:action:edit-cancel:([0-9a-f-]{36})$/i;

export class HandlePersonalActionsCallbackUseCase implements InboundChatEventHandler {
  private readonly editCallbacks: PersonalActionEditCallbacks;
  private readonly deadlineCallbacks: PersonalActionDeadlineCallbacks;
  constructor(
    private readonly store: PersonalWorkspaceStore,
    private readonly actions: ActionReadPort,
    actionEditor: ActionEditPort,
    private readonly notifications: NotificationPublisher,
    private readonly editSessions: PersonalActionEditSessionStore,
    private readonly contexts: ActionContextStore,
    private readonly defaultTimezone: string,
  ) {
    this.editCallbacks = new PersonalActionEditCallbacks(
      store,
      actions,
      notifications,
      editSessions,
    );
    this.deadlineCallbacks = new PersonalActionDeadlineCallbacks(
      store,
      actions,
      actionEditor,
      notifications,
      editSessions,
    );
  }

  async handle(event: InboundChatEvent): Promise<void> {
    if (event.kind !== 'message.callback' || !event.payload) {
      return;
    }

    if (event.payload === 'hod:personal:menu') {
      await this.editSessions.clear(event.actor.externalUserId);
      await this.notifications.publish(
        personalMainMenu(event.actor.externalUserId),
        `personal-menu-${event.callbackId}`,
      );
      return;
    }

    if (event.payload === 'hod:personal:help') {
      await this.notifications.publish(
        {
          target: { type: 'USER', externalId: event.actor.externalUserId },
          text: `Как пользоваться ХОД:

1. Нажми «Создать дело» и заполни его в чате или перешли мне сообщение с задачей.
2. Проверь карточку и подтверди создание кнопкой.
3. Открой «Мои дела», чтобы следить за работой.`,
          buttons: [{ text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 0 }],
        },
        `personal-help-${event.callbackId}`,
      );
      return;
    }

    const reviewDetailMatch = reviewDetailPattern.exec(event.payload);
    if (reviewDetailMatch) {
      await this.showActionDetail(
        event,
        reviewDetailMatch[1]!,
        `hod:personal:actions:review:${reviewDetailMatch[2]}`,
      );
      return;
    }

    const detailMatch = detailPattern.exec(event.payload);

    if (detailMatch) {
      const listReturn = detailMatch[3]
        ? `hod:personal:actions:${detailMatch[2] ?? 'received'}:${detailMatch[3]}:${detailMatch[4]}`
        : null;
      await this.showActionDetail(event, detailMatch[1]!, listReturn, detailMatch[2] === 'given');

      return;
    }

    const editMatch = editPattern.exec(event.payload);

    if (editMatch) {
      await this.editCallbacks.showEditMenu(event, editMatch[1]!);

      return;
    }

    const editTitleMatch = editTitlePattern.exec(event.payload);

    if (editTitleMatch) {
      await this.editCallbacks.startTitleEdit(event, editTitleMatch[1]!);

      return;
    }

    const editDescriptionMatch = editDescriptionPattern.exec(event.payload);

    if (editDescriptionMatch) {
      await this.editCallbacks.startDescriptionEdit(event, editDescriptionMatch[1]!);
      return;
    }

    const editLocationMatch = editLocationPattern.exec(event.payload);

    if (editLocationMatch) {
      await this.editCallbacks.startLocationEdit(event, editLocationMatch[1]!);
      return;
    }

    const editDeadlineMatch = editDeadlinePattern.exec(event.payload);

    if (editDeadlineMatch) {
      await this.deadlineCallbacks.startDeadlineEdit(event, editDeadlineMatch[1]!);
      return;
    }

    const editDeadlineDateMatch = editDeadlineDatePattern.exec(event.payload);

    if (editDeadlineDateMatch) {
      await this.deadlineCallbacks.startDeadlineDateEdit(event, editDeadlineDateMatch[1]!);

      return;
    }

    const editDeadlineDatetimeMatch = editDeadlineDatetimePattern.exec(event.payload);

    if (editDeadlineDatetimeMatch) {
      await this.deadlineCallbacks.startDeadlineDatetimeEdit(event, editDeadlineDatetimeMatch[1]!);

      return;
    }

    const editDeadlineClearMatch = editDeadlineClearPattern.exec(event.payload);

    if (editDeadlineClearMatch) {
      await this.deadlineCallbacks.clearDeadline(event, editDeadlineClearMatch[1]!);

      return;
    }

    const deleteMatch = deletePattern.exec(event.payload);

    if (deleteMatch) {
      await this.showDeleteConfirmation(event, deleteMatch[1]!);

      return;
    }

    const editCancelMatch = editCancelPattern.exec(event.payload);

    if (editCancelMatch) {
      await this.editSessions.clear(event.actor.externalUserId);

      await this.showActionDetail(event, editCancelMatch[1]!);

      return;
    }
  }

  private async showActionDetail(
    event: Extract<InboundChatEvent, { kind: 'message.callback' }>,
    actionId: string,
    listReturn: string | null = null,
    readOnly = false,
  ): Promise<void> {
    const externalUserId = event.actor.externalUserId;
    const target = event.externalChatId
      ? { type: 'CHAT' as const, externalId: event.externalChatId }
      : { type: 'USER' as const, externalId: externalUserId };

    const personal = await this.store.findByExternalUserId(externalUserId);

    const actor = personal ? null : await this.contexts.resolveActor(actionId, externalUserId);
    const viewerId = personal?.userId ?? actor?.actorId;
    if (!viewerId) return;

    const action = await this.actions.getDetail(viewerId, actionId, new Date());

    if (!action) {
      await this.notifications.publish(
        {
          target,

          text: 'Дело не найдено.',

          buttons: [
            {
              text: listReturn ? '⬅️ Назад' : '📋 Мои дела',
              payload: listReturn ?? 'hod:personal:actions',
              row: 0,
            },
          ],
        },

        `personal-action-not-found-${event.callbackId}`,
      );

      return;
    }

    const details: string[] = [
      `📄 ${action.title}`,
      '',
      `Постановщик: ${actionCreatorLabel(action, viewerId)}`,
      `Исполнитель: ${participantLabel(action.assignee)}`,
      `Статус: ${formatStatus(action.status)}`,
    ];

    const deadline = formatDeadline(action, personal?.timezone ?? this.defaultTimezone);

    if (deadline) {
      details.push(`📅 Срок: ${deadline}`);
    }

    if (action.description) {
      details.push('', 'Описание:', action.description);
    }

    if (action.location) {
      details.push('', `📍 Место: ${action.location}`);
    }

    if (action.expectedResultType !== 'NONE') {
      details.push('', `Результат: ${formatExpectedResult(action.expectedResultType)}`);

      if (action.expectedResultText) {
        details.push(action.expectedResultText);
      }
    }

    if (action.attachments.length) {
      details.push('', `📎 Материалы: ${action.attachments.length}`);
    }

    await this.notifications.publish(
      {
        target,

        text: details.join('\n'),

        buttons: readOnly
          ? buildReadOnlyActionButtons(listReturn)
          : buildActionButtons(action, viewerId, listReturn),
      },

      `personal-action-detail-${action.id}-${event.callbackId}`,
    );
  }

  private async showDeleteConfirmation(
    event: Extract<InboundChatEvent, { kind: 'message.callback' }>,
    actionId: string,
  ): Promise<void> {
    const externalUserId = event.actor.externalUserId;
    const personal = await this.store.findByExternalUserId(externalUserId);

    if (!personal) return;

    const action = await this.actions.getDetail(personal.userId, actionId, new Date());

    if (!action) return;

    if (!canDeleteAction(action, personal.userId)) {
      await this.notifications.publish(
        {
          target: { type: 'USER', externalId: externalUserId },
          text: 'Это дело нельзя удалить.',
          buttons: [
            {
              text: '↩️ Назад',
              payload: `hod:personal:action:detail:${action.id}`,
              row: 0,
            },
          ],
        },
        `personal-action-delete-forbidden-${event.callbackId}`,
      );

      return;
    }

    await this.notifications.publish(
      {
        target: { type: 'USER', externalId: externalUserId },
        text: `🗑 Удалить дело?\n\n${action.title}\n\nОно исчезнет из списков, но история сохранится.`,
        buttons: [
          {
            text: '🗑 Да, удалить',
            payload: `hod:action:cancel:${action.id}`,
            row: 0,
          },
          {
            text: '↩️ Отмена',
            payload: `hod:personal:action:detail:${action.id}`,
            row: 1,
          },
        ],
      },
      `personal-action-delete-confirm-${event.callbackId}`,
    );
  }
}
