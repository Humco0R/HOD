import type { OutboundNotification } from '../../notifications';
import type { PersonalActionCreateSession } from './personal-action-create-session.port';

export function personalCreatePrompt(
  externalUserId: string,
  session: PersonalActionCreateSession,
  notice?: string,
): OutboundNotification {
  const payload = (operation: string) => `hod:personal:create:${operation}:${session.id}`;
  const back = { text: '⬅️ Назад', payload: payload('back'), row: 4 };
  const menu = { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 5 };
  const frame = (text: string, buttons: OutboundNotification['buttons']): OutboundNotification => ({
    target: { type: 'USER', externalId: externalUserId },
    text: notice ? `${notice}\n\n${text}` : text,
    buttons: [...buttons, back, menu],
  });

  switch (session.step) {
    case 'TITLE':
      return frame(
        `➕ Новое дело — название\n\nОтправь название одним сообщением.${session.title ? `\n\nСейчас: ${session.title}` : ''}`,
        [],
      );
    case 'DESCRIPTION':
      return frame(
        `📄 Описание\n\nОтправь описание одним сообщением или пропусти.${session.description ? `\n\nСейчас: ${session.description}` : ''}`,
        [{ text: '⏭ Пропустить', payload: payload('skip-description'), row: 0 }],
      );
    case 'DEADLINE':
      return frame(`📅 Срок\n\nВыбери, как указать срок:`, [
        { text: '📆 Дата', payload: payload('date'), row: 0 },
        { text: '🕒 Дата и время', payload: payload('datetime'), row: 1 },
        { text: '⏭ Без срока', payload: payload('no-deadline'), row: 2 },
      ]);
    case 'DEADLINE_DATE':
      return frame(
        `📆 Отправь дату в формате ДД.ММ.ГГГГ.${session.deadlineRaw ? `\n\nСейчас: ${session.deadlineRaw}` : ''}`,
        [],
      );
    case 'DEADLINE_DATETIME':
      return frame(
        `🕒 Отправь дату и время в формате ДД.ММ.ГГГГ ЧЧ:ММ.${session.deadlineRaw ? `\n\nСейчас: ${session.deadlineRaw}` : ''}`,
        [],
      );
    case 'REVIEW':
      return frame(
        `Проверь дело перед созданием:\n\nНазвание: ${session.title}\nОписание: ${session.description ?? 'Нет'}\nСрок: ${session.deadlineRaw ?? 'Не указан'}\nИсполнитель: ты`,
        [
          { text: '✅ Создать дело', payload: payload('confirm'), row: 0 },
          { text: '✏️ Изменить', payload: payload('edit'), row: 1 },
        ],
      );
    case 'EDIT':
      return frame('Что изменить?', [
        { text: '📝 Название', payload: payload('field-title'), row: 0 },
        { text: '📄 Описание', payload: payload('field-description'), row: 1 },
        { text: '📅 Срок', payload: payload('field-deadline'), row: 2 },
      ]);
  }
}
