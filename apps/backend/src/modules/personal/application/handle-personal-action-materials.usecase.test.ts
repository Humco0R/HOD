import { describe, expect, it, vi } from 'vitest';

import type { ActionDetail } from '@hod/contracts';

import type { ActionContextStore, ActionReadPort } from '../../actions';
import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent } from '../../workspaces';
import { HandlePersonalActionMaterialsUseCase } from './handle-personal-action-materials.usecase';

const actionId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const attachmentId = '00000000-0000-4000-8000-000000000003';

describe('HandlePersonalActionMaterialsUseCase', () => {
  it('lists materials and sends a selected file only to an authorized user', async () => {
    const harness = createHarness();
    await harness.useCase.handle(callback(`hod:personal:materials:${actionId}:0`));
    const list = harness.publish.mock.lastCall?.[0];
    expect(list?.text).toContain('result.pdf');
    expect(list?.text).toContain('Готово');
    expect(list?.buttons).toContainEqual({
      text: '1. result.pdf',
      payload: `hod:personal:material:${actionId}:${attachmentId}:0`,
      row: 0,
    });

    await harness.useCase.handle(callback(`hod:personal:material:${actionId}:${attachmentId}:0`));
    expect(harness.publish.mock.lastCall?.[0]).toMatchObject({
      target: { type: 'USER', externalId: '42' },
      media: { attachmentId, requesterUserId: userId },
    });
  });

  it('does not expose a file when the requester has no access to the task', async () => {
    const harness = createHarness();
    harness.resolveActor.mockResolvedValue(null);
    await harness.useCase.handle(callback(`hod:personal:material:${actionId}:${attachmentId}:0`));
    expect(harness.getDetail).not.toHaveBeenCalled();
    expect(harness.publish.mock.lastCall?.[0].media).toBeUndefined();
    expect(harness.publish.mock.lastCall?.[0].text).toContain('нет доступа');
  });

  it('paginates the material list', async () => {
    const harness = createHarness();
    harness.detail.attachments = Array.from({ length: 7 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      originalName: `file-${index + 1}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 10,
      downloadUrl: '/api/attachment',
      createdAt: new Date().toISOString(),
    }));
    await harness.useCase.handle(callback(`hod:personal:materials:${actionId}:0`));
    expect(harness.publish.mock.lastCall?.[0].buttons).toContainEqual({
      text: '➡️ Ещё',
      payload: `hod:personal:materials:${actionId}:1`,
      row: 5,
    });
    await harness.useCase.handle(callback(`hod:personal:materials:${actionId}:1`));
    expect(harness.publish.mock.lastCall?.[0].text).toContain('file-7.pdf');
    expect(harness.publish.mock.lastCall?.[0].text).not.toContain('file-1.pdf');
  });
});

function createHarness() {
  const detail = actionDetail();
  const resolveActor = vi.fn<ActionContextStore['resolveActor']>(() =>
    Promise.resolve({ workspaceId: 'workspace', actorId: userId }),
  );
  const getDetail = vi.fn<ActionReadPort['getDetail']>(() => Promise.resolve(detail));
  const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
  const useCase = new HandlePersonalActionMaterialsUseCase(
    { resolveActor, getNotificationContext: vi.fn() },
    { getDetail, getCurrentUser: vi.fn(), list: vi.fn() },
    { publish },
  );
  return { useCase, detail, resolveActor, getDetail, publish };
}

function callback(payload: string): Extract<InboundChatEvent, { kind: 'message.callback' }> {
  return {
    kind: 'message.callback',
    eventId: `callback:${payload}`,
    occurredAt: new Date(),
    externalChatId: null,
    externalMessageId: 'message',
    actor: { externalUserId: '42', firstName: 'Иван', lastName: null, username: null },
    payload,
    callbackId: payload,
  };
}

function actionDetail(): ActionDetail {
  const user = { id: userId, firstName: 'Иван', lastName: null, username: null };
  return {
    id: actionId,
    title: 'Проверить договор',
    status: 'DONE',
    deadlineKind: 'UNKNOWN',
    deadlineAt: null,
    deadlineDate: null,
    deadlineDependency: null,
    deadlineRaw: null,
    location: null,
    expectedResultType: 'FILE',
    expectedResultText: null,
    creator: user,
    assignee: user,
    attentionReasons: [],
    updatedAt: new Date().toISOString(),
    description: null,
    sourceContext: [],
    events: [
      {
        id: 'event',
        type: 'RESULT_SUBMITTED',
        fromStatus: 'IN_PROGRESS',
        toStatus: 'DONE',
        reason: 'Готово',
        createdAt: new Date().toISOString(),
      },
    ],
    attachments: [
      {
        id: attachmentId,
        originalName: 'result.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12,
        downloadUrl: '/api/attachment',
        createdAt: new Date().toISOString(),
      },
    ],
  };
}
