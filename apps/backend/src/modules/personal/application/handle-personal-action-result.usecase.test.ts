import { describe, expect, it, vi } from 'vitest';

import type { ActionDetail } from '@hod/contracts';

import type {
  ActionContextStore,
  ActionReadPort,
  TransitionActionWithNotificationUseCase,
} from '../../actions';
import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent } from '../../workspaces';
import { HandlePersonalActionResultUseCase } from './handle-personal-action-result.usecase';
import type {
  PersonalActionResultSession,
  PersonalActionResultSessionStore,
} from './personal-action-result-session.port';
import type { PersonalResultMaterialPort } from './personal-result-material.port';

const actionId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const workspaceId = '00000000-0000-4000-8000-000000000003';

describe('HandlePersonalActionResultUseCase', () => {
  it('lets a team assignee submit without a personal workspace, after confirmation', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback(`hod:action:submit:${actionId}`));
    expect(harness.resolveActor).toHaveBeenCalledWith(actionId, '42');

    expect(harness.publish.mock.lastCall?.[0].text).toContain(
      'Хотите приложить результат выполнения?',
    );
    expect(harness.transition).not.toHaveBeenCalled();
    const session = harness.session()!;
    await harness.useCase.handle(callback(`hod:personal:complete:review:${session.id}`));
    expect(harness.publish.mock.lastCall?.[0].text).toContain('Подтвердить выполнение задачи?');
    expect(harness.transition).not.toHaveBeenCalled();

    await harness.useCase.handle(callback(`hod:personal:complete:confirm:${session.id}`));
    expect(harness.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId,
        actorId: userId,
        command: 'SUBMIT_RESULT',
        idempotencyKey: `max-result:${session.id}`,
      }),
    );
    expect(harness.session()).toBeNull();
  });

  it('tells the user when a self-assigned result was confirmed automatically', async () => {
    const harness = createHarness();
    harness.transition.mockResolvedValue({ action: { status: 'VERIFIED' }, idempotent: false });
    await harness.useCase.handle(callback(`hod:action:submit:${actionId}`));
    const session = harness.session()!;
    await harness.useCase.handle(callback(`hod:personal:complete:review:${session.id}`));
    await harness.useCase.handle(callback(`hod:personal:complete:confirm:${session.id}`));

    expect(harness.publish.mock.lastCall?.[0].text).toBe('✅ Дело выполнено и подтверждено.');
  });

  it('collects several photos, files and comments before confirmation', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback(`hod:action:submit:${actionId}`));
    const session = harness.session()!;

    await harness.useCase.handle(callback(`hod:personal:complete:photo:${session.id}`));
    await harness.useCase.handle(
      message('photo-1', [{ type: 'image', payload: { url: 'https://i.oneme.ru/1' } }]),
    );
    await harness.useCase.handle(
      message('photo-2', [{ type: 'image', payload: { url: 'https://i.oneme.ru/2' } }]),
    );
    await harness.useCase.handle(callback(`hod:personal:complete:file:${session.id}`));
    await harness.useCase.handle(
      message('file-1', [
        { type: 'file', filename: 'result.pdf', payload: { url: 'https://fu.oneme.ru/3' } },
      ]),
    );
    await harness.useCase.handle(callback(`hod:personal:complete:comment:${session.id}`));
    await harness.useCase.handle(message('comment-1', [], 'Первый комментарий'));
    await harness.useCase.handle(message('comment-2', [], 'Второй комментарий'));
    await harness.useCase.handle(callback(`hod:personal:complete:review:${session.id}`));

    expect(harness.session()?.materials).toHaveLength(3);
    expect(harness.publish.mock.lastCall?.[0].text).toContain(
      'Фото: 2 · файлы: 1 · комментарии: 2',
    );
    expect(harness.transition).not.toHaveBeenCalled();
    await harness.useCase.handle(callback(`hod:personal:complete:confirm:${session.id}`));
    expect(harness.transition).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Первый комментарий\n\nВторой комментарий' }),
    );
  });

  it('ignores a repeated MAX message and removes draft attachments on cancellation', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback(`hod:action:submit:${actionId}`));
    const session = harness.session()!;
    await harness.useCase.handle(callback(`hod:personal:complete:photo:${session.id}`));
    const photo = message('same-message', [
      { type: 'image', payload: { url: 'https://i.oneme.ru/1' } },
    ]);
    await harness.useCase.handle(photo);
    await harness.useCase.handle(photo);
    expect(harness.save).toHaveBeenCalledTimes(1);
    await harness.useCase.handle(callback(`hod:personal:complete:review:${session.id}`));
    await harness.useCase.handle(callback(`hod:personal:complete:cancel:${session.id}`));
    expect(harness.remove).toHaveBeenCalledTimes(1);
    expect(harness.transition).not.toHaveBeenCalled();
    expect(harness.session()).toBeNull();
  });

  it('rejects another assignee and stale confirmation callbacks', async () => {
    const harness = createHarness();
    harness.detail.assignee.id = '00000000-0000-4000-8000-000000000099';
    await harness.useCase.handle(callback(`hod:action:submit:${actionId}`));
    expect(harness.session()).toBeNull();
    expect(harness.publish.mock.lastCall?.[0].text).toContain('нельзя завершить');
    await harness.useCase.handle(
      callback('hod:personal:complete:confirm:00000000-0000-4000-8000-000000000088'),
    );
    expect(harness.transition).not.toHaveBeenCalled();
  });

  it('lets the user revise the result and return to the previous step', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback(`hod:action:submit:${actionId}`));
    const session = harness.session()!;
    await harness.useCase.handle(callback(`hod:personal:complete:review:${session.id}`));
    await harness.useCase.handle(callback(`hod:personal:complete:edit:${session.id}`));
    await harness.useCase.handle(callback(`hod:personal:complete:comment:${session.id}`));
    await harness.useCase.handle(message('comment', [], 'Нужна правка'));
    await harness.useCase.handle(callback(`hod:personal:complete:back:${session.id}`));
    expect(harness.session()?.step).toBe('EDIT');
    await harness.useCase.handle(callback(`hod:personal:complete:remove-comment:${session.id}`));
    expect(harness.session()?.comments).toEqual([]);
    await harness.useCase.handle(callback(`hod:personal:complete:review:${session.id}`));
    expect(harness.session()?.step).toBe('REVIEW');
    await harness.useCase.handle(callback(`hod:personal:complete:back:${session.id}`));
    expect(harness.session()?.step).toBe('EDIT');
  });

  it('keeps both materials when two MAX messages arrive together', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback(`hod:action:submit:${actionId}`));
    const session = harness.session()!;
    await harness.useCase.handle(callback(`hod:personal:complete:photo:${session.id}`));
    await Promise.all([
      harness.useCase.handle(
        message('photo-a', [{ type: 'image', payload: { url: 'https://i.oneme.ru/a' } }]),
      ),
      harness.useCase.handle(
        message('photo-b', [{ type: 'image', payload: { url: 'https://i.oneme.ru/b' } }]),
      ),
    ]);
    expect(harness.session()?.materials).toHaveLength(2);
  });

  it('offers a preview of uploaded material before confirmation', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback(`hod:action:submit:${actionId}`));
    const session = harness.session()!;
    await harness.useCase.handle(callback(`hod:personal:complete:photo:${session.id}`));
    await harness.useCase.handle(
      message('photo', [{ type: 'image', payload: { url: 'https://i.oneme.ru/photo' } }]),
    );
    const material = harness.session()!.materials[0]!;
    harness.detail.attachments = [
      {
        id: material.id,
        originalName: material.name,
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        downloadUrl: '/api/attachment',
        createdAt: new Date().toISOString(),
      },
    ];
    await harness.useCase.handle(callback(`hod:personal:complete:review:${session.id}`));
    expect(harness.publish.mock.lastCall?.[0].buttons).toContainEqual({
      text: '📷 Посмотреть 1',
      payload: `hod:personal:complete:preview:${session.id}:${material.id}`,
      row: 0,
    });
    await harness.useCase.handle(
      callback(`hod:personal:complete:preview:${session.id}:${material.id}`),
    );
    expect(harness.publish.mock.lastCall?.[0].media).toEqual({
      attachmentId: material.id,
      requesterUserId: userId,
    });
  });
});

