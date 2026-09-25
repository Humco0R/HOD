import type { ActionSummary } from '@hod/contracts';

import type { ActionReadPort } from '../../actions';
import type { NotificationPublisher, OutboundNotification } from '../../notifications';
import type { InboundChatEvent, InboundChatEventHandler } from '../../workspaces';
import { actionCreatorLabel } from './personal-action-creator';
import type { PersonalWorkspaceStore } from './personal-workspace.port';

type PersonalListCategory = 'active' | 'today' | 'overdue' | 'completed' | 'review';
type PersonalListView = 'received' | 'given' | 'review';
const pageSize = 5;
const viewPattern = /^hod:personal:actions:(received|given)$/;
const reviewPattern = /^hod:personal:actions:review:(\d{1,4})$/;
const listPattern =
  /^hod:personal:actions:(received|given):(active|today|overdue|completed):(\d{1,4})$/;
const legacyListPattern = /^hod:personal:actions:(active|today|overdue|completed):(\d{1,4})$/;
const categoryLabels: Record<PersonalListCategory, string> = {
  active: '🔥 Активные',
  today: '📅 На сегодня',
  overdue: '⚠️ Просроченные',
  completed: '✅ Выполненные',
  review: '🔎 На проверке',
};
const listCategories = ['active', 'today', 'overdue', 'completed'] as const;
const numberEmoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

export class HandlePersonalActionListUseCase implements InboundChatEventHandler {
  constructor(
    private readonly workspaces: PersonalWorkspaceStore,
    private readonly actions: ActionReadPort,
    private readonly notifications: NotificationPublisher,
  ) {}

  async handle(event: InboundChatEvent): Promise<void> {
    if (event.kind !== 'message.callback' || !event.payload) return;
    const isViewMenu = event.payload === 'hod:personal:actions';
    const viewMatch = viewPattern.exec(event.payload);
    const reviewMatch = reviewPattern.exec(event.payload);
    const listMatch = listPattern.exec(event.payload);
    const legacyListMatch = legacyListPattern.exec(event.payload);
    if (!isViewMenu && !viewMatch && !reviewMatch && !listMatch && !legacyListMatch) return;

    const externalUserId = event.actor.externalUserId;
    const personal = await this.workspaces.findByExternalUserId(externalUserId);
    if (!personal) {
      await this.notifications.publish(
        {
          target: { type: 'USER', externalId: externalUserId },
          text: 'Сначала нажми «Начать» в профиле бота.',
          buttons: [],
        },
        `personal-actions-no-workspace-${event.callbackId}`,
      );
      return;
    }

    if (isViewMenu) {
      const created = await this.actions.list(personal.userId, 'created', new Date());
      const reviewCount = reviewActions(created, personal.userId).length;
      await this.notifications.publish(
        viewMenu(externalUserId, reviewCount),
        `personal-actions-${event.callbackId}`,
      );
      return;
    }

    if (reviewMatch) {
      const created = await this.actions.list(personal.userId, 'created', new Date());
      await this.notifications.publish(
        actionPage(
          externalUserId,
          reviewActions(created, personal.userId),
          'review',
          'review',
          Number(reviewMatch[1]),
          personal.timezone,
          personal.userId,
        ),
        `personal-actions-${event.callbackId}`,
      );
      return;
    }

    const view: PersonalListView =
      viewMatch?.[1] === 'given' || listMatch?.[1] === 'given' ? 'given' : 'received';
    const actions = await this.actions.list(
      personal.userId,
      view === 'received' ? 'assigned' : 'created',
      new Date(),
    );
    const visibleActions =
      view === 'given'
        ? actions.filter((action) => action.assignee.id !== personal.userId)
        : actions;
    const notification = viewMatch
      ? categoryMenu(externalUserId, visibleActions, view)
      : actionPage(
          externalUserId,
          visibleActions,
          view,
          (listMatch?.[2] ?? legacyListMatch?.[1]) as PersonalListCategory,
          Number(listMatch?.[3] ?? legacyListMatch?.[2]),
          personal.timezone,
          personal.userId,
        );
    await this.notifications.publish(notification, `personal-actions-${event.callbackId}`);
  }
}

function viewMenu(externalUserId: string, reviewCount: number): OutboundNotification {
  return {
    target: { type: 'USER', externalId: externalUserId },
    text: '📋 Мои дела\n\nКакой список открыть?',
    buttons: [
      { text: '📥 Полученные', payload: 'hod:personal:actions:received', row: 0 },
      { text: '📤 Заданные', payload: 'hod:personal:actions:given', row: 1 },
      { text: `🔎 На проверке · ${reviewCount}`, payload: 'hod:personal:actions:review:0', row: 2 },
      { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 3 },
    ],
  };
}

function categoryMenu(
  externalUserId: string,
  actions: ActionSummary[],
  view: PersonalListView,
): OutboundNotification {
  const categories = listCategories;
  return {
    target: { type: 'USER', externalId: externalUserId },
    text: `${view === 'received' ? '📥 Полученные' : '📤 Заданные'}\n\nВыбери категорию:`,
    buttons: [
      ...categories.map((category, row) => ({
        text: `${categoryLabels[category]} · ${filterActions(actions, category).length}`,
        payload: listPayload(view, category, 0),
        row,
      })),
      { text: '⬅️ Назад', payload: 'hod:personal:actions', row: 4 },
      { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 5 },
    ],
  };
}

