import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { ActionCreatePort } from '../../actions';
import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent } from '../../workspaces';
import { HandlePersonalCreateUseCase } from './handle-personal-create.usecase';
import type {
  PersonalActionCreateSession,
  PersonalActionCreateSessionStore,
} from './personal-action-create-session.port';
import type { PersonalActionEditSessionStore } from './personal-action-edit-session.port';
import type { PersonalWorkspaceStore } from './personal-workspace.port';

const actor = {
  externalUserId: '42',
  firstName: 'Иван',
  lastName: null,
  username: 'ivan',
};

describe('HandlePersonalCreateUseCase', () => {
  it('creates a personal action after title, optional description, date and review', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback('hod:personal:create'));
    const draftId = harness.session()!.id;
    expect(harness.lastNotification().text).toContain('название');
    expect(harness.lastNotification().screen).toEqual({ key: draftId, replacePrevious: false });
    expect(harness.lastNotification().buttons).toEqual([
      { text: '⬅️ Назад', payload: `hod:personal:create:back:${draftId}`, row: 4 },
      { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 5 },
    ]);

    await harness.useCase.handle(message('Подготовить презентацию'));
    expect(harness.session()?.step).toBe('DESCRIPTION');
    expect(harness.lastNotification().screen).toEqual({ key: draftId, replacePrevious: true });
    await harness.useCase.handle(callback(`hod:personal:create:skip-description:${draftId}`));
    expect(harness.session()?.step).toBe('DEADLINE');
    await harness.useCase.handle(callback(`hod:personal:create:date:${draftId}`));
    await harness.useCase.handle(message('25.09.2026'));
    expect(harness.session()?.step).toBe('REVIEW');
    expect(harness.lastNotification().text).toContain('25.09.2026');
    expect(harness.lastNotification().buttons).not.toContainEqual(
      expect.objectContaining({ text: '❌ Отмена' }),
    );
    expect(harness.create).not.toHaveBeenCalled();

    await harness.useCase.handle(callback(`hod:personal:create:confirm:${draftId}`));
    expect(harness.create).toHaveBeenCalledWith({
      id: draftId,
      workspaceId: 'workspace-42',
      chatId: 'chat-42',
      actorUserId: 'user-42',
      assigneeUserId: 'user-42',
      title: 'Подготовить презентацию',
      description: null,
      deadlineKind: 'DATE_ONLY',
      deadlineDate: '2026-09-25',
      deadlineAt: null,
      deadlineRaw: '25.09.2026',
      source: 'PERSONAL_BOT',
    });
    expect(harness.session()).toBeNull();
    expect(harness.lastNotification().buttons).toContainEqual({
      text: '📄 Открыть дело',
      payload: `hod:personal:action:detail:${draftId}`,
      row: 0,
    });

    await harness.useCase.handle(callback(`hod:personal:create:confirm:${draftId}`));
    expect(harness.create).toHaveBeenCalledOnce();
  });

  it('goes back through the steps without losing entered values', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback('hod:personal:create'));
    const draftId = harness.session()!.id;
    await harness.useCase.handle(message('Согласовать бюджет'));
    await harness.useCase.handle(message('На следующий квартал'));
    await harness.useCase.handle(callback(`hod:personal:create:no-deadline:${draftId}`));

    await harness.useCase.handle(callback(`hod:personal:create:back:${draftId}`));
    expect(harness.session()?.step).toBe('DEADLINE');
    await harness.useCase.handle(callback(`hod:personal:create:back:${draftId}`));
    expect(harness.session()?.step).toBe('DESCRIPTION');
    expect(harness.lastNotification().text).toContain('На следующий квартал');
    await harness.useCase.handle(callback(`hod:personal:create:back:${draftId}`));
    expect(harness.session()?.step).toBe('TITLE');
    expect(harness.lastNotification().text).toContain('Согласовать бюджет');
  });

  it('does not advance a draft twice when MAX redelivers an input', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback('hod:personal:create'));
    const draftId = harness.session()!.id;
    const titleEvent = message('Проверить объект');
    await harness.useCase.handle(titleEvent);
    await harness.useCase.handle(titleEvent);
    expect(harness.session()?.step).toBe('DESCRIPTION');
    expect(harness.session()?.description).toBeNull();

    const skipEvent = callback(`hod:personal:create:skip-description:${draftId}`);
    await harness.useCase.handle(skipEvent);
    await harness.useCase.handle(skipEvent);
    expect(harness.session()?.step).toBe('DEADLINE');
  });

  it('edits the reviewed title and returns to review', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback('hod:personal:create'));
    const draftId = harness.session()!.id;
    await harness.useCase.handle(message('Старое название'));
    await harness.useCase.handle(callback(`hod:personal:create:skip-description:${draftId}`));
    await harness.useCase.handle(callback(`hod:personal:create:no-deadline:${draftId}`));
    await harness.useCase.handle(callback(`hod:personal:create:edit:${draftId}`));
    await harness.useCase.handle(callback(`hod:personal:create:field-title:${draftId}`));
    await harness.useCase.handle(message('Новое название'));
    expect(harness.session()?.step).toBe('REVIEW');
    expect(harness.lastNotification().text).toContain('Новое название');
  });

  it('rejects a past or invalid date and keeps the draft', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback('hod:personal:create'));
    const draftId = harness.session()!.id;
    await harness.useCase.handle(message('Проверить договор'));
    await harness.useCase.handle(callback(`hod:personal:create:skip-description:${draftId}`));
    await harness.useCase.handle(callback(`hod:personal:create:date:${draftId}`));
    await harness.useCase.handle(message('31.02.2026'));
    expect(harness.lastNotification().text).toContain('Такой даты нет');
    await harness.useCase.handle(message('22.09.2026'));
    expect(harness.lastNotification().text).toContain('раньше сегодняшнего дня');
    expect(harness.session()?.step).toBe('DEADLINE_DATE');
    expect(harness.create).not.toHaveBeenCalled();
  });

  it('converts an exact deadline from the personal workspace timezone', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback('hod:personal:create'));
    const draftId = harness.session()!.id;
    await harness.useCase.handle(message('Проверить договор'));
    await harness.useCase.handle(callback(`hod:personal:create:skip-description:${draftId}`));
    await harness.useCase.handle(callback(`hod:personal:create:datetime:${draftId}`));
    await harness.useCase.handle(message('25.09.2026 18:30'));
    await harness.useCase.handle(callback(`hod:personal:create:confirm:${draftId}`));

    expect(harness.create.mock.calls[0]?.[0]).toMatchObject({
      deadlineKind: 'EXACT_DATETIME',
      deadlineDate: null,
      deadlineAt: new Date('2026-09-25T11:30:00.000Z'),
    });
  });

  it('clears the draft on main menu and rejects stale draft buttons', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback('hod:personal:create'));
    const draftId = harness.session()!.id;
    await harness.useCase.handle(callback('hod:personal:menu'));
    expect(harness.session()).toBeNull();
    await harness.useCase.handle(callback(`hod:personal:create:confirm:${draftId}`));
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.lastNotification().text).toContain('больше не активен');
  });

  it('hands a forwarded task back to the existing detection path', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback('hod:personal:create'));
    const forwarded = {
      ...message(''),
      forwardedMessage: {
        messageId: 'original-1',
        text: 'Проверить объект',
        attachmentMetadata: [],
      },
    };
    await harness.useCase.handle(forwarded);
    expect(harness.session()).toBeNull();
    expect(harness.create).not.toHaveBeenCalled();
  });
});

