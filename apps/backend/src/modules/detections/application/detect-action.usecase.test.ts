import { describe, expect, it, vi } from 'vitest';

import type { DetectionCandidate, DetectionJob } from '../domain/detection';
import type {
  AiDetectionPort,
  DetectionProposalPort,
  DetectionRepository,
  DetectionWorkspaceContextPort,
} from './detection.ports';
import { DetectActionUseCase } from './detect-action.usecase';

describe('DetectActionUseCase confidence policy', () => {
  it('silently drops low-confidence output before persistence', async () => {
    const harness = createHarness(candidate({ confidence: 0.59 }));
    await expect(harness.useCase.execute(job)).resolves.toEqual({
      detectionId: null,
      created: false,
    });
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.publish).not.toHaveBeenCalled();
  });

  it('persists medium confidence for explicit human clarification', async () => {
    const harness = createHarness(candidate({ confidence: 0.7 }));
    await expect(harness.useCase.execute(job)).resolves.toEqual({
      detectionId: 'detection-1',
      created: true,
    });
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.create.mock.calls[0]?.[0].candidate.raw.confidenceBand).toBe('MEDIUM');
    expect(harness.publish).toHaveBeenCalledOnce();
  });

  it('rejects invalid provider output before persistence', async () => {
    const harness = createHarness(
      candidate({ deadlineKind: 'DATE_ONLY', deadlineDate: '2026-02-30' }),
    );
    await expect(harness.useCase.execute(job)).rejects.toThrow('Date-only deadline is invalid');
    expect(harness.create).not.toHaveBeenCalled();
  });

  it('does not fall back to a fake candidate after a provider failure', async () => {
    const harness = createHarness(candidate());
    harness.detect.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(harness.useCase.execute(job)).rejects.toThrow('provider unavailable');
    expect(harness.create).not.toHaveBeenCalled();
  });
});

function createHarness(output: DetectionCandidate) {
  const detect = vi.fn(() => Promise.resolve(output));
  const ai: AiDetectionPort = { detect };
  const create = vi.fn((input: Parameters<DetectionRepository['create']>[0]) => {
    void input;
    return Promise.resolve({ detectionId: 'detection-1', created: true });
  });
  const publish = vi.fn((input: Parameters<DetectionProposalPort['publish']>[0]) => {
    void input;
    return Promise.resolve();
  });
  const repository: DetectionRepository = {
    resolveAssignee: vi.fn(() =>
      Promise.resolve({ status: 'RESOLVED' as const, userId: 'user-2' }),
    ),
    create,
    confirm: vi.fn(),
    reject: vi.fn(),
  };
  const proposals: DetectionProposalPort = { publish };
  const context: DetectionWorkspaceContextPort = {
    get: vi.fn(() => Promise.resolve({ timezone: 'Asia/Krasnoyarsk', members: [] })),
  };
  return {
    useCase: new DetectActionUseCase(ai, repository, proposals, context, {
      high: 0.85,
      medium: 0.6,
    }),
    create,
    publish,
    detect,
  };
}

function candidate(override: Partial<DetectionCandidate> = {}): DetectionCandidate {
  return {
    classification: 'ACTIONABLE',
    title: 'Проверить объект',
    assigneeReference: 'Антон',
    deadlineKind: 'UNKNOWN',
    deadlineAt: null,
    deadlineDate: null,
    deadlineDependency: null,
    deadlineRaw: null,
    expectedResultType: 'UNKNOWN',
    expectedResultText: null,
    location: null,
    confidence: 0.9,
    raw: {},
    ...override,
  };
}

const job: DetectionJob = {
  sourceMode: 'GROUP_CHAT',
  assignmentStrategy: 'RESOLVE_FROM_TEXT',
  proposalTarget: { type: 'CHAT', externalId: '100' },
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  externalChatId: '100',
  sourceMessageId: 'message-1',
  sourceSenderId: 'user-1',
  sourceSenderExternalId: '1',
  occurredAt: '2026-09-20T08:00:00.000Z',
  text: 'Антон, проверь объект',
  attachmentMetadata: [],
  context: [],
};
