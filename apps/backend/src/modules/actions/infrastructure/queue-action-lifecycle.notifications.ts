import type { NotificationPublisher, OutboundNotification } from '../../notifications';
import type {
  ActionLifecycleNotificationPort,
  ActionReminderNotificationPort,
} from '../application/action-context.port';

export class QueueActionLifecycleNotifications implements ActionLifecycleNotificationPort {
  constructor(private readonly notifications: NotificationPublisher) {}

  async publish(input: Parameters<ActionLifecycleNotificationPort['publish']>[0]): Promise<void> {
    if (
      input.context.creatorExternalUserId === input.context.assigneeExternalUserId &&
      (input.command === 'SUBMIT_RESULT' || input.command === 'VERIFY')
    ) {
      return;
    }
    await this.notifications.publish(renderNotification(input), input.idempotencyKey);
    if (
      input.command === 'UNBLOCK' &&
      input.context.creatorExternalUserId !== input.context.assigneeExternalUserId
    ) {
      await this.notifications.publish(
        toAssignee(input.context, `Работа по делу возобновлена\n\n${input.context.title}`, [
          {
            text: '📄 Открыть дело',
            payload: `hod:personal:action:detail:${input.context.actionId}`,
          },
        ]),
        `${input.idempotencyKey}:assignee`,
      );
    }
  }
}

export class QueueActionReminderNotifications implements ActionReminderNotificationPort {
  constructor(private readonly notifications: NotificationPublisher) {}

  publish(input: Parameters<ActionReminderNotificationPort['publish']>[0]): Promise<void> {
    return this.notifications.publish(
      {
        target: { type: 'USER', externalId: input.context.assigneeExternalUserId },
        text: `Напоминание о деле\n\n${input.context.title}`,
        buttons: [
          {
            text: '📄 Открыть дело',
            payload: `hod:personal:action:detail:${input.context.actionId}`,
            row: 0,
          },
          { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 1 },
        ],
      },
      input.idempotencyKey,
    );
  }
}

function renderNotification(
  input: Parameters<ActionLifecycleNotificationPort['publish']>[0],
): OutboundNotification {
  const { context, command, reason } = input;
  switch (command) {
    case 'ACCEPT':
      return toAssignee(context, `Дело принято\n\n${context.title}`, [
        { text: 'Начать', payload: `hod:action:start:${context.actionId}` },
      ]);
    case 'START':
      return toAssignee(context, `Дело в работе\n\n${context.title}`, [
        { text: '📄 Открыть дело', payload: `hod:personal:action:detail:${context.actionId}` },
      ]);
    case 'BLOCK':
      return toCreator(
        context,
        `Дело заблокировано\n\n${context.title}\nПричина: ${reason ?? ''}`,
        [{ text: '📄 Открыть дело', payload: `hod:personal:action:detail:${context.actionId}` }],
      );
    case 'UNBLOCK':
      return toCreator(context, `Работа по делу возобновлена\n\n${context.title}`, [
        { text: '📄 Открыть дело', payload: `hod:personal:action:detail:${context.actionId}` },
      ]);
    case 'SUBMIT_RESULT':
      return {
        target: { type: 'USER', externalId: context.creatorExternalUserId },
        text: `🔎 Дело поступило на проверку\n\n${context.title}\n\nОткрой «Мои дела» → «На проверке».`,
        buttons: [],
        hideMainMenu: true,
      };
    case 'VERIFY':
      return toAssignee(context, `Результат принят ✅\n\n${context.title}`);
    case 'RETURN':
      return toAssignee(
        context,
        `Дело возвращено в работу\n\n${context.title}\nПричина: ${reason ?? ''}`,
        [{ text: '📄 Открыть дело', payload: `hod:personal:action:detail:${context.actionId}` }],
      );
    case 'CANCEL':
      return toAssignee(context, `Дело удалено постановщиком\n\n${context.title}`);
  }
}

function toAssignee(
  context: Parameters<ActionLifecycleNotificationPort['publish']>[0]['context'],
  text: string,
  buttons: OutboundNotification['buttons'] = [],
): OutboundNotification {
  return {
    target: { type: 'USER', externalId: context.assigneeExternalUserId },
    text,
    buttons: [
      ...buttons.map((button, row) => ({ ...button, row })),
      { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: buttons.length },
    ],
  };
}

function toCreator(
  context: Parameters<ActionLifecycleNotificationPort['publish']>[0]['context'],
  text: string,
  buttons: OutboundNotification['buttons'] = [],
): OutboundNotification {
  return {
    target: { type: 'USER', externalId: context.creatorExternalUserId },
    text,
    buttons: [
      ...buttons.map((button, row) => ({ ...button, row })),
      { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: buttons.length },
    ],
  };
}