function createHarness() {
  let active: PersonalActionResultSession | null = null;
  let saved = 0;
  const sessions: PersonalActionResultSessionStore = {
    get: vi.fn(() => Promise.resolve(active)),
    set: vi.fn((_user: string, session: PersonalActionResultSession) => {
      active = { ...session, comments: [...session.comments], materials: [...session.materials] };
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      active = null;
      return Promise.resolve();
    }),
  };
  const detail = actionDetail();
  const actions: ActionReadPort = {
    getCurrentUser: vi.fn(),
    list: vi.fn(),
    getDetail: vi.fn(() => Promise.resolve(detail)),
  };
  const resolveActor = vi.fn<ActionContextStore['resolveActor']>(() =>
    Promise.resolve({ workspaceId, actorId: userId }),
  );
  const contexts: ActionContextStore = {
    resolveActor,
    getNotificationContext: vi.fn(),
  };
  const transition = vi.fn(() => Promise.resolve({ action: {}, idempotent: false }));
  const save = vi.fn<PersonalResultMaterialPort['save']>((input) =>
    Promise.resolve({
      id: `00000000-0000-4000-8000-${String(++saved).padStart(12, '0')}`,
      name: input.kind === 'PHOTO' ? 'Фото.jpg' : 'result.pdf',
      kind: input.kind,
    }),
  );
  const remove = vi.fn<PersonalResultMaterialPort['remove']>(() => Promise.resolve());
  const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
  return {
    useCase: new HandlePersonalActionResultUseCase(
      actions,
      contexts,
      { execute: transition } as unknown as TransitionActionWithNotificationUseCase,
      sessions,
      { save, remove },
      { publish },
      { get: () => Promise.resolve(null), set: vi.fn(), clear: vi.fn() },
      { get: () => Promise.resolve(null), set: vi.fn(), clear: vi.fn() },
    ),
    detail,
    publish,
    transition,
    save,
    remove,
    resolveActor,
    session: () => active,
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

function message(
  id: string,
  attachments: Record<string, unknown>[],
  text: string | null = null,
): Extract<InboundChatEvent, { kind: 'personal.message.created' }> {
  return {
    kind: 'personal.message.created',
    eventId: `message:${id}`,
    occurredAt: new Date(),
    externalMessageId: id,
    author: { externalUserId: '42', firstName: 'Иван', lastName: null, username: null },
    text,
    attachmentMetadata: attachments,
    forwardedMessage: null,
  };
}

function actionDetail(): ActionDetail {
  const participant = { id: userId, firstName: 'Иван', lastName: null, username: null };
  return {
    id: actionId,
    title: 'Подготовить презентацию',
    status: 'IN_PROGRESS',
    deadlineKind: 'UNKNOWN',
    deadlineAt: null,
    deadlineDate: null,
    deadlineDependency: null,
    deadlineRaw: null,
    location: null,
    expectedResultType: 'PHOTO',
    expectedResultText: null,
    creator: participant,
    assignee: participant,
    attentionReasons: [],
    updatedAt: new Date().toISOString(),
    description: null,
    sourceContext: [],
    events: [],
    attachments: [],
  };
}