function actionPage(
  externalUserId: string,
  actions: ActionSummary[],
  view: PersonalListView,
  category: PersonalListCategory,
  requestedPage: number,
  timezone: string,
  currentUserId: string,
): OutboundNotification {
  const filtered = filterActions(actions, category);
  const sorted =
    category === 'completed' || category === 'review' ? filtered : sortByDeadline(filtered);
  const lastPage = Math.max(0, Math.ceil(sorted.length / pageSize) - 1);
  const page = Math.min(requestedPage, lastPage);
  const first = page * pageSize;
  const visible = sorted.slice(first, first + pageSize);
  const buttons: OutboundNotification['buttons'] = visible.map((action, index) => ({
    text: `${numberEmoji[index]} ${compactTitle(action.title, 30)}`,
    payload:
      view === 'review'
        ? `hod:personal:action:review:${action.id}:${page}`
        : `hod:personal:action:detail:${action.id}:${view}:${category}:${page}`,
    row: index,
  }));
  if (page > 0) {
    buttons.push({
      text: '⬅️ Предыдущие',
      payload: listPayload(view, category, page - 1),
      row: 5,
    });
  }
  if (page < lastPage) {
    buttons.push({
      text: '➡️ Ещё',
      payload: listPayload(view, category, page + 1),
      row: 5,
    });
  }
  buttons.push({
    text: '⬅️ Назад',
    payload: view === 'review' ? 'hod:personal:actions' : `hod:personal:actions:${view}`,
    row: 6,
  });
  buttons.push({ text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 7 });

  const heading = `${categoryLabels[category]} · ${sorted.length} ${pluralizeCases(sorted.length)}`;
  const range = sorted.length ? `\nПоказаны ${first + 1}–${first + visible.length}` : '';
  const lines = visible.map((action, index) => {
    const deadline = formatDeadline(action, timezone);
    const status = formatStatus(action.status);
    const participant =
      view === 'received'
        ? `От: ${actionCreatorLabel(action, currentUserId)}`
        : `Кому: ${participantLabel(action.assignee)}`;
    return `${first + index + 1}. ${compactTitle(action.title, 85)}\n   ${participant}\n   ${status}${deadline ? ` · до ${deadline}` : ''}`;
  });
  return {
    target: { type: 'USER', externalId: externalUserId },
    text:
      [heading + range, ...lines].join('\n\n') + (sorted.length ? '' : '\n\nЗдесь пока нет дел.'),
    buttons,
  };
}

function filterActions(actions: ActionSummary[], category: PersonalListCategory): ActionSummary[] {
  return actions.filter((action) => {
    if (action.status === 'CANCELLED') return false;
    switch (category) {
      case 'active':
        return action.status !== 'DONE' && action.status !== 'VERIFIED';
      case 'today':
        return action.attentionReasons.includes('DUE_TODAY');
      case 'overdue':
        return action.attentionReasons.includes('OVERDUE');
      case 'completed':
        return action.status === 'DONE' || action.status === 'VERIFIED';
      case 'review':
        return action.status === 'DONE';
    }
  });
}

function sortByDeadline(actions: ActionSummary[]): ActionSummary[] {
  return [...actions].sort((a, b) => {
    const aDeadline = a.deadlineAt ?? a.deadlineDate ?? '9999';
    const bDeadline = b.deadlineAt ?? b.deadlineDate ?? '9999';
    return aDeadline.localeCompare(bDeadline) || b.updatedAt.localeCompare(a.updatedAt);
  });
}

function formatDeadline(action: ActionSummary, timezone: string): string | null {
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
    return new Date(`${action.deadlineDate}T00:00:00Z`).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
  return action.deadlineRaw ?? action.deadlineDependency;
}

function formatStatus(status: ActionSummary['status']): string {
  const labels: Record<ActionSummary['status'], string> = {
    NEW: 'Новое',
    ACCEPTED: 'Принято',
    IN_PROGRESS: 'В работе',
    BLOCKED: 'Заблокировано',
    DONE: 'На проверке',
    VERIFIED: 'Завершено',
    CANCELLED: 'Удалено',
  };
  return labels[status];
}

function compactTitle(title: string, maxLength: number): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  const characters = Array.from(clean);
  return characters.length > maxLength ? `${characters.slice(0, maxLength - 1).join('')}…` : clean;
}

function pluralizeCases(count: number): string {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return 'дел';
  const last = count % 10;
  if (last === 1) return 'дело';
  return last >= 2 && last <= 4 ? 'дела' : 'дел';
}

function participantLabel(participant: ActionSummary['assignee']): string {
  return (
    [participant.firstName, participant.lastName].filter(Boolean).join(' ').trim() ||
    participant.username ||
    'Без имени'
  );
}

function listPayload(view: PersonalListView, category: PersonalListCategory, page: number): string {
  return view === 'review'
    ? `hod:personal:actions:review:${page}`
    : `hod:personal:actions:${view}:${category}:${page}`;
}

function reviewActions(actions: ActionSummary[], currentUserId: string): ActionSummary[] {
  return actions.filter(
    (action) => action.creator.id === currentUserId && action.status === 'DONE',
  );
}
