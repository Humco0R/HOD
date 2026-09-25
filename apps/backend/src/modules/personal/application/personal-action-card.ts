import type { ActionDetail, ActionSummary } from '@hod/contracts';

import type { OutboundNotification } from '../../notifications';

export function canEditAction(action: ActionDetail, currentUserId: string): boolean {
  return (
    canDeleteAction(action, currentUserId) &&
    ['NEW', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED'].includes(action.status)
  );
}

export function canDeleteAction(action: ActionDetail, currentUserId: string): boolean {
  return (
    action.creator.id === currentUserId &&
    action.assignee.id === currentUserId &&
    action.status !== 'DONE' &&
    action.status !== 'CANCELLED'
  );
}

export function buildActionButtons(
  action: ActionDetail,
  currentUserId: string,
  listReturn: string | null = null,
): OutboundNotification['buttons'] {
  const buttons: OutboundNotification['buttons'] = [];

  if (action.status === 'NEW' && action.assignee.id === currentUserId) {
    buttons.push({
      text: '✅ Принять',
      payload: `hod:action:accept:${action.id}`,
      row: buttons.length,
    });
  }

  if (action.status === 'ACCEPTED' && action.assignee.id === currentUserId) {
    buttons.push({
      text: '▶️ Начать',
      payload: `hod:action:start:${action.id}`,
      row: buttons.length,
    });
  }

  if (action.status === 'IN_PROGRESS' && action.assignee.id === currentUserId) {
    buttons.push({
      text: '✅ Выполнить',
      payload: `hod:action:submit:${action.id}`,
      row: buttons.length,
    });
  }

  if (action.status === 'BLOCKED' && action.assignee.id === currentUserId) {
    buttons.push({
      text: '▶️ Продолжить работу',
      payload: `hod:action:unblock:${action.id}`,
      row: buttons.length,
    });
  }

  if (action.status === 'DONE' && action.creator.id === currentUserId) {
    buttons.push({
      text: '✅ Подтвердить результат',
      payload: `hod:action:verify:${action.id}`,
      row: buttons.length,
    });
    buttons.push({
      text: '↩️ Вернуть на доработку',
      payload: `hod:action:return:${action.id}`,
      row: buttons.length,
    });
  }

  if (canEditAction(action, currentUserId)) {
    buttons.push({
      text: '✏️ Изменить',
      payload: `hod:personal:action:edit:${action.id}`,
      row: buttons.length,
    });
  } else if (canDeleteAction(action, currentUserId) && action.status === 'VERIFIED') {
    buttons.push({
      text: '🗑 Удалить дело',
      payload: `hod:personal:action:delete:${action.id}`,
      row: buttons.length,
    });
  }

  if (action.attachments.length) {
    buttons.push({
      text: `📎 Материалы (${action.attachments.length})`,
      payload: `hod:personal:materials:${action.id}:0`,
      row: buttons.length,
    });
  }

  buttons.push({
    text: listReturn ? '⬅️ Назад' : '📋 Все дела',
    payload: listReturn ?? 'hod:personal:actions',
    row: buttons.length,
  });

  buttons.push({
    text: '🏠 Главное меню',
    payload: 'hod:personal:menu',
    row: buttons.length,
  });

  return buttons;
}

export function buildReadOnlyActionButtons(
  listReturn: string | null,
): OutboundNotification['buttons'] {
  const buttons: OutboundNotification['buttons'] = [];
  buttons.push({
    text: '⬅️ Назад',
    payload: listReturn ?? 'hod:personal:actions:given',
    row: buttons.length,
  });
  buttons.push({ text: '🏠 Главное меню', payload: 'hod:personal:menu', row: buttons.length });
  return buttons;
}

export function participantLabel(participant: ActionDetail['assignee']): string {
  return (
    [participant.firstName, participant.lastName].filter(Boolean).join(' ').trim() ||
    participant.username ||
    'Без имени'
  );
}

export function formatStatus(status: ActionSummary['status']): string {
  switch (status) {
    case 'NEW':
      return '🆕 Новое';

    case 'ACCEPTED':
      return '✅ Принято';

    case 'IN_PROGRESS':
      return '▶️ В работе';

    case 'BLOCKED':
      return '⛔ Заблокировано';

    case 'DONE':
      return '☑️ Выполнено';

    case 'VERIFIED':
      return '✔️ Завершено';

    case 'CANCELLED':
      return '🗑 Удалено';
  }
}

export function formatDeadline(
  action: Pick<
    ActionSummary,
    'deadlineKind' | 'deadlineAt' | 'deadlineDate' | 'deadlineDependency' | 'deadlineRaw'
  >,
  timezone: string,
): string | null {
  if (action.deadlineAt) {
    return new Date(action.deadlineAt).toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    });
  }

  if (action.deadlineDate) {
    const date = new Date(`${action.deadlineDate}T00:00:00Z`);

    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  if (action.deadlineKind === 'DEPENDENCY' && action.deadlineDependency) {
    return action.deadlineDependency;
  }

  if (action.deadlineRaw) {
    return action.deadlineRaw;
  }

  return null;
}

export function formatExpectedResult(type: ActionSummary['expectedResultType']): string {
  switch (type) {
    case 'TEXT':
      return 'текст';

    case 'PHOTO':
      return 'фото';

    case 'FILE':
      return 'файл';

    case 'NONE':
      return 'не требуется';

    case 'UNKNOWN':
      return 'не указан';
  }
}
