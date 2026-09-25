import type { ActionDetail } from '@hod/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent } from '../../workspaces';
import type { ActionReadPort } from './action-read.port';
import type { ActionContextStore } from './action-context.port';
import type { ActionReasonSession, ActionReasonSessionStore } from './action-reason-session.port';
import { HandleActionReasonUseCase } from './handle-action-reason.usecase';
import type { TransitionActionWithNotificationUseCase } from './transition-action-with-notification.usecase';

const actionId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

describe('HandleActionReasonUseCase', () => {
  it.each([
    { operation: 'block', status: 'IN_PROGRESS' as const, command: 'BLOCK' as const },
    { operation: 'return', status: 'DONE' as const, command: 'RETURN' as const },
  ])('collects and confirms a reason for $command', async ({ operation, status, command }) => {
    const harness = createHarness(status);
    await harness.useCase.handle(callback(`hod:action:${operation}:${actionId}`));
    expect(harness.publish.mock.lastCall?.[0].text).toContain('Напиши причину');
    const session = harness.session!;

    await harness.useCase.handle(message('Нужны исходные данные'));
    expect(harness.publish.mock.lastCall?.[0].text).toContain('Нужны исходные данные');
    await harness.useCase.handle(callback(`hod:action:reason:confirm:${session.id}`));
    expect(harness.execute).toHaveBeenCalledWith({
      actionId,
      workspaceId: 'workspace-1',
      actorId: userId,
      idempotencyKey: `max-reason:${session.id}`,
      command,
      reason: 'Нужны исходные данные',
    });
    expect(harness.session).toBeNull();
  });

  it('rejects a different actor, an empty reason and stale confirmation', async () => {
    const harness = createHarness('DONE', false);
    await harness.useCase.handle(callback(`hod:action:return:${actionId}`));
    expect(harness.session).toBeNull();

    harness.detail.creator.id = userId;
    await harness.useCase.handle(callback(`hod:action:return:${actionId}`));
    const session = harness.session!;
    await harness.useCase.handle(message('  '));
    expect(harness.session?.reason).toBeNull();
    await harness.useCase.handle(callback(`hod:action:reason:confirm:${session.id}`));
    expect(harness.execute).not.toHaveBeenCalled();
    await harness.useCase.handle(callback(`hod:action:reason:cancel:${session.id}`));
    await harness.useCase.handle(message('Текст после отмены'));
    await harness.useCase.handle(callback(`hod:action:reason:confirm:${session.id}`));
    expect(harness.execute).not.toHaveBeenCalled();
  });
});

function createHarness(status: ActionDetail['status'], isAuthorized = true) {
  let session: ActionReasonSession | null = null;
  const detail = actionDetail(status, isAuthorized);
  const sessions: ActionReasonSessionStore = {
    get: vi.fn(() => Promise.resolve(session)),
    set: vi.fn<ActionReasonSessionStore['set']>((_, value) => {
      session = value;
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      session = null;
      return Promise.resolve();
    }),
  };
  const contexts: ActionContextStore = {
    resolveActor: vi.fn(() => Promise.resolve({ workspaceId: 'workspace-1', actorId: userId })),
    getNotificationContext: vi.fn(),
  };
  const actions: ActionReadPort = {
    getCurrentUser: vi.fn(),
    list: vi.fn(),
    getDetail: vi.fn(() => Promise.resolve(detail)),
  };
  const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
  const execute = vi.fn<TransitionActionWithNotificationUseCase['execute']>(() =>
    Promise.resolve({
      action: {
        id: actionId,
        workspaceId: 'workspace-1',
        creatorId: userId,
        assigneeId: userId,
        status: status === 'DONE' ? 'IN_PROGRESS' : 'BLOCKED',
        blockedFromStatus: null,
        expectedResultType: 'NONE',
        attachmentCount: 0,
      },
      idempotent: false,
    }),
  );
  return {
    useCase: new HandleActionReasonUseCase(
      contexts,
      actions,
      { execute } as unknown as TransitionActionWithNotificationUseCase,
      sessions,
      { publish },
    ),
    publish,
    execute,
    detail,
    get session() {
      return session;
    },
  };
}

function callback(payload: string): Extract<InboundChatEvent, { kind: 'message.callback' }> {
  return {
    kind: 'message.callback',
    eventId: `callback:${payload}`,
    occurredAt: new Date(),
    externalChatId: null,
    externalMessageId: 'message-1',
    actor: { externalUserId: '42', firstName: 'Иван', lastName: null, username: null },
    payload,
    callbackId: payload,
  };
}

function message(text: string): Extract<InboundChatEvent, { kind: 'personal.message.created' }> {
  return {
    kind: 'personal.message.created',
    eventId: `message:${text}`,
    occurredAt: new Date(),
    externalMessageId: 'message-2',
    author: { externalUserId: '42', firstName: 'Иван', lastName: null, username: null },
    text,
    attachmentMetadata: [],
    forwardedMessage: null,
  };
}

function actionDetail(status: ActionDetail['status'], isAuthorized: boolean): ActionDetail {
  const participant = { id: userId, firstName: 'Иван', lastName: null, username: null };
  return {
    id: actionId,
    title: 'Дело',
    status,
    deadlineKind: 'UNKNOWN',
    deadlineAt: null,
    deadlineDate: null,
    deadlineDependency: null,
    deadlineRaw: null,
    location: null,
    expectedResultType: 'NONE',
    expectedResultText: null,
    creator: { ...participant, id: isAuthorized ? userId : '33333333-3333-4333-8333-333333333333' },
    assignee: participant,
    attentionReasons: [],
    updatedAt: new Date().toISOString(),
    description: null,
    sourceContext: [],
    events: [],
    attachments: [],
  };
}
