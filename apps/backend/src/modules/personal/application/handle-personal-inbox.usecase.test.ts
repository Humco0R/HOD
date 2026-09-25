import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { ActionEditPort, ActionReasonSessionStore } from '../../actions';
import type { DetectionQueuePort } from '../../detections';
import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent } from '../../workspaces';
import { HandlePersonalInboxUseCase } from './handle-personal-inbox.usecase';
import type { PersonalActionEditSessionStore } from './personal-action-edit-session.port';
import type { PersonalActionCreateSessionStore } from './personal-action-create-session.port';
import type { PersonalWorkspaceStore } from './personal-workspace.port';

const author = {
  externalUserId: '42',
  firstName: 'Иван',
  lastName: null,
  username: 'ivan',
};

describe('HandlePersonalInboxUseCase', () => {
  it('opens the chat menu when the native MAX start button sends bot_started', async () => {
    const harness = createHarness();
    await harness.useCase.handle({
      kind: 'personal.started',
      eventId: 'bot_started:1:900:42',
      occurredAt: new Date(1),
      externalDialogId: '900',
      actor: author,
    });

    expect(harness.bootstrap).toHaveBeenCalledWith({
      externalDialogId: '900',
      user: author,
      timezone: 'Asia/Krasnoyarsk',
    });
    const welcome = harness.publish.mock.calls[0];
    expect(welcome?.[0].target).toEqual({ type: 'USER', externalId: '42' });
    expect(welcome?.[0].buttons).toEqual([
      { text: '➕ Создать дело', payload: 'hod:personal:create', row: 0 },
      { text: '📋 Мои дела', payload: 'hod:personal:actions', row: 1 },
      { text: '❓ Как это работает', payload: 'hod:personal:help', row: 2 },
    ]);
    expect(welcome?.[1]).toBe(
      `personal-welcome-${createHash('sha256').update('bot_started:1:900:42').digest('hex')}`,
    );
  });

  it('queues only a forwarded message and fixes the assignee to the source author', async () => {
    const harness = createHarness();
    const plain = messageEvent({ text: 'сделай задачу', forwardedMessage: null });
    await harness.useCase.handle(plain);
    expect(harness.queue).not.toHaveBeenCalled();

    const forwarded = messageEvent({
      eventId: 'message:forward-1',
      externalMessageId: 'forward-1',
      text: 'Это важно',
      forwardedMessage: {
        messageId: 'original-1',
        text: 'Проверь кондиционер и пришли фото',
        attachmentMetadata: [],
      },
    });
    await harness.useCase.handle(forwarded);

    expect(harness.queue).toHaveBeenCalledOnce();
    expect(harness.queue.mock.calls[0]?.[0]).toMatchObject({
      sourceMode: 'PERSONAL_FORWARD',
      assignmentStrategy: 'SOURCE_AUTHOR',
      proposalTarget: { type: 'USER', externalId: '42' },
      sourceSenderId: 'user-42',
      text: 'Проверь кондиционер и пришли фото\n\nКомментарий пользователя: Это важно',
    });
  });

  it('does not treat a message during reason entry as a new task', async () => {
    const harness = createHarness();
    harness.getReasonSession.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      actionId: '22222222-2222-4222-8222-222222222222',
      command: 'BLOCK',
      reason: null,
      lastMessageId: null,
    });
    await harness.useCase.handle(
      messageEvent({
        text: 'Жду доступ к материалам',
        forwardedMessage: {
          messageId: 'original-1',
          text: 'Пересланное сообщение',
          attachmentMetadata: [],
        },
      }),
    );
    expect(harness.queue).not.toHaveBeenCalled();
  });

  it('bootstraps an unknown personal workspace from an explicit /start command', async () => {
    const harness = createHarness(true, false);
    await harness.useCase.handle(messageEvent({ text: '/start' }));
    expect(harness.bootstrap).toHaveBeenCalledWith({
      externalDialogId: null,
      user: author,
      timezone: 'Asia/Krasnoyarsk',
    });
    expect(harness.publish.mock.calls[0]?.[0].text).toContain('Привет! Я ХОД');
  });

  it('leaves text in an active creation flow to the create handler', async () => {
    const harness = createHarness();
    harness.getCreateSession.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      step: 'TITLE',
      navigationStack: [],
      lastHandledEventId: null,
      title: null,
      description: null,
      deadlineKind: 'UNKNOWN',
      deadlineDate: null,
      deadlineAt: null,
      deadlineRaw: null,
    });

    await harness.useCase.handle(messageEvent({ text: 'Новая задача' }));
    expect(harness.publish).not.toHaveBeenCalled();
    expect(harness.queue).not.toHaveBeenCalled();
    expect(harness.updateTitle).not.toHaveBeenCalled();
  });

  it('acknowledges a forward without queueing when AI is disabled', async () => {
    const harness = createHarness(false);
    await harness.useCase.handle(
      messageEvent({
        forwardedMessage: {
          messageId: 'original-1',
          text: 'Проверь объект',
          attachmentMetadata: [],
        },
      }),
    );
    expect(harness.publish.mock.calls[0]?.[0].text).toContain('AI provider');
  });

  it('uses the next personal text message as a new title during an edit session', async () => {
    const harness = createHarness();
    harness.getEditSession.mockResolvedValue({
      actionId: '11111111-1111-4111-8111-111111111111',
      mode: 'TITLE',
    });

    await harness.useCase.handle(messageEvent({ text: '  Новое название  ' }));

    expect(harness.updateTitle).toHaveBeenCalledWith({
      actionId: '11111111-1111-4111-8111-111111111111',
      actorUserId: 'user-42',
      title: 'Новое название',
    });
    expect(harness.clearEditSession).toHaveBeenCalledWith('42');
    expect(harness.queue).not.toHaveBeenCalled();
    expect(harness.publish.mock.calls[0]?.[0].text).toContain('Название изменено');
  });

  it.each([
    ['DESCRIPTION', 'updateDescription', { description: 'Details' }],
    ['LOCATION', 'updateLocation', { location: 'Office' }],
  ] as const)('routes %s edits to the correct field', async (mode, method, field) => {
    const harness = createHarness();
    harness.getEditSession.mockResolvedValue({
      actionId: '11111111-1111-4111-8111-111111111111',
      mode,
    });

    await harness.useCase.handle(messageEvent({ text: `  ${Object.values(field)[0]}  ` }));

    expect(harness[method]).toHaveBeenCalledWith({
      actionId: '11111111-1111-4111-8111-111111111111',
      actorUserId: 'user-42',
      ...field,
    });
    expect(harness.clearEditSession).toHaveBeenCalledWith('42');
    expect(harness.queue).not.toHaveBeenCalled();
  });

  it('saves a date-only deadline from an edit session', async () => {
    const harness = createHarness();
    harness.getEditSession.mockResolvedValue({
      actionId: '11111111-1111-4111-8111-111111111111',
      mode: 'DEADLINE_DATE',
    });

    await harness.useCase.handle(messageEvent({ text: '25.09.2026' }));

    expect(harness.updateDeadline).toHaveBeenCalledWith({
      actionId: '11111111-1111-4111-8111-111111111111',
      actorUserId: 'user-42',
      deadlineKind: 'DATE_ONLY',
      deadlineAt: null,
      deadlineDate: '2026-09-25',
      deadlineDependency: null,
      deadlineRaw: '25.09.2026',
    });
    expect(harness.clearEditSession).toHaveBeenCalledWith('42');
  });

  it('interprets an edited date and time in the personal workspace timezone', async () => {
    const harness = createHarness();
    harness.getEditSession.mockResolvedValue({
      actionId: '11111111-1111-4111-8111-111111111111',
      mode: 'DEADLINE_DATETIME',
    });

    await harness.useCase.handle(messageEvent({ text: '25.09.2026 18:30' }));

    expect(harness.updateDeadline).toHaveBeenCalledOnce();
    const update = harness.updateDeadline.mock.calls[0]?.[0];
    expect(update).toMatchObject({
      actionId: '11111111-1111-4111-8111-111111111111',
      actorUserId: 'user-42',
      deadlineKind: 'EXACT_DATETIME',
      deadlineDate: null,
      deadlineRaw: '25.09.2026 18:30',
    });
    expect(update?.deadlineAt?.toISOString()).toBe('2026-09-25T11:30:00.000Z');
  });

  it('rejects a date earlier than today in the personal workspace timezone', async () => {
    const harness = createHarness();
    harness.getEditSession.mockResolvedValue({
      actionId: '11111111-1111-4111-8111-111111111111',
      mode: 'DEADLINE_DATE',
    });

    await harness.useCase.handle(
      messageEvent({
        occurredAt: new Date('2026-09-22T18:00:00.000Z'),
        text: '22.09.2026',
      }),
    );

    expect(harness.updateDeadline).not.toHaveBeenCalled();
    expect(harness.clearEditSession).not.toHaveBeenCalled();
    expect(harness.publish.mock.calls[0]?.[0].text).toContain('раньше сегодняшнего дня');
  });

  it('rejects a date and time that has already passed', async () => {
    const harness = createHarness();
    harness.getEditSession.mockResolvedValue({
      actionId: '11111111-1111-4111-8111-111111111111',
      mode: 'DEADLINE_DATETIME',
    });

    await harness.useCase.handle(
      messageEvent({
        occurredAt: new Date('2026-09-23T08:00:00.000Z'),
        text: '23.09.2026 14:00',
      }),
    );

    expect(harness.updateDeadline).not.toHaveBeenCalled();
    expect(harness.clearEditSession).not.toHaveBeenCalled();
    expect(harness.publish.mock.calls[0]?.[0].text).toContain('срок в прошлом');
  });
});

