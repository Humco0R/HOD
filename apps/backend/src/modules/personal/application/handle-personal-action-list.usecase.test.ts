import { randomUUID } from 'node:crypto';

import type { ActionSummary } from '@hod/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ActionReadPort } from '../../actions';
import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent } from '../../workspaces';
import { HandlePersonalActionListUseCase } from './handle-personal-action-list.usecase';
import type { PersonalWorkspaceStore } from './personal-workspace.port';

describe('HandlePersonalActionListUseCase', () => {
  it('separates received and given tasks before showing categories', async () => {
    const awaitingReview = summary(4, 'DONE', ['AWAITING_VERIFICATION']);
    awaitingReview.assignee = {
      id: '33333333-3333-4333-8333-333333333333',
      firstName: 'Анна',
      lastName: null,
      username: null,
    };
    const harness = createHarness([
      summary(1, 'NEW', ['DUE_TODAY']),
      summary(2, 'IN_PROGRESS', ['OVERDUE']),
      summary(3, 'BLOCKED'),
      awaitingReview,
      summary(5, 'VERIFIED'),
      summary(6, 'CANCELLED'),
    ]);

    await harness.useCase.handle(callback('hod:personal:actions'));

    expect(harness.publish).toHaveBeenCalledOnce();
    expect(harness.lastNotification().buttons).toEqual([
      { text: '📥 Полученные', payload: 'hod:personal:actions:received', row: 0 },
      { text: '📤 Заданные', payload: 'hod:personal:actions:given', row: 1 },
      { text: '🔎 На проверке · 1', payload: 'hod:personal:actions:review:0', row: 2 },
      { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 3 },
    ]);
    expect(harness.list).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      'created',
      expect.any(Date),
    );

    await harness.useCase.handle(callback('hod:personal:actions:received'));
    expect(harness.list).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      'assigned',
      expect.any(Date),
    );
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '🔥 Активные · 3',
      payload: 'hod:personal:actions:received:active:0',
      row: 0,
    });
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '📅 На сегодня · 1',
      payload: 'hod:personal:actions:received:today:0',
      row: 1,
    });
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '⚠️ Просроченные · 1',
      payload: 'hod:personal:actions:received:overdue:0',
      row: 2,
    });
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '✅ Выполненные · 2',
      payload: 'hod:personal:actions:received:completed:0',
      row: 3,
    });
  });

  it('shows five compact items per page with next, previous and return buttons', async () => {
    const actions = Array.from({ length: 12 }, (_, index) =>
      summary(
        index + 1,
        'NEW',
        [],
        new Date(Date.UTC(2026, 8, 24 + index)).toISOString().slice(0, 10),
      ),
    );
    const harness = createHarness(actions);

    await harness.useCase.handle(callback('hod:personal:actions:received:active:0'));
    expect(harness.publish).toHaveBeenCalledOnce();
    expect(harness.lastNotification().text).toContain('Показаны 1–5');
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '➡️ Ещё',
      payload: 'hod:personal:actions:received:active:1',
      row: 5,
    });
    expect(
      harness.lastNotification().buttons.filter((button) => button.payload?.includes(':detail:')),
    ).toHaveLength(5);

    await harness.useCase.handle(callback('hod:personal:actions:received:active:2'));
    expect(harness.lastNotification().text).toContain('Показаны 11–12');
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '⬅️ Предыдущие',
      payload: 'hod:personal:actions:received:active:1',
      row: 5,
    });
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '⬅️ Назад',
      payload: 'hod:personal:actions:received',
      row: 6,
    });
    expect(harness.lastNotification().buttons.some((button) => button.text === '➡️ Ещё')).toBe(
      false,
    );
  });

  it('shows only overdue items in that category and keeps a path out of an empty list', async () => {
    const harness = createHarness([
      summary(1, 'NEW', ['DUE_TODAY']),
      summary(2, 'IN_PROGRESS', ['OVERDUE']),
      summary(3, 'VERIFIED'),
    ]);

    await harness.useCase.handle(callback('hod:personal:actions:received:overdue:0'));
    expect(harness.lastNotification().text).toContain('Дело 2');
    expect(harness.lastNotification().text).not.toContain('Дело 1');

    await harness.useCase.handle(callback('hod:personal:actions:received:completed:0'));
    expect(harness.lastNotification().text).toContain('Дело 3');

    const empty = createHarness([]);
    await empty.useCase.handle(callback('hod:personal:actions:received:active:0'));
    expect(empty.lastNotification().text).toContain('Здесь пока нет дел');
    expect(empty.lastNotification().buttons).toContainEqual({
      text: '🏠 Главное меню',
      payload: 'hod:personal:menu',
      row: 7,
    });
  });

  it('shows who assigned each task', async () => {
    const assigned = summary(1, 'NEW');
    assigned.creator = {
      id: '33333333-3333-4333-8333-333333333333',
      firstName: 'Анна',
      lastName: 'Соколова',
      username: null,
    };
    const harness = createHarness([assigned]);
    await harness.useCase.handle(callback('hod:personal:actions:received:active:0'));
    expect(harness.lastNotification().text).toContain('От: Анна Соколова');
  });

  it('opens an older received-task button after the menu changes', async () => {
    const harness = createHarness([summary(1, 'NEW')]);

    await harness.useCase.handle(callback('hod:personal:actions:active:0'));

    expect(harness.lastNotification().text).toContain('Дело 1');
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '⬅️ Назад',
      payload: 'hod:personal:actions:received',
      row: 6,
    });
  });

  it('shows delegated tasks with their assignee and excludes tasks assigned to self', async () => {
    const delegated = summary(1, 'IN_PROGRESS');
    delegated.assignee = {
      id: '33333333-3333-4333-8333-333333333333',
      firstName: 'Анна',
      lastName: 'Соколова',
      username: null,
    };
    const harness = createHarness([delegated, summary(2, 'NEW')]);

    await harness.useCase.handle(callback('hod:personal:actions:given:active:0'));

    expect(harness.list).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      'created',
      expect.any(Date),
    );
    expect(harness.lastNotification().text).toContain('Кому: Анна Соколова');
    expect(harness.lastNotification().text).not.toContain('Дело 2');
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '1️⃣ Дело 1',
      payload: `hod:personal:action:detail:${delegated.id}:given:active:0`,
      row: 0,
    });
  });

  it('keeps only the creator’s pending results in a paged review list and updates the count', async () => {
    const pending = Array.from({ length: 6 }, (_, index) => summary(index + 1, 'DONE'));
    for (const action of pending) {
      action.assignee = {
        id: '33333333-3333-4333-8333-333333333333',
        firstName: 'Анна',
        lastName: null,
        username: null,
      };
    }
    const anotherCreator = summary(7, 'DONE');
    anotherCreator.creator = {
      id: '33333333-3333-4333-8333-333333333333',
      firstName: 'Анна',
      lastName: null,
      username: null,
    };
    const rows = [...pending, anotherCreator, summary(8, 'VERIFIED')];
    const harness = createHarness(rows);

    await harness.useCase.handle(callback('hod:personal:actions'));
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '🔎 На проверке · 6',
      payload: 'hod:personal:actions:review:0',
      row: 2,
    });

    await harness.useCase.handle(callback('hod:personal:actions:review:0'));
    expect(harness.lastNotification().text).toContain('На проверке · 6 дел');
    expect(harness.lastNotification().text).not.toContain('Дело 7');
    expect(harness.lastNotification().text).not.toContain('Дело 8');
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '1️⃣ Дело 1',
      payload: `hod:personal:action:review:${pending[0]!.id}:0`,
      row: 0,
    });
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '➡️ Ещё',
      payload: 'hod:personal:actions:review:1',
      row: 5,
    });

    await harness.useCase.handle(callback('hod:personal:actions:review:1'));
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '1️⃣ Дело 6',
      payload: `hod:personal:action:review:${pending[5]!.id}:1`,
      row: 0,
    });
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '⬅️ Предыдущие',
      payload: 'hod:personal:actions:review:0',
      row: 5,
    });

    pending[0]!.status = 'VERIFIED';
    await harness.useCase.handle(callback('hod:personal:actions'));
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '🔎 На проверке · 5',
      payload: 'hod:personal:actions:review:0',
      row: 2,
    });
  });
});

