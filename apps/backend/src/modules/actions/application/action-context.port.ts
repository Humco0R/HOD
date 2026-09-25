import type { ActionCommand, ActionStatus } from '../domain/action';

export interface ActionActorContext {
  workspaceId: string;
  actorId: string;
}

export interface ActionNotificationContext {
  actionId: string;
  title: string;
  status: ActionStatus;
  creatorExternalUserId: string;
  assigneeExternalUserId: string;
  attachmentCount?: number;
}

export interface ActionContextStore {
  resolveActor(actionId: string, actorExternalUserId: string): Promise<ActionActorContext | null>;
  getNotificationContext(actionId: string): Promise<ActionNotificationContext>;
}

export interface ActionLifecycleNotificationPort {
  publish(input: {
    context: ActionNotificationContext;
    command: ActionCommand;
    reason: string | null;
    idempotencyKey: string;
  }): Promise<void>;
}

export interface ActionReminderNotificationPort {
  publish(input: { context: ActionNotificationContext; idempotencyKey: string }): Promise<void>;
}
