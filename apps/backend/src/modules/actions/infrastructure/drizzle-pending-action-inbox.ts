import { createHash } from 'node:crypto';

import type { ActionDetail, ActionSummary } from '@hod/contracts';
import { eq } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/client';
import { users } from '../../../infrastructure/db/schema';
import type { AssignmentNotificationPort } from '../../detections';
import type { NotificationPublisher, OutboundNotification } from '../../notifications';
import type {
  PendingActionInboxPort,
  PendingActionInboxSessionStore,
  PendingActionInboxViewPort,
} from '../application/pending-action-inbox.port';
import { DrizzleActionReadRepository } from './drizzle-action-read.repository';

const pageSize = 5;
const screenKey = 'pending-actions';
const numberEmoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

export class DrizzlePendingActionInbox
  implements AssignmentNotificationPort, PendingActionInboxPort, PendingActionInboxViewPort
{
  private readonly actions: DrizzleActionReadRepository;

  constructor(
    private readonly database: Database,
    private readonly notifications: NotificationPublisher,
    private readonly sessions: PendingActionInboxSessionStore,
  ) {
    this.actions = new DrizzleActionReadRepository(database);
  }

  publish(input: Parameters<AssignmentNotificationPort['publish']>[0]): Promise<void> {
    return this.showList(input.assigneeExternalUserId, 0, `assignment-${input.actionId}`);
  }

  refresh(assigneeExternalUserId: string, idempotencyKey: string): Promise<void> {
    return this.showList(assigneeExternalUserId, 0, `${idempotencyKey}:pending`);
  }

  isCurrent(assigneeExternalUserId: string, revision: string): Promise<boolean> {
    return this.sessions.isCurrent(assigneeExternalUserId, revision);
  }

  async showList(
    assigneeExternalUserId: string,
    requestedPage: number,
    idempotencyKey: string,
  ): Promise<void> {
    const userId = await this.findUserId(assigneeExternalUserId);
    const pending = userId
      ? (await this.actions.list(userId, 'assigned', new Date())).filter(
          (action) => action.status === 'NEW',
        )
      : [];
    const lastPage = Math.max(0, Math.ceil(pending.length / pageSize) - 1);
    const page = Math.min(Math.max(0, requestedPage), lastPage);
    const revision = revisionFor(idempotencyKey, `list:${page}`);

    await this.notifications.publish(
      renderList(assigneeExternalUserId, pending, page, revision),
      idempotencyKey,
    );
  }

  async showDetail(
    assigneeExternalUserId: string,
    actionId: string,
    page: number,
    idempotencyKey: string,
  ): Promise<void> {
    const userId = await this.findUserId(assigneeExternalUserId);
    const action = userId ? await this.actions.getDetail(userId, actionId, new Date()) : null;
    if (!action || action.assignee.id !== userId || action.status !== 'NEW') {
      await this.showList(assigneeExternalUserId, page, `${idempotencyKey}:changed`);
      return;
    }

    const revision = revisionFor(idempotencyKey, `detail:${actionId}`);
    await this.notifications.publish(
      renderDetail(assigneeExternalUserId, action, page, revision),
      idempotencyKey,
    );
  }

  private async findUserId(externalUserId: string): Promise<string | null> {
    const rows = await this.database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.maxUserId, BigInt(externalUserId)))
      .limit(1);
    return rows[0]?.id ?? null;
  }
}

function renderList(
  externalUserId: string,
  pending: ActionSummary[],
  page: number,
  revision: string,
): OutboundNotification {
  const first = page * pageSize;
  const visible = pending.slice(first, first + pageSize);
  const lastPage = Math.max(0, Math.ceil(pending.length / pageSize) - 1);
  const buttons: OutboundNotification['buttons'] = visible.map((action, index) => ({
    text: `${numberEmoji[index]} ${compact(action.title, 34)}`,
    payload: `hod:personal:pending:detail:${action.id}:${page}:${revision}`,
    row: index,
  }));

  if (page > 0) {
    buttons.push({
      text: '⬅️ Предыдущие',
      payload: `hod:personal:pending:list:${page - 1}:${revision}`,
      row: 5,
    });
  }
  if (page < lastPage) {
    buttons.push({
      text: '➡️ Ещё',
      payload: `hod:personal:pending:list:${page + 1}:${revision}`,
      row: 5,
    });
  }
  buttons.push({ text: '📥 Все полученные', payload: 'hod:personal:actions:received', row: 6 });
  buttons.push({ text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 7 });

  const heading =
    pending.length === 0
      ? '✅ Непринятых дел больше нет.'
      : pending.length === 1
        ? '📥 У вас одно непринятое дело'
        : `📥 У вас ${pending.length} непринятых ${pluralizeCases(pending.length)}`;
  const range =
    pending.length > pageSize ? `\nПоказаны ${first + 1}–${first + visible.length}` : '';
  const lines = visible.map(
    (action, index) =>
      `${first + index + 1}. ${compact(action.title, 90)}\n   От: ${participantLabel(action.creator)} · ${sourceLabel(action)}`,
  );

  return {
    target: { type: 'USER', externalId: externalUserId },
    text: [heading + range, ...lines].join('\n\n'),
    buttons,
    screen: { key: screenKey, replacePrevious: true, revision },
  };
}

function renderDetail(
  externalUserId: string,
  action: ActionDetail,
  page: number,
  revision: string,
): OutboundNotification {
  const lines = [
    `📄 ${action.title}`,
    '',
    `Постановщик: ${participantLabel(action.creator)}`,
    `Источник: ${sourceLabel(action)}`,
  ];
  if (action.description) lines.push('', 'Описание:', action.description);
  const deadline = action.deadlineAt ?? action.deadlineDate ?? action.deadlineRaw;
  if (deadline) lines.push('', `📅 Срок: ${deadline}`);
  if (action.sourceContext.length) {
    lines.push(
      '',
      '💬 Контекст:',
      ...action.sourceContext
        .slice(-3)
        .map((message) => compact(message.text ?? 'Сообщение без текста', 350)),
    );
  }

  return {
    target: { type: 'USER', externalId: externalUserId },
    text: lines.join('\n'),
    buttons: [
      {
        text: '✅ Принять',
        payload: `hod:action:accept:${action.id}:${revision}`,
        row: 0,
      },
      {
        text: '❌ Отклонить',
        payload: `hod:action:reject:${action.id}:${revision}`,
        row: 1,
      },
      {
        text: '⬅️ К непринятым',
        payload: `hod:personal:pending:list:${page}:${revision}`,
        row: 2,
      },
      { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 3 },
    ],
    screen: { key: screenKey, replacePrevious: true, revision },
  };
}

function revisionFor(idempotencyKey: string, view: string): string {
  return createHash('sha256').update(`${idempotencyKey}:${view}`).digest('hex').slice(0, 16);
}

function participantLabel(participant: ActionSummary['creator']): string {
  return (
    [participant.firstName, participant.lastName].filter(Boolean).join(' ').trim() ||
    participant.username ||
    'Без имени'
  );
}

function sourceLabel(action: ActionSummary): string {
  if (action.sourceChat.context === 'DIALOG') return 'личный чат';
  return action.sourceChat.title?.trim() || 'беседа без названия';
}

function compact(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
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
