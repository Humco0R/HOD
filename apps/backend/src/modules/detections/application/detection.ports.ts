import type {
  AiDetectionInput,
  DetectionCandidate,
  DetectionContextMessage,
  DetectionJob,
  DetectionWorkspaceContext,
} from '../domain/detection';

export interface AiDetectionPort {
  detect(input: AiDetectionInput): Promise<DetectionCandidate>;
}

export interface DetectionWorkspaceContextPort {
  get(workspaceId: string): Promise<DetectionWorkspaceContext>;
}

export interface ConversationContextPort {
  append(
    externalChatId: string,
    message: DetectionContextMessage,
  ): Promise<DetectionContextMessage[]>;
}

export interface DetectionQueuePort {
  publish(job: DetectionJob, idempotencyKey: string): Promise<void>;
}

export interface RecentGroupTaskGuardPort {
  claim(job: DetectionJob): Promise<boolean>;
  release(job: DetectionJob): Promise<void>;
}

export interface AssigneeResolution {
  status: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED';
  userId: string | null;
}

export interface DetectionRepository {
  resolveAssignee(workspaceId: string, reference: string | null): Promise<AssigneeResolution>;
  create(input: {
    job: DetectionJob;
    candidate: DetectionCandidate;
    assignee: AssigneeResolution;
  }): Promise<{ detectionId: string; created: boolean }>;
  confirm(input: {
    detectionId: string;
    actorExternalUserId: string;
    idempotencyKey: string;
  }): Promise<{
    actionId: string;
    idempotent: boolean;
    assigneeExternalUserId: string;
    creatorName: string;
    title: string;
  }>;
  reject(input: {
    detectionId: string;
    actorExternalUserId: string;
  }): Promise<{ idempotent: boolean }>;
}

export interface DetectionProposalPort {
  publish(input: {
    detectionId: string;
    target: { type: 'CHAT' | 'USER'; externalId: string };
    candidate: DetectionCandidate;
    assignee: AssigneeResolution;
    assigneeLabel: string | null;
  }): Promise<void>;
}

export interface AssignmentNotificationPort {
  publish(input: {
    actionId: string;
    assigneeExternalUserId: string;
    creatorName?: string;
    title: string;
  }): Promise<void>;
}
