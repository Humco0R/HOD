import type { ActionEditPort } from '../../actions';
import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent } from '../../workspaces';
import type {
  PersonalActionEditSession,
  PersonalActionEditSessionStore,
} from './personal-action-edit-session.port';
import type { PersonalWorkspaceContext } from './personal-workspace.port';
import { notificationId, publishPersonalHelp } from './personal-inbox-notification';
import { localDateInTimeZone, localDateTimeToUtc } from './local-date-time';

export class PersonalActionDeadlineEditMessages {
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

    if (editSession.mode === 'DEADLINE_DATE') {
      const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);

      if (!match) {
        await publishPersonalHelp(
          this.notifications,
          externalUserId,
          'Неверный формат. Отправь дату в формате ДД.ММ.ГГГГ, например 25.09.2026.',
          event.eventId,
        );

        return;
      }

      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = Number(match[3]);

      const date = new Date(Date.UTC(year, month - 1, day));

      const isValid =
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day;

      if (!isValid) {
        await publishPersonalHelp(
          this.notifications,
          externalUserId,
          'Такой даты не существует. Проверь день, месяц и год.',
          event.eventId,
        );

        return;
      }

      const deadlineDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      if (deadlineDate < localDateInTimeZone(event.occurredAt, personal.timezone)) {
        await publishPersonalHelp(
          this.notifications,
          externalUserId,
          'Нельзя установить срок раньше сегодняшнего дня. Введи сегодняшнюю или будущую дату.',
          event.eventId,
        );

        return;
      }

      const updated = await this.actionEditor.updateDeadline({
        actionId: editSession.actionId,
        actorUserId: personal.userId,
        deadlineKind: 'DATE_ONLY',
        deadlineAt: null,
        deadlineDate,
        deadlineDependency: null,
        deadlineRaw: text,
      });

      if (!updated) {
        await this.notifications.publish(
          {
            target: {
              type: 'USER',
              externalId: externalUserId,
            },

            text: 'Не получилось изменить срок.',

            buttons: [
              {
                text: '📋 Мои дела',
                payload: 'hod:personal:actions',
                row: 0,
              },
            ],
          },

          notificationId('personal-edit-deadline-date-failed', event.eventId),
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

          text: `✅ Срок изменён

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

        notificationId('personal-edit-deadline-date-success', event.eventId),
      );

      return;
    }

    if (editSession.mode === 'DEADLINE_DATETIME') {
      const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/.exec(text);

      if (!match) {
        await publishPersonalHelp(
          this.notifications,
          externalUserId,
          'Неверный формат. Отправь дату и время в формате ДД.ММ.ГГГГ ЧЧ:ММ, например 25.09.2026 18:30.',
          event.eventId,
        );

        return;
      }

      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = Number(match[3]);
      const hours = Number(match[4]);
      const minutes = Number(match[5]);

      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        await publishPersonalHelp(
          this.notifications,
          externalUserId,
          'Некорректное время. Часы должны быть от 00 до 23, минуты — от 00 до 59.',
          event.eventId,
        );

        return;
      }

      const date = localDateTimeToUtc({ year, month, day, hours, minutes }, personal.timezone);

      if (!date) {
        await publishPersonalHelp(
          this.notifications,
          externalUserId,
          'Таких даты и времени не существует. Проверь введённое значение.',
          event.eventId,
        );

        return;
      }

      if (date <= event.occurredAt) {
        await publishPersonalHelp(
          this.notifications,
          externalUserId,
          'Нельзя установить срок в прошлом. Введи будущие дату и время.',
          event.eventId,
        );

        return;
      }

      const updated = await this.actionEditor.updateDeadline({
        actionId: editSession.actionId,
        actorUserId: personal.userId,
        deadlineKind: 'EXACT_DATETIME',
        deadlineAt: date,
        deadlineDate: null,
        deadlineDependency: null,
        deadlineRaw: text,
      });

      if (!updated) {
        await this.notifications.publish(
          {
            target: {
              type: 'USER',
              externalId: externalUserId,
            },

            text: 'Не получилось изменить срок.',

            buttons: [
              {
                text: '📋 Мои дела',
                payload: 'hod:personal:actions',
                row: 0,
              },
            ],
          },

          notificationId('personal-edit-deadline-datetime-failed', event.eventId),
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

          text: `✅ Срок изменён

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

        notificationId('personal-edit-deadline-datetime-success', event.eventId),
      );

      return;
    }
  }
}
