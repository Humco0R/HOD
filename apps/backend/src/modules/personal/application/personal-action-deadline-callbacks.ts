import type { ActionEditPort, ActionReadPort } from '../../actions';
import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent } from '../../workspaces';
import type { PersonalActionEditSessionStore } from './personal-action-edit-session.port';
import { canEditAction } from './personal-action-card';
import type { PersonalWorkspaceStore } from './personal-workspace.port';

export class PersonalActionDeadlineCallbacks {
  constructor(
    private readonly store: PersonalWorkspaceStore,
    private readonly actions: ActionReadPort,
    private readonly actionEditor: ActionEditPort,
    private readonly notifications: NotificationPublisher,
    private readonly editSessions: PersonalActionEditSessionStore,
  ) {}

  async startDeadlineEdit(
    event: Extract<InboundChatEvent, { kind: 'message.callback' }>,
    actionId: string,
  ): Promise<void> {
    const externalUserId = event.actor.externalUserId;

    const personal = await this.store.findByExternalUserId(externalUserId);

    if (!personal) {
      return;
    }

    const action = await this.actions.getDetail(personal.userId, actionId, new Date());

    if (!action) {
      return;
    }

    if (!canEditAction(action, personal.userId)) {
      await this.notifications.publish(
        {
          target: {
            type: 'USER',
            externalId: externalUserId,
          },

          text: 'Это дело нельзя изменить.',

          buttons: [
            {
              text: '↩️ Назад',
              payload: `hod:personal:action:detail:${action.id}`,
              row: 0,
            },
          ],
        },

        `personal-action-edit-deadline-forbidden-${event.callbackId}`,
      );

      return;
    }

    await this.notifications.publish(
      {
        target: {
          type: 'USER',
          externalId: externalUserId,
        },

        text: `📅 Изменить срок

  Выбери, какой срок хочешь указать:`,

        buttons: [
          {
            text: '📆 Дата',
            payload: `hod:personal:action:edit-deadline-date:${action.id}`,
            row: 0,
          },
          {
            text: '🕐 Дата и время',
            payload: `hod:personal:action:edit-deadline-datetime:${action.id}`,
            row: 1,
          },
          {
            text: '🗑 Убрать срок',
            payload: `hod:personal:action:edit-deadline-clear:${action.id}`,
            row: 2,
          },
          {
            text: '↩️ Назад',
            payload: `hod:personal:action:edit:${action.id}`,
            row: 3,
          },
        ],
      },

      `personal-action-edit-deadline-${event.callbackId}`,
    );
  }

  async startDeadlineDateEdit(
    event: Extract<InboundChatEvent, { kind: 'message.callback' }>,
    actionId: string,
  ): Promise<void> {
    const externalUserId = event.actor.externalUserId;

    const personal = await this.store.findByExternalUserId(externalUserId);

    if (!personal) {
      return;
    }

    const action = await this.actions.getDetail(personal.userId, actionId, new Date());

    if (!action) {
      return;
    }

    if (!canEditAction(action, personal.userId)) {
      await this.notifications.publish(
        {
          target: {
            type: 'USER',
            externalId: externalUserId,
          },

          text: 'Это дело нельзя изменить.',

          buttons: [
            {
              text: '↩️ Назад',
              payload: `hod:personal:action:detail:${action.id}`,
              row: 0,
            },
          ],
        },

        `personal-action-edit-deadline-date-forbidden-${event.callbackId}`,
      );

      return;
    }

    await this.editSessions.set(externalUserId, {
      actionId: action.id,
      mode: 'DEADLINE_DATE',
    });

    await this.notifications.publish(
      {
        target: {
          type: 'USER',
          externalId: externalUserId,
        },

        text: `📆 Изменить дату

  Отправь новую дату в формате ДД.ММ.ГГГГ.

  Например:
  25.09.2026`,

        buttons: [
          {
            text: 'Отмена',
            payload: `hod:personal:action:edit-cancel:${action.id}`,
            row: 0,
          },
        ],
      },

      `personal-action-edit-deadline-date-${event.callbackId}`,
    );
  }