function createHarness() {
  let current: PersonalActionCreateSession | null = null;
  let createdId: string | null = null;
  const sessions: PersonalActionCreateSessionStore = {
    get: vi.fn(() => Promise.resolve(current)),
    set: vi.fn((_userId: string, session: PersonalActionCreateSession) => {
      current = { ...session, navigationStack: [...session.navigationStack] };
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      current = null;
      return Promise.resolve();
    }),
  };
  const workspaces: PersonalWorkspaceStore = {
    bootstrap: vi.fn(),
    findByExternalUserId: vi.fn(() =>
      Promise.resolve({
        workspaceId: 'workspace-42',
        chatId: 'chat-42',
        userId: 'user-42',
        timezone: 'Asia/Krasnoyarsk',
      }),
    ),
  };
  const create = vi.fn<ActionCreatePort['create']>((input) => {
    createdId = input.id;
    return Promise.resolve({ actionId: input.id, created: true });
  });
  const exists = vi.fn<ActionCreatePort['exists']>((id) => Promise.resolve(id === createdId));
  const editSessions: PersonalActionEditSessionStore = {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(() => Promise.resolve()),
  };
  const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
  return {
    useCase: new HandlePersonalCreateUseCase(
      workspaces,
      sessions,
      editSessions,
      { create, exists },
      { publish },
    ),
    session: () => current,
    create,
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
    actor,
    payload,
    callbackId: id,
  };
}

function message(text: string): Extract<InboundChatEvent, { kind: 'personal.message.created' }> {
  const id = randomUUID();
  return {
    kind: 'personal.message.created',
    eventId: `message:${id}`,
    occurredAt: new Date('2026-09-23T08:00:00.000Z'),
    externalMessageId: id,
    author: actor,
    text,
    attachmentMetadata: [],
    forwardedMessage: null,
  };
}
