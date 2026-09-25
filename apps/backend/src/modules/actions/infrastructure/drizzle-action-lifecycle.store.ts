import { and, count, eq } from 'drizzle-orm';

import type {
  ActionLifecycleStore,
  ActionTransitionWrite,
  PersistedActionLifecycle,
  StoredActionTransition,
} from '../application/action-lifecycle.port';
import type { ActionStatus } from '../domain/action';
import type { Database } from '../../../infrastructure/db/client';
import { actionEvents, actions, attachments } from '../../../infrastructure/db/schema';
import { enqueueOutboxEvent } from '../../notifications';

export class DrizzleActionLifecycleStore implements ActionLifecycleStore {
  constructor(private readonly database: Database) {}

  transition(
    actionId: string,
    workspaceId: string,
    idempotencyKey: string,
    decide: (action: PersistedActionLifecycle) => ActionTransitionWrite,
  ): Promise<StoredActionTransition> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .select({
          id: actions.id,
          workspaceId: actions.workspaceId,
          creatorId: actions.creatorId,
          assigneeId: actions.assigneeId,
          status: actions.status,
          blockedFromStatus: actions.blockedFromStatus,
          expectedResultType: actions.expectedResultType,
        })
        .from(actions)
        .where(and(eq(actions.id, actionId), eq(actions.workspaceId, workspaceId)))
        .for('update')
        .limit(1);
      const action = rows[0];

      if (!action) {
        throw new Error('Action not found in workspace');
      }

      const attachmentRows = await transaction
        .select({ value: count() })
        .from(attachments)
        .where(eq(attachments.actionId, actionId));
      const current = toPersistedAction(action, attachmentRows[0]?.value ?? 0);
      const existingEvents = await transaction
        .select({ actorId: actionEvents.actorId })
        .from(actionEvents)
        .where(
          and(eq(actionEvents.actionId, actionId), eq(actionEvents.idempotencyKey, idempotencyKey)),
        )
        .limit(1);

      if (existingEvents[0]) {
        return { action: current, idempotent: true };
      }

      const decision = decide(current);
      const preserveVerification =
        decision.previousStatus === 'VERIFIED' && decision.nextStatus === 'CANCELLED';
      const updatedRows = await transaction
        .update(actions)
        .set({
          status: decision.nextStatus,
          blockedFromStatus: decision.blockedFromStatus,
          updatedAt: new Date(),
          ...(preserveVerification
            ? {}
            : { verifiedAt: decision.nextStatus === 'VERIFIED' ? new Date() : null }),
        })
        .where(eq(actions.id, actionId))
        .returning({
          id: actions.id,
          workspaceId: actions.workspaceId,
          creatorId: actions.creatorId,
          assigneeId: actions.assigneeId,
          status: actions.status,
          blockedFromStatus: actions.blockedFromStatus,
          expectedResultType: actions.expectedResultType,
        });

      await transaction.insert(actionEvents).values({
        actionId,
        workspaceId,
        actorId: decision.actorId,
        type: decision.eventType,
        fromStatus: decision.previousStatus,
        toStatus: decision.nextStatus,
        reason: decision.reason,
        metadata: decision.metadata,
        idempotencyKey: decision.idempotencyKey,
      });
      await enqueueOutboxEvent(transaction, {
        topic: 'ACTION_TRANSITION_NOTIFICATION_REQUESTED',
        dedupeKey: `action-${actionId}-${idempotencyKey}`,
        payload: {
          actionId,
          command: decision.metadata.command,
          reason: decision.reason,
          idempotencyKey: `action-${actionId}-${idempotencyKey}`,
        },
      });

      return {
        action: toPersistedAction(updatedRows[0]!, current.attachmentCount),
        idempotent: false,
      };
    });
  }
}

function toPersistedAction(
  action: {
    id: string;
    workspaceId: string;
    creatorId: string;
    assigneeId: string;
    status: ActionStatus;
    blockedFromStatus: ActionStatus | null;
    expectedResultType: 'PHOTO' | 'FILE' | 'TEXT' | 'NONE' | 'UNKNOWN';
  },
  attachmentCount: number,
): PersistedActionLifecycle {
  return {
    id: action.id,
    workspaceId: action.workspaceId,
    creatorId: action.creatorId,
    assigneeId: action.assigneeId,
    status: action.status,
    blockedFromStatus:
      action.blockedFromStatus === 'ACCEPTED' || action.blockedFromStatus === 'IN_PROGRESS'
        ? action.blockedFromStatus
        : null,
    expectedResultType: action.expectedResultType,
    attachmentCount,
  };
}
