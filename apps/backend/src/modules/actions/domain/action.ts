export const actionStatuses = [
  'NEW',
  'ACCEPTED',
  'IN_PROGRESS',
  'BLOCKED',
  'DONE',
  'VERIFIED',
  'CANCELLED',
] as const;

export type ActionStatus = (typeof actionStatuses)[number];

export const actionCommands = [
  'ACCEPT',
  'START',
  'BLOCK',
  'UNBLOCK',
  'SUBMIT_RESULT',
  'VERIFY',
  'RETURN',
  'CANCEL',
] as const;

export type ActionCommand = (typeof actionCommands)[number];

export type ActionEventType =
  | 'ACTION_ACCEPTED'
  | 'ACTION_STARTED'
  | 'ACTION_BLOCKED'
  | 'ACTION_UNBLOCKED'
  | 'RESULT_SUBMITTED'
  | 'RESULT_ACCEPTED'
  | 'RESULT_REJECTED'
  | 'ACTION_CANCELLED';

export interface ActionLifecycleState {
  status: ActionStatus;
  blockedFromStatus: 'ACCEPTED' | 'IN_PROGRESS' | null;
}

export interface ActionActor {
  isAssignee: boolean;
  isCreator: boolean;
}

export interface ActionTransitionInput {
  action: ActionLifecycleState;
  actor: ActionActor;
  command: ActionCommand;
  reason?: string;
}

export interface ActionTransition {
  previousStatus: ActionStatus;
  nextStatus: ActionStatus;
  blockedFromStatus: 'ACCEPTED' | 'IN_PROGRESS' | null;
  eventType: ActionEventType;
  reason: string | null;
}
