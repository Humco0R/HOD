import type { DetectionJob } from '../domain/detection';
import { normalizeDetectionCandidate } from '../domain/normalize-detection-candidate';
import type {
  AiDetectionPort,
  DetectionProposalPort,
  DetectionRepository,
  DetectionWorkspaceContextPort,
  RecentGroupTaskGuardPort,
} from './detection.ports';

export class DetectActionUseCase {
  constructor(
    private readonly ai: AiDetectionPort,
    private readonly repository: DetectionRepository,
    private readonly proposals: DetectionProposalPort,
    private readonly workspaceContext: DetectionWorkspaceContextPort,
    private readonly confidence: { high: number; medium: number },
    private readonly recentGroupTasks?: RecentGroupTaskGuardPort,
  ) {}

  async execute(job: DetectionJob): Promise<{ detectionId: string | null; created: boolean }> {
    const context = await this.workspaceContext.get(job.workspaceId);
    const candidate = normalizeDetectionCandidate(await this.ai.detect({ job, ...context }));
    if (candidate.classification !== 'ACTIONABLE' || !candidate.title) {
      return { detectionId: null, created: false };
    }
    if (candidate.confidence < this.confidence.medium) {
      return { detectionId: null, created: false };
    }
    candidate.raw = {
      ...candidate.raw,
      confidenceBand: candidate.confidence >= this.confidence.high ? 'HIGH' : 'MEDIUM',
    };

    if (this.recentGroupTasks && !(await this.recentGroupTasks.claim(job))) {
      return { detectionId: null, created: false };
    }

    let assignee;
    let result;
    try {
      assignee =
        job.assignmentStrategy === 'SOURCE_AUTHOR'
          ? { status: 'RESOLVED' as const, userId: job.sourceSenderId }
          : await this.repository.resolveAssignee(job.workspaceId, candidate.assigneeReference);
      result = await this.repository.create({ job, candidate, assignee });
    } catch (error) {
      await this.recentGroupTasks?.release(job);
      throw error;
    }
    if (result.created) {
      await this.proposals.publish({
        detectionId: result.detectionId,
        target: job.proposalTarget,
        candidate,
        assignee,
        assigneeLabel: job.assignmentStrategy === 'SOURCE_AUTHOR' ? 'вы' : null,
      });
    }
    return result;
  }
}
