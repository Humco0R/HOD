import type { ActionReadPort } from '../../actions';
import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent } from '../../workspaces';
import type { PersonalActionEditSessionStore } from './personal-action-edit-session.port';
import { canEditAction } from './personal-action-card';
import type { PersonalWorkspaceStore } from './personal-workspace.port';

export class PersonalActionEditCallbacks {
  constructor(
    private readonly store: PersonalWorkspaceStore,
    private readonly actions: ActionReadPort,
    private readonly notifications: NotificationPublisher,
    private readonly editSessions: PersonalActionEditSessionStore,
  ) {}

  async showEditMenu(
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
      await this.notifications.publish(
        {
          target: {
            type: 'USER',
            externalId: externalUserId,
          },

          text: 'Дело не найдено.',

          buttons: [
            {
              text: '📋 Мои дела',
              payload: 'hod:personal:actions',
              row: 0,
            },
          ],
        },

        `personal-action-edit-not-found-${event.callbackId}`,
      );

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
              text: '📄 Подробнее',
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

        `personal-action-edit-forbidden-${event.callbackId}`,
      );

      return;
    }

    await this.notifications.publish(
      {
        target: {
          type: 'USER',
          externalId: externalUserId,
        },

        text: `✏️ Изменить дело

  ${action.title}

  Что хочешь изменить?`,

        buttons: [
          {
            text: '📝 Название',
            payload: `hod:personal:action:edit-title:${action.id}`,
            row: 0,
          },
          {
            text: '📅 Срок',
            payload: `hod:personal:action:edit-deadline:${action.id}`,
            row: 0,
          },
          {
            text: '📄 Описание',
            payload: `hod:personal:action:edit-description:${action.id}`,
            row: 1,
          },
          {
            text: '📍 Место',
            payload: `hod:personal:action:edit-location:${action.id}`,
            row: 1,
          },
          {
            text: '🗑 Удалить дело',
            payload: `hod:personal:action:delete:${action.id}`,
            row: 2,
          },
          {
            text: '↩️ Назад',
            payload: `hod:personal:action:detail:${action.id}`,
            row: 3,
          },
        ],
      },

      `personal-action-edit-menu-${event.callbackId}`,
    );
  }

  async startTitleEdit(
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

        `personal-action-edit-title-forbidden-${event.callbackId}`,
      );

      return;
    }

    await this.editSessions.set(externalUserId, {
      actionId: action.id,
      mode: 'TITLE',
    });

    await this.notifications.publish(
      {
        target: {
          type: 'USER',
          externalId: externalUserId,
        },

        text: `📝 Изменить название

  Текущее название:
  ${action.title}

  Отправь новое название дела одним сообщением.`,

        buttons: [
          {
            text: 'Отмена',
            payload: `hod:personal:action:edit-cancel:${action.id}`,
            row: 0,
          },
        ],
      },

      `personal-action-edit-title-${event.callbackId}`,
    );
  }

  async startDescriptionEdit(
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

        `personal-action-edit-description-forbidden-${event.callbackId}`,
      );

      return;
    }

    await this.editSessions.set(externalUserId, {
      actionId: action.id,
      mode: 'DESCRIPTION',
    });

    await this.notifications.publish(
      {
        target: {
          type: 'USER',
          externalId: externalUserId,
        },

        text: `📄 Изменить описание

  Текущее описание:
  ${action.description ?? 'Не указано'}

  Отправь новое описание одним сообщением.`,

        buttons: [
          {
            text: 'Отмена',
            payload: `hod:personal:action:edit-cancel:${action.id}`,
            row: 0,
          },
        ],
      },

      `personal-action-edit-description-${event.callbackId}`,
    );
  }

  async startLocationEdit(
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

        `personal-action-edit-location-forbidden-${event.callbackId}`,
      );

      return;
    }

    await this.editSessions.set(externalUserId, {
      actionId: action.id,
      mode: 'LOCATION',
    });

    await this.notifications.publish(
      {
        target: {
          type: 'USER',
          externalId: externalUserId,
        },

        text: `📍 Изменить место

  Текущее место:
  ${action.location ?? 'Не указано'}

  Отправь новое место одним сообщением.`,

        buttons: [
          {
            text: 'Отмена',
            payload: `hod:personal:action:edit-cancel:${action.id}`,
            row: 0,
          },
        ],
      },

      `personal-action-edit-location-${event.callbackId}`,
    );
  }
}