function createHarness(aiEnabled = true, known = true) {
  const bootstrap = vi.fn(() =>
    Promise.resolve({
      workspaceId: 'workspace-42',
      chatId: 'chat-42',
      userId: 'user-42',
      timezone: 'Asia/Krasnoyarsk',
    }),
  );
  const store: PersonalWorkspaceStore = {
    bootstrap,
    findByExternalUserId: vi.fn(() =>
      Promise.resolve(
        known
          ? {
              workspaceId: 'workspace-42',
              chatId: 'chat-42',
              userId: 'user-42',
              timezone: 'Asia/Krasnoyarsk',
            }
          : null,
      ),
    ),
  };
  const queue = vi.fn<DetectionQueuePort['publish']>(() => Promise.resolve());
  const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
  const getEditSession = vi.fn<PersonalActionEditSessionStore['get']>(() => Promise.resolve(null));
  const getCreateSession = vi.fn<PersonalActionCreateSessionStore['get']>(() =>
    Promise.resolve(null),
  );
  const getReasonSession = vi.fn<ActionReasonSessionStore['get']>(() => Promise.resolve(null));
  const setEditSession = vi.fn<PersonalActionEditSessionStore['set']>(() => Promise.resolve());
  const clearEditSession = vi.fn<PersonalActionEditSessionStore['clear']>(() => Promise.resolve());
  const updateTitle = vi.fn<ActionEditPort['updateTitle']>(() => Promise.resolve(true));
  const updateDescription = vi.fn<ActionEditPort['updateDescription']>(() => Promise.resolve(true));
  const updateLocation = vi.fn<ActionEditPort['updateLocation']>(() => Promise.resolve(true));
  const updateDeadline = vi.fn<ActionEditPort['updateDeadline']>(() => Promise.resolve(true));
  return {
    useCase: new HandlePersonalInboxUseCase(
      store,
      aiEnabled ? { publish: queue } : null,
      { publish },
      'Asia/Krasnoyarsk',
      {
        get: getEditSession,
        set: setEditSession,
        clear: clearEditSession,
      },
      {
        updateTitle,
        updateDescription,
        updateLocation,
        updateDeadline,
      },
      {
        get: getCreateSession,
        set: vi.fn<PersonalActionCreateSessionStore['set']>(() => Promise.resolve()),
        clear: vi.fn<PersonalActionCreateSessionStore['clear']>(() => Promise.resolve()),
      },
      {
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        clear: () => Promise.resolve(),
      },
      {
        get: getReasonSession,
        set: () => Promise.resolve(),
        clear: () => Promise.resolve(),
      },
    ),
    bootstrap,
    queue,
    publish,
    getEditSession,
    getCreateSession,
    getReasonSession,
    setEditSession,
    clearEditSession,
    updateTitle,
    updateDescription,
    updateLocation,
    updateDeadline,
  };
}

function messageEvent(
  override: Partial<Extract<InboundChatEvent, { kind: 'personal.message.created' }>> = {},
): Extract<InboundChatEvent, { kind: 'personal.message.created' }> {
  return {
    kind: 'personal.message.created',
    eventId: 'message:plain-1',
    occurredAt: new Date('2026-09-21T08:00:00.000Z'),
    externalMessageId: 'plain-1',
    author,
    text: null,
    attachmentMetadata: [],
    forwardedMessage: null,
    ...override,
  };
}