  async startDeadlineDatetimeEdit(
    event: Extract<InboundChatEvent, { kind: 'message.callback' }>,
    actionId: string,
  ): Promise<void> {
    const externalUserId = event.actor.externalUserId;

    const personal = await this.store.findByExternalUserId(externalUserId);

    if (!personal) {
      return;
    }

    const action = await this.actions.getDetail(personal.userId, actionId, new Date());

    if (!action) {
      return;
    }

    if (!canEditAction(action, personal.userId)) {
      await this.notifications.publish(
        {
          target: {
            type: 'USER',
            externalId: externalUserId,
          },

          text: 'Это дело нельзя изменить.',

          buttons: [
            {
              text: '↩️ Назад',
              payload: `hod:personal:action:detail:${action.id}`,
              row: 0,
            },
          ],
        },

        `personal-action-edit-deadline-datetime-forbidden-${event.callbackId}`,
      );

      return;
    }

    await this.editSessions.set(externalUserId, {
      actionId: action.id,
      mode: 'DEADLINE_DATETIME',
    });

    await this.notifications.publish(
      {
        target: {
          type: 'USER',
          externalId: externalUserId,
        },

        text: `🕐 Изменить дату и время

  Отправь новую дату и время в формате ДД.ММ.ГГГГ ЧЧ:ММ.

  Например:
  25.09.2026 18:30`,

        buttons: [
          {
            text: 'Отмена',
            payload: `hod:personal:action:edit-cancel:${action.id}`,
            row: 0,
          },
        ],
      },

      `personal-action-edit-deadline-datetime-${event.callbackId}`,
    );
  }

  async clearDeadline(
    event: Extract<InboundChatEvent, { kind: 'message.callback' }>,
    actionId: string,
  ): Promise<void> {
    const externalUserId = event.actor.externalUserId;

    const personal = await this.store.findByExternalUserId(externalUserId);

    if (!personal) {
      return;
    }

    const action = await this.actions.getDetail(personal.userId, actionId, new Date());

    if (!action) {
      return;
    }

    if (!canEditAction(action, personal.userId)) {
      await this.notifications.publish(
        {
          target: {
            type: 'USER',
            externalId: externalUserId,
          },

          text: 'Это дело нельзя изменить.',

          buttons: [
            {
              text: '↩️ Назад',
              payload: `hod:personal:action:detail:${action.id}`,
              row: 0,
            },
          ],
        },

        `personal-action-edit-deadline-clear-forbidden-${event.callbackId}`,
      );

      return;
    }

    const updated = await this.actionEditor.updateDeadline({
      actionId: action.id,
      actorUserId: personal.userId,
      deadlineKind: 'UNKNOWN',
      deadlineAt: null,
      deadlineDate: null,
      deadlineDependency: null,
      deadlineRaw: null,
    });

    if (!updated) {
      await this.notifications.publish(
        {
          target: {
            type: 'USER',
            externalId: externalUserId,
          },

          text: 'Не удалось удалить срок.',

          buttons: [],
        },

        `personal-action-edit-deadline-clear-failed-${event.callbackId}`,
      );

      return;
    }

    await this.editSessions.clear(externalUserId);

    await this.notifications.publish(
      {
        target: {
          type: 'USER',
          externalId: externalUserId,
        },

        text: '✅ Срок удалён.',

        buttons: [
          {
            text: '📄 Открыть дело',
            payload: `hod:personal:action:detail:${action.id}`,
            row: 0,
          },
          {
            text: '📋 Мои дела',
            payload: 'hod:personal:actions',
            row: 0,
          },
        ],
      },

      `personal-action-edit-deadline-clear-${event.callbackId}`,
    );
  }
}
