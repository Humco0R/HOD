import type { ActionSummary } from '@hod/contracts';

export function actionCreatorLabel(
  action: Pick<ActionSummary, 'creator'>,
  currentUserId: string,
): string {
  if (action.creator.id === currentUserId) return 'Вы';
  return (
    [action.creator.firstName, action.creator.lastName].filter(Boolean).join(' ').trim() ||
    action.creator.username ||
    'Без имени'
  );
}
