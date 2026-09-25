import type { ActionEditPort } from '../../actions';
import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent } from '../../workspaces';
import type {
  PersonalActionEditSession,
  PersonalActionEditSessionStore,
} from './personal-action-edit-session.port';
import type { PersonalWorkspaceContext } from './personal-workspace.port';
import { notificationId, publishPersonalHelp } from './personal-inbox-notification';

export class PersonalActionTextEditMessages {
  constructor(
    private readonly editSessions: PersonalActionEditSessionStore,
    private readonly actionEditor: ActionEditPort,
    private readonly notifications: NotificationPublisher,
  ) {}

  async handle(
    event: Extract<InboundChatEvent, { kind: 'personal.message.created' }>,
    personal: PersonalWorkspaceContext,
    editSession: PersonalActionEditSession,
  ): Promise<void> {
    const externalUserId = event.author.externalUserId;
    const text = event.text?.trim() ?? '';

    if (editSession.mode === 'TITLE') {
      if (!text) {
        await publishPersonalHelp(
          this.notifications,
          externalUserId,
          'Название не может быть пустым. Отправь новое название дела текстом.',
          event.eventId,
        );

        return;
      }

      if (text.length > 200) {
        await publishPersonalHelp(
          this.notifications,
          externalUserId,
          'Название слишком длинное. Давай уложимся в 200 символов.',
          event.eventId,
        );

        return;
      }

      const updated = await this.actionEditor.updateTitle({
        actionId: editSession.actionId,
        actorUserId: personal.userId,
        title: text,
      });

      await this.editSessions.clear(externalUserId);

      if (!updated) {
        await this.notifications.publish(
          {
            target: {
              type: 'USER',
              externalId: externalUserId,
            },

            text: 'Не получилось изменить дело. Возможно, у тебя нет права его редактировать.',

            buttons: [
              {
                text: '📋 Мои дела',
                payload: 'hod:personal:actions',
                row: 0,
              },
            ],
          },

          notificationId('personal-edit-title-failed', event.eventId),
        );

        return;
      }

      await this.notifications.publish(
        {
          target: {
            type: 'USER',
            externalId: externalUserId,
          },

          text: `✅ Название изменено

    ${text}`,

          buttons: [
            {
              text: '📄 Открыть дело',
              payload: `hod:personal:action:detail:${editSession.actionId}`,
              row: 0,
            },
            {
              text: '📋 Мои дела',
              payload: 'hod:personal:actions',
              row: 0,
            },
          ],
        },

        notificationId('personal-edit-title-success', event.eventId),
      );

      return;
    }

    if (editSession.mode === 'DESCRIPTION') {
      if (text.length > 2000) {
        await publishPersonalHelp(
          this.notifications,
          externalUserId,
          'Описание слишком длинное. Давай уложимся в 2000 символов.',
          event.eventId,
        );

        return;
      }

      const updated = await this.actionEditor.updateDescription({
        actionId: editSession.actionId,
        actorUserId: personal.userId,
        description: text || null,
      });

      await this.editSessions.clear(externalUserId);

      if (!updated) {
        await this.notifications.publish(
          {
            target: {
              type: 'USER',
              externalId: externalUserId,
            },

            text: 'Не получилось изменить описание. Возможно, у тебя нет права редактировать это дело.',

            buttons: [
              {
                text: '📋 Мои дела',
                payload: 'hod:personal:actions',
                row: 0,
              },
            ],
          },

          notificationId('personal-edit-description-failed', event.eventId),
        );

        return;
      }

      await this.notifications.publish(
        {
          target: {
            type: 'USER',
            externalId: externalUserId,
          },

          text: text
            ? `✅ Описание изменено

      ${text}`
            : '✅ Описание удалено',

          buttons: [
            {
              text: '📄 Открыть дело',
              payload: `hod:personal:action:detail:${editSession.actionId}`,
              row: 0,
            },
            {
              text: '📋 Мои дела',
              payload: 'hod:personal:actions',
              row: 0,
            },
          ],
        },

        notificationId('personal-edit-description-success', event.eventId),
      );

      return;
    }

    if (editSession.mode === 'LOCATION') {
      if (text.length > 500) {
        await publishPersonalHelp(
          this.notifications,
          externalUserId,
          'Название места слишком длинное. Давай уложимся в 500 символов.',
          event.eventId,
        );

        return;
      }

      const updated = await this.actionEditor.updateLocation({
        actionId: editSession.actionId,
        actorUserId: personal.userId,
        location: text || null,
      });

      await this.editSessions.clear(externalUserId);

      if (!updated) {
        await this.notifications.publish(
          {
            target: {
              type: 'USER',
              externalId: externalUserId,
            },

            text: 'Не получилось изменить место. Возможно, у тебя нет права редактировать это дело.',

            buttons: [
              {
                text: '📋 Мои дела',
                payload: 'hod:personal:actions',
                row: 0,
              },
            ],
          },

          notificationId('personal-edit-location-failed', event.eventId),
        );

        return;
      }

      await this.notifications.publish(
        {
          target: {
            type: 'USER',
            externalId: externalUserId,
          },

          text: text
            ? `✅ Место изменено

      📍 ${text}`
            : '✅ Место удалено',

          buttons: [
            {
              text: '📄 Открыть дело',
              payload: `hod:personal:action:detail:${editSession.actionId}`,
              row: 0,
            },
            {
              text: '📋 Мои дела',
              payload: 'hod:personal:actions',
              row: 0,
            },
          ],
        },

        notificationId('personal-edit-location-success', event.eventId),
      );

      return;
    }
  }
}
