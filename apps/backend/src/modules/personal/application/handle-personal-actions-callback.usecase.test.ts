import type { ActionDetail } from '@hod/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ActionContextStore, ActionEditPort, ActionReadPort } from '../../actions';
import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent } from '../../workspaces';
import { HandlePersonalActionsCallbackUseCase } from './handle-personal-actions-callback.usecase';
import type { PersonalActionEditSessionStore } from './personal-action-edit-session.port';
import type { PersonalWorkspaceStore } from './personal-workspace.port';

const actionId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

describe('HandlePersonalActionsCallbackUseCase', () => {
  it('opens help and returns to the main menu through buttons', async () => {
    const harness = createHarness();

    await harness.useCase.handle(callbackEvent('hod:personal:help'));
    expect(harness.publish.mock.calls[0]?.[0].text).toContain('Создать дело');
    expect(harness.publish.mock.calls[0]?.[0].buttons).toContainEqual({
      text: '🏠 Главное меню',
      payload: 'hod:personal:menu',
      row: 0,
    });

    await harness.useCase.handle(callbackEvent('hod:personal:menu'));
    expect(harness.clearEditSession).toHaveBeenCalledWith('42');
    expect(harness.publish.mock.calls[1]?.[0].buttons).toContainEqual({
      text: '📋 Мои дела',
      payload: 'hod:personal:actions',
      row: 1,
    });
  });

  it('starts title editing when the title button is pressed', async () => {
    const harness = createHarness();

    await harness.useCase.handle(callbackEvent(`hod:personal:action:edit-title:${actionId}`));

    expect(harness.setEditSession).toHaveBeenCalledWith('42', {
      actionId,
      mode: 'TITLE',
    });
    expect(harness.publish).toHaveBeenCalledOnce();
    expect(harness.publish.mock.calls[0]?.[0].target).toEqual({
      type: 'USER',
      externalId: '42',
    });
    expect(harness.publish.mock.calls[0]?.[0].text).toContain('Отправь новое название');
    expect(harness.publish.mock.calls[0]?.[1]).toBe('personal-action-edit-title-callback-1');
  });

  it.each([
    ['edit-description', 'DESCRIPTION'],
    ['edit-location', 'LOCATION'],
    ['edit-deadline-date', 'DEADLINE_DATE'],
    ['edit-deadline-datetime', 'DEADLINE_DATETIME'],
  ] as const)('starts %s editing through the delegated callback', async (operation, mode) => {
    const harness = createHarness();

    await harness.useCase.handle(callbackEvent(`hod:personal:action:${operation}:${actionId}`));

    expect(harness.setEditSession).toHaveBeenCalledWith('42', { actionId, mode });
  });

  it('clears title editing when cancel is pressed', async () => {
    const harness = createHarness();

    await harness.useCase.handle(callbackEvent(`hod:personal:action:edit-cancel:${actionId}`));

    expect(harness.clearEditSession).toHaveBeenCalledWith('42');
  });

  it('renders an exact deadline in the personal workspace timezone', async () => {
    const harness = createHarness();
    harness.getDetail.mockResolvedValue({
      ...actionDetail(),
      deadlineKind: 'EXACT_DATETIME',
      deadlineAt: '2026-09-25T11:30:00.000Z',
    });

    await harness.useCase.handle(callbackEvent(`hod:personal:action:detail:${actionId}`));

    expect(harness.publish.mock.calls[0]?.[0].text).toContain('18:30');
  });

  it('shows the creator on the task card', async () => {
    const harness = createHarness();
    harness.getDetail.mockResolvedValue({
      ...actionDetail(),
      creator: {
        id: '33333333-3333-4333-8333-333333333333',
        firstName: 'Анна',
        lastName: 'Соколова',
        username: null,
      },
    });
    await harness.useCase.handle(callbackEvent(`hod:personal:action:detail:${actionId}`));
    expect(harness.publish.mock.lastCall?.[0].text).toContain('Постановщик: Анна Соколова');
  });

  it('returns from a selected action to the same list page', async () => {
    const harness = createHarness();

    await harness.useCase.handle(
      callbackEvent(`hod:personal:action:detail:${actionId}:received:active:2`),
    );

    expect(harness.publish.mock.calls[0]?.[0].buttons).toContainEqual({
      text: '⬅️ Назад',
      payload: 'hod:personal:actions:received:active:2',
      row: 2,
    });
  });

  it('opens a given task for viewing without edit or lifecycle buttons', async () => {
    const harness = createHarness();
    harness.getDetail.mockResolvedValue({
      ...actionDetail(),
      status: 'DONE',
      assignee: {
        id: '33333333-3333-4333-8333-333333333333',
        firstName: 'Анна',
        lastName: 'Соколова',
        username: null,
      },
    });

    await harness.useCase.handle(
      callbackEvent(`hod:personal:action:detail:${actionId}:given:completed:0`),
    );

    expect(harness.publish.mock.lastCall?.[0].text).toContain('Исполнитель: Анна Соколова');
    expect(harness.publish.mock.lastCall?.[0].buttons).toEqual([
      { text: '⬅️ Назад', payload: 'hod:personal:actions:given:completed:0', row: 0 },
      { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 1 },
    ]);
  });

  it('opens a pending result from the review list with confirmation actions and a return path', async () => {
    const harness = createHarness();
    harness.getDetail.mockResolvedValue({
      ...actionDetail(),
      status: 'DONE',
      assignee: {
        id: '33333333-3333-4333-8333-333333333333',
        firstName: 'Анна',
        lastName: null,
        username: null,
      },
    });

    await harness.useCase.handle(callbackEvent(`hod:personal:action:review:${actionId}:2`));

    expect(harness.publish.mock.lastCall?.[0].buttons).toEqual([
      { text: '✅ Подтвердить результат', payload: `hod:action:verify:${actionId}`, row: 0 },
      { text: '↩️ Вернуть на доработку', payload: `hod:action:return:${actionId}`, row: 1 },
      { text: '⬅️ Назад', payload: 'hod:personal:actions:review:2', row: 2 },
      { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 3 },
    ]);
  });

  it('rejects an edit callback for a task delegated to another person', async () => {
    const harness = createHarness();
    harness.getDetail.mockResolvedValue({
      ...actionDetail(),
      assignee: {
        id: '33333333-3333-4333-8333-333333333333',
        firstName: 'Анна',
        lastName: 'Соколова',
        username: null,
      },
    });

    await harness.useCase.handle(callbackEvent(`hod:personal:action:edit:${actionId}`));
    await harness.useCase.handle(callbackEvent(`hod:personal:action:edit-title:${actionId}`));

    expect(harness.setEditSession).not.toHaveBeenCalled();
    expect(harness.publish.mock.calls[0]?.[0].text).toBe('Это дело нельзя изменить.');
    expect(harness.publish.mock.calls[1]?.[0].text).toBe('Это дело нельзя изменить.');
  });

  it('shows task actions on separate rows without a redundant details button', async () => {
    const harness = createHarness();
    harness.getDetail.mockResolvedValue({ ...actionDetail(), status: 'IN_PROGRESS' });

    await harness.useCase.handle(callbackEvent(`hod:personal:action:detail:${actionId}`));

    const buttons = harness.publish.mock.lastCall?.[0].buttons ?? [];
    expect(buttons.map((button) => button.row)).toEqual([0, 1, 2, 3]);
    expect(buttons.map((button) => button.text)).toEqual([
      '✅ Выполнить',
      '✏️ Изменить',
      '📋 Все дела',
      '🏠 Главное меню',
    ]);
    expect(buttons).not.toContainEqual(expect.objectContaining({ text: '📄 Подробнее' }));
  });

  it('offers review actions without deletion for a self-assigned result', async () => {
    const harness = createHarness();
    harness.getDetail.mockResolvedValue({ ...actionDetail(), status: 'DONE' });

    await harness.useCase.handle(callbackEvent(`hod:personal:action:review:${actionId}:0`));

    const buttons = harness.publish.mock.lastCall?.[0].buttons ?? [];
    expect(buttons).toContainEqual({
      text: '✅ Подтвердить результат',
      payload: `hod:action:verify:${actionId}`,
      row: 0,
    });
    expect(buttons).toContainEqual({
      text: '↩️ Вернуть на доработку',
      payload: `hod:action:return:${actionId}`,
      row: 1,
    });
    expect(buttons).not.toContainEqual(expect.objectContaining({ text: '🗑 Удалить дело' }));
    expect(buttons).not.toContainEqual(expect.objectContaining({ text: '✏️ Изменить' }));

    await harness.useCase.handle(callbackEvent(`hod:personal:action:delete:${actionId}`));
    expect(harness.publish.mock.lastCall?.[0].text).toBe('Это дело нельзя удалить.');
  });

  it('offers deletion instead of editing for a verified self-assigned task', async () => {
    const harness = createHarness();
    harness.getDetail.mockResolvedValue({ ...actionDetail(), status: 'VERIFIED' });

    await harness.useCase.handle(callbackEvent(`hod:personal:action:detail:${actionId}`));

    const buttons = harness.publish.mock.lastCall?.[0].buttons ?? [];
    expect(buttons).toContainEqual({
      text: '🗑 Удалить дело',
      payload: `hod:personal:action:delete:${actionId}`,
      row: 0,
    });
    expect(buttons).not.toContainEqual(expect.objectContaining({ text: '✏️ Изменить' }));

    await harness.useCase.handle(callbackEvent(`hod:personal:action:delete:${actionId}`));
    expect(harness.publish.mock.lastCall?.[0].text).toContain('Удалить дело?');

    await harness.useCase.handle(callbackEvent(`hod:personal:action:edit-title:${actionId}`));
    expect(harness.setEditSession).not.toHaveBeenCalled();
    expect(harness.publish.mock.lastCall?.[0].text).toBe('Это дело нельзя изменить.');
  });

  it('does not offer editing or deletion for a cancelled task', async () => {
    const harness = createHarness();
    harness.getDetail.mockResolvedValue({ ...actionDetail(), status: 'CANCELLED' });

    await harness.useCase.handle(callbackEvent(`hod:personal:action:detail:${actionId}`));

    const buttons = harness.publish.mock.lastCall?.[0].buttons ?? [];
    expect(buttons).not.toContainEqual(expect.objectContaining({ text: '✏️ Изменить' }));
    expect(buttons).not.toContainEqual(expect.objectContaining({ text: '🗑 Удалить дело' }));

    await harness.useCase.handle(callbackEvent(`hod:personal:action:edit:${actionId}`));
    await harness.useCase.handle(callbackEvent(`hod:personal:action:delete:${actionId}`));
    expect(harness.publish.mock.calls.at(-2)?.[0].text).toBe('Это дело нельзя изменить.');
    expect(harness.publish.mock.lastCall?.[0].text).toBe('Это дело нельзя удалить.');
  });

  it('asks for confirmation before deleting an action', async () => {
    const harness = createHarness();

    await harness.useCase.handle(callbackEvent(`hod:personal:action:delete:${actionId}`));

    expect(harness.publish.mock.calls[0]?.[0].text).toContain('Удалить дело?');
    expect(harness.publish.mock.calls[0]?.[0].buttons).toContainEqual({
      text: '🗑 Да, удалить',
      payload: `hod:action:cancel:${actionId}`,
      row: 0,
    });
  });

  it('opens the chat completion flow from a task card', async () => {
    const harness = createHarness();
    harness.getDetail.mockResolvedValue({
      ...actionDetail(),
      status: 'IN_PROGRESS',
      expectedResultType: 'PHOTO',
    });

    await harness.useCase.handle(callbackEvent(`hod:personal:action:detail:${actionId}`));

    expect(harness.publish.mock.calls[0]?.[0].buttons).toContainEqual({
      text: '✅ Выполнить',
      payload: `hod:action:submit:${actionId}`,
      row: 0,
    });
  });

  it('offers completion to the assignee and return to the creator', async () => {
    const harness = createHarness();
    harness.getDetail.mockResolvedValue({ ...actionDetail(), status: 'IN_PROGRESS' });
    await harness.useCase.handle(callbackEvent(`hod:personal:action:detail:${actionId}`));
    expect(harness.publish.mock.lastCall?.[0].buttons).toContainEqual({
      text: '✅ Выполнить',
      payload: `hod:action:submit:${actionId}`,
      row: 0,
    });

    harness.getDetail.mockResolvedValue({ ...actionDetail(), status: 'DONE' });
    await harness.useCase.handle(callbackEvent(`hod:personal:action:detail:${actionId}`));
    expect(harness.publish.mock.lastCall?.[0].buttons).toContainEqual({
      text: '↩️ Вернуть на доработку',
      payload: `hod:action:return:${actionId}`,
      row: 1,
    });
  });

  it('opens a team action card without a personal workspace', async () => {
    const harness = createHarness(false);
    await harness.useCase.handle({
      ...callbackEvent(`hod:personal:action:detail:${actionId}`),
      externalChatId: 'chat-1',
    });
    expect(harness.resolveActor).toHaveBeenCalledWith(actionId, '42');
    expect(harness.getDetail).toHaveBeenCalledWith(userId, actionId, expect.any(Date));
    expect(harness.publish.mock.lastCall?.[0].text).toContain('Старое название');
    expect(harness.publish.mock.lastCall?.[0].target).toEqual({
      type: 'CHAT',
      externalId: 'chat-1',
    });
  });

  it('shows saved materials on the task card', async () => {
    const harness = createHarness();
    harness.getDetail.mockResolvedValue({
      ...actionDetail(),
      attachments: [
        {
          id: '00000000-0000-4000-8000-000000000099',
          originalName: 'result.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 128,
          downloadUrl: '/api/attachments/1',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    await harness.useCase.handle(callbackEvent(`hod:personal:action:detail:${actionId}`));

    expect(harness.publish.mock.lastCall?.[0].text).toContain('Материалы: 1');
    expect(harness.publish.mock.lastCall?.[0].buttons).toContainEqual({
      text: '📎 Материалы (1)',
      payload: `hod:personal:materials:${actionId}:0`,
      row: 2,
    });
  });
});

function createHarness(hasPersonal = true) {
  const store: PersonalWorkspaceStore = {
    bootstrap: vi.fn(),
    findByExternalUserId: vi.fn(() =>
      Promise.resolve(
        hasPersonal
          ? {
              workspaceId: 'workspace-42',
              chatId: 'chat-42',
              userId,
              timezone: 'Asia/Krasnoyarsk',
            }
          : null,
      ),
    ),
  };
  const getDetail = vi.fn<ActionReadPort['getDetail']>(() => Promise.resolve(actionDetail()));
  const actions: ActionReadPort = {
    getCurrentUser: vi.fn(),
    list: vi.fn(),
    getDetail,
  };
  const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
  const setEditSession = vi.fn<PersonalActionEditSessionStore['set']>(() => Promise.resolve());
  const clearEditSession = vi.fn<PersonalActionEditSessionStore['clear']>(() => Promise.resolve());
  const editSessions: PersonalActionEditSessionStore = {
    get: vi.fn(),
    set: setEditSession,
    clear: clearEditSession,
  };
  const actionEditor: ActionEditPort = {
    updateTitle: vi.fn(() => Promise.resolve(true)),
    updateDescription: vi.fn(() => Promise.resolve(true)),
    updateLocation: vi.fn(() => Promise.resolve(true)),
    updateDeadline: vi.fn(() => Promise.resolve(true)),
  };
  const resolveActor = vi.fn<ActionContextStore['resolveActor']>(() =>
    Promise.resolve({ workspaceId: 'workspace-42', actorId: userId }),
  );
  const contexts: ActionContextStore = { resolveActor, getNotificationContext: vi.fn() };

  return {
    useCase: new HandlePersonalActionsCallbackUseCase(
      store,
      actions,
      actionEditor,
      { publish },
      editSessions,
      contexts,
      'Asia/Krasnoyarsk',
    ),
    publish,
    getDetail,
    setEditSession,
    clearEditSession,
    resolveActor,
  };
}

function callbackEvent(payload: string): Extract<InboundChatEvent, { kind: 'message.callback' }> {
  return {
    kind: 'message.callback',
    eventId: 'callback:callback-1',
    occurredAt: new Date('2026-09-22T08:00:00.000Z'),
    externalChatId: null,
    externalMessageId: 'message-1',
    actor: {
      externalUserId: '42',
      firstName: 'Иван',
      lastName: null,
      username: 'ivan',
    },
    payload,
    callbackId: 'callback-1',
  };
}

function actionDetail(): ActionDetail {
  const participant = {
    id: userId,
    firstName: 'Иван',
    lastName: null,
    username: 'ivan',
  };

  return {
    id: actionId,
    title: 'Старое название',
    status: 'NEW',
    deadlineKind: 'UNKNOWN',
    deadlineAt: null,
    deadlineDate: null,
    deadlineDependency: null,
    deadlineRaw: null,
    location: null,
    expectedResultType: 'NONE',
    expectedResultText: null,
    creator: participant,
    assignee: participant,
    attentionReasons: [],
    updatedAt: '2026-09-22T08:00:00.000Z',
    description: null,
    sourceContext: [],
    events: [],
    attachments: [],
  };
}
