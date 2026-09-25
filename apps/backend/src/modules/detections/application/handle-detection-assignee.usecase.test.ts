import type { DetectionDetail } from '@hod/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { NotificationPublisher } from '../../notifications';
import type { InboundChatEvent } from '../../workspaces';
import {
  HandleDetectionAssigneeUseCase,
  type DetectionChatManagementPort,
} from './handle-detection-assignee.usecase';

const detectionId = '11111111-1111-4111-8111-111111111111';
const assigneeId = '22222222-2222-4222-8222-222222222222';

describe('HandleDetectionAssigneeUseCase', () => {
  it('pages team members and confirms the chosen assignee in the chat', async () => {
    const detail = detectionDetail();
    const getForExternalUser = vi.fn<DetectionChatManagementPort['getForExternalUser']>(() =>
      Promise.resolve(detail),
    );
    const chooseAssignee = vi.fn<DetectionChatManagementPort['chooseAssignee']>((_, __, chosen) => {
      detail.assigneeId = chosen;
      return Promise.resolve();
    });
    const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
    const useCase = new HandleDetectionAssigneeUseCase(
      { getForExternalUser, chooseAssignee },
      { publish },
    );

    await useCase.handle(callback(`hod:detection:assignees:${detectionId}:0`));
    expect(publish.mock.lastCall?.[0].target).toEqual({ type: 'CHAT', externalId: 'chat-1' });
    expect(publish.mock.lastCall?.[0].buttons).toContainEqual({
      text: '➡️ Ещё',
      payload: `hod:detection:assignees:${detectionId}:1`,
      row: 5,
    });
    await useCase.handle(callback(`hod:detection:assignee:${detectionId}:${assigneeId}`));
    expect(chooseAssignee).toHaveBeenCalledWith(detectionId, '42', assigneeId);
    expect(publish.mock.lastCall?.[0].text).toContain('Исполнитель: Участник 1');
    expect(publish.mock.lastCall?.[0].buttons).toContainEqual({
      text: '✅ В дело',
      payload: `hod:detection:confirm:${detectionId}`,
      row: 0,
    });
  });

  it('does not change or remove the group proposal when another member presses its button', async () => {
    const publish = vi.fn<NotificationPublisher['publish']>(() => Promise.resolve());
    const management: DetectionChatManagementPort = {
      getForExternalUser: vi.fn(() => Promise.resolve(null)),
      chooseAssignee: vi.fn(),
    };
    const useCase = new HandleDetectionAssigneeUseCase(management, { publish });
    await expect(
      useCase.handle(callback(`hod:detection:assignees:${detectionId}:0`)),
    ).rejects.toThrow('Only the source author');
    expect(publish).not.toHaveBeenCalled();
  });
});

function callback(payload: string): Extract<InboundChatEvent, { kind: 'message.callback' }> {
  return {
    kind: 'message.callback',
    eventId: payload,
    occurredAt: new Date(),
    externalChatId: 'chat-1',
    externalMessageId: 'message-1',
    actor: { externalUserId: '42', firstName: 'Иван', lastName: null, username: null },
    payload,
    callbackId: payload,
  };
}

function detectionDetail(): DetectionDetail {
  return {
    id: detectionId,
    title: 'Согласовать бюджет',
    assigneeId: null,
    deadlineKind: 'UNKNOWN',
    deadlineAt: null,
    deadlineDate: null,
    deadlineDependency: null,
    deadlineRaw: null,
    expectedResultType: 'NONE',
    expectedResultText: null,
    location: null,
    status: 'PENDING',
    members: Array.from({ length: 7 }, (_, index) => ({
      id: index === 0 ? assigneeId : `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
      firstName: 'Участник',
      lastName: String(index + 1),
      username: null,
    })),
  };
}