function createHarness(rows: ActionSummary[]) {
  const workspaces: PersonalWorkspaceStore = {
    bootstrap: vi.fn(),
    findByExternalUserId: vi.fn(() =>
      Promise.resolve({
        workspaceId: randomUUID(),
        chatId: randomUUID(),
        userId: '22222222-2222-4222-8222-222222222222',
        timezone: 'Asia/Krasnoyarsk',
      }),
    ),
  };
  const list = vi.fn<ActionReadPort['list']>(() => Promise.resolve(rows));
  const actions: ActionReadPort = {
    getCurrentUser: vi.fn(),
    list,
    getDetail: vi.fn(),
  };
  const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
  return {
    useCase: new HandlePersonalActionListUseCase(workspaces, actions, { publish }),
    publish,
    list,
    lastNotification: () => publish.mock.lastCall![0],
  };
}

function callback(payload: string): Extract<InboundChatEvent, { kind: 'message.callback' }> {
  const id = randomUUID();
  return {
    kind: 'message.callback',
    eventId: `callback:${id}`,
    occurredAt: new Date('2026-09-23T08:00:00.000Z'),
    externalChatId: null,
    externalMessageId: 'message-1',
    actor: { externalUserId: '42', firstName: 'Иван', lastName: null, username: null },
    payload,
    callbackId: id,
  };
}

function summary(
  index: number,
  status: ActionSummary['status'],
  attentionReasons: ActionSummary['attentionReasons'] = [],
  deadlineDate: string | null = null,
): ActionSummary {
  const participant = {
    id: '22222222-2222-4222-8222-222222222222',
    firstName: 'Иван',
    lastName: null,
    username: null,
  };
  return {
    id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    title: `Дело ${index}`,
    status,
    deadlineKind: deadlineDate ? 'DATE_ONLY' : 'UNKNOWN',
    deadlineAt: null,
    deadlineDate,
    deadlineDependency: null,
    deadlineRaw: null,
    location: null,
    expectedResultType: 'NONE',
    expectedResultText: null,
    creator: participant,
    assignee: participant,
    attentionReasons,
    updatedAt: '2026-09-23T08:00:00.000Z',
  };
}
