import type { ActionEventType, ActionStatus, ActionTransition } from '../domain/action';

export interface PersistedActionLifecycle {
  id: string;
  workspaceId: string;
  creatorId: string;
  assigneeId: string;
  status: ActionStatus;
  blockedFromStatus: 'ACCEPTED' | 'IN_PROGRESS' | null;
  expectedResultType: 'PHOTO' | 'FILE' | 'TEXT' | 'NONE' | 'UNKNOWN';
  attachmentCount: number;
}

export interface ActionTransitionWrite extends ActionTransition {
  actorId: string;
  eventType: ActionEventType;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
}

export interface StoredActionTransition {
  action: PersistedActionLifecycle;
  idempotent: boolean;
}

export interface ActionLifecycleStore {
  transition(
    actionId: string,
    workspaceId: string,
    idempotencyKey: string,
    decide: (action: PersistedActionLifecycle) => ActionTransitionWrite,
  ): Promise<StoredActionTransition>;
}
