import { and, eq } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/client';
import {
  actionDetections,
  actionEvents,
  actions,
  sourceMessages,
  users,
  workspaceMembers,
} from '../../../infrastructure/db/schema';
import { enqueueOutboxEvent } from '../../notifications';
import type { AssigneeResolution, DetectionRepository } from '../application/detection.ports';
import type { DetectionCandidate, DetectionJob } from '../domain/detection';
import { DetectionAccessDeniedError } from '../domain/detection-access-denied.error';

export class DrizzleDetectionRepository implements DetectionRepository {
  constructor(private readonly database: Database) {}

  async resolveAssignee(
    workspaceId: string,
    reference: string | null,
  ): Promise<AssigneeResolution> {
    if (!reference) return { status: 'UNRESOLVED', userId: null };
    const members = await this.database
      .select({
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.status, 'ACTIVE')),
      );
    const needle = normalizeName(reference.replace(/^@/, ''));
    const matches = members.filter((member) => {
      const fullName = [member.firstName, member.lastName].filter(Boolean).join(' ');
      return [member.firstName, fullName, member.username]
        .filter((value): value is string => Boolean(value))
        .some((value) => normalizeName(value) === needle);
    });
    if (matches.length === 1) return { status: 'RESOLVED', userId: matches[0]!.userId };
    return { status: matches.length > 1 ? 'AMBIGUOUS' : 'UNRESOLVED', userId: null };
  }

  async create(input: {
    job: DetectionJob;
    candidate: DetectionCandidate;
    assignee: AssigneeResolution;
  }): Promise<{ detectionId: string; created: boolean }> {
    return this.database.transaction(async (transaction) => {
      const inserted = await transaction
        .insert(actionDetections)
        .values({
          workspaceId: input.job.workspaceId,
          chatId: input.job.chatId,
          sourceMessageId: input.job.sourceMessageId,
          sourceSenderId: input.job.sourceSenderId,
          title: input.candidate.title!,
          suggestedAssigneeId: input.assignee.userId,
          deadlineKind: input.candidate.deadlineKind,
          suggestedDeadlineAt: toDate(input.candidate.deadlineAt),
          suggestedDeadlineDate: input.candidate.deadlineDate,
          suggestedDeadlineDependency: input.candidate.deadlineDependency,
          suggestedDeadlineRaw: input.candidate.deadlineRaw,
          expectedResultType: input.candidate.expectedResultType,
          expectedResultText: input.candidate.expectedResultText,
          location: input.candidate.location,
          confidence: input.candidate.confidence,
          rawAiOutput: {
            ...input.candidate.raw,
            sourceMode: input.job.sourceMode,
            assignmentStrategy: input.job.assignmentStrategy,
            assigneeResolution: input.assignee.status,
            assigneeReference: input.candidate.assigneeReference,
            triggerAttachmentMetadata: input.job.attachmentMetadata,
          },
          sourceContextSnapshot: input.job.context,
        })
        .onConflictDoNothing({
          target: [actionDetections.chatId, actionDetections.sourceMessageId],
        })
        .returning({ id: actionDetections.id });
      if (inserted[0]) {
        await enqueueOutboxEvent(transaction, {
          topic: 'DETECTION_PROPOSAL_REQUESTED',
          dedupeKey: `proposal-${inserted[0].id}`,
          payload: {
            detectionId: inserted[0].id,
            target: input.job.proposalTarget,
            candidate: input.candidate,
            assignee: input.assignee,
            assigneeLabel: input.job.assignmentStrategy === 'SOURCE_AUTHOR' ? 'вы' : null,
          },
        });
        return { detectionId: inserted[0].id, created: true };
      }

      const existing = await transaction
        .select({ id: actionDetections.id })
        .from(actionDetections)
        .where(
          and(
            eq(actionDetections.chatId, input.job.chatId),
            eq(actionDetections.sourceMessageId, input.job.sourceMessageId),
          ),
        )
        .limit(1);
      if (!existing[0]) throw new Error('Detection conflict could not be resolved');
      return { detectionId: existing[0].id, created: false };
    });
  }

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
  }> {
    return this.database.transaction(async (transaction) => {
      const detectionRows = await transaction
        .select()
        .from(actionDetections)
        .where(eq(actionDetections.id, input.detectionId))
        .for('update')
        .limit(1);
      const detection = detectionRows[0];
      if (!detection) throw new Error('Detection not found');
      const actorId = await authorizeDetectionActor(
        transaction,
        detection.workspaceId,
        detection.sourceSenderId,
        input.actorExternalUserId,
      );

      const existingActions = await transaction
        .select({ id: actions.id, assigneeId: actions.assigneeId })
        .from(actions)
        .where(eq(actions.detectionId, detection.id))
        .limit(1);
      if (existingActions[0]) {
        const creatorName = await getCreatorName(transaction, detection.sourceSenderId);
        return {
          actionId: existingActions[0].id,
          idempotent: true,
          title: detection.title,
          assigneeExternalUserId: await getExternalUserId(
            transaction,
            existingActions[0].assigneeId,
          ),
          creatorName,
        };
      }
      if (detection.status !== 'PENDING') throw new Error('Detection is no longer pending');
      if (!detection.suggestedAssigneeId) {
        throw new Error('Detection assignee must be resolved before confirmation');
      }
      const activeAssignee = await transaction
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, detection.workspaceId),
            eq(workspaceMembers.userId, detection.suggestedAssigneeId),
            eq(workspaceMembers.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      if (!activeAssignee[0])
        throw new Error('Detection assignee is no longer an active workspace member');

      const actionRows = await transaction
        .insert(actions)
        .values({
          detectionId: detection.id,
          workspaceId: detection.workspaceId,
          creatorId: detection.sourceSenderId,
          assigneeId: detection.suggestedAssigneeId,
          title: detection.title,
          status: 'NEW',
          deadlineKind: detection.deadlineKind,
          deadlineAt: detection.suggestedDeadlineAt,
          deadlineDate: detection.suggestedDeadlineDate,
          deadlineDependency: detection.suggestedDeadlineDependency,
          deadlineRaw: detection.suggestedDeadlineRaw,
          location: detection.location,
          expectedResultType: detection.expectedResultType,
          expectedResultText: detection.expectedResultText,
          sourceChatId: detection.chatId,
          sourceMessageId: detection.sourceMessageId,
          sourceContextSnapshot: detection.sourceContextSnapshot,
        })
        .returning({ id: actions.id });
      const actionId = actionRows[0]!.id;

      await transaction.insert(actionEvents).values({
        actionId,
        workspaceId: detection.workspaceId,
        actorId,
        type: 'ACTION_CREATED',
        fromStatus: null,
        toStatus: 'NEW',
        idempotencyKey: input.idempotencyKey,
        metadata: { detectionId: detection.id },
      });
      await persistSourceMessages(transaction, detection, actionId);
      await transaction
        .update(actionDetections)
        .set({ status: 'ACCEPTED', resolvedAt: new Date() })
        .where(eq(actionDetections.id, detection.id));

      const assigneeExternalUserId = await getExternalUserId(
        transaction,
        detection.suggestedAssigneeId,
      );
      const creatorName = await getCreatorName(transaction, detection.sourceSenderId);
      await enqueueOutboxEvent(transaction, {
        topic: 'ASSIGNMENT_NOTIFICATION_REQUESTED',
        dedupeKey: `assignment-${actionId}`,
        payload: { actionId, assigneeExternalUserId, creatorName, title: detection.title },
      });

      return {
        actionId,
        idempotent: false,
        title: detection.title,
        assigneeExternalUserId,
        creatorName,
      };
    });
  }

  reject(input: {
    detectionId: string;
    actorExternalUserId: string;
  }): Promise<{ idempotent: boolean }> {
    return this.database.transaction(async (transaction) => {
      const detectionRows = await transaction
        .select()
        .from(actionDetections)
        .where(eq(actionDetections.id, input.detectionId))
        .for('update')
        .limit(1);
      const detection = detectionRows[0];
      if (!detection) throw new Error('Detection not found');
      await authorizeDetectionActor(
        transaction,
        detection.workspaceId,
        detection.sourceSenderId,
        input.actorExternalUserId,
      );
      if (detection.status === 'REJECTED') return { idempotent: true };
      if (detection.status !== 'PENDING') throw new Error('Detection is no longer pending');
      await transaction
        .update(actionDetections)
        .set({ status: 'REJECTED', resolvedAt: new Date() })
        .where(eq(actionDetections.id, detection.id));
      return { idempotent: false };
    });
  }
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DetectionRow = typeof actionDetections.$inferSelect;

async function authorizeDetectionActor(
  transaction: Transaction,
  workspaceId: string,
  sourceSenderId: string,
  actorExternalUserId: string,
): Promise<string> {
  const rows = await transaction
    .select({ actorId: users.id })
    .from(users)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .where(
      and(
        eq(users.maxUserId, BigInt(actorExternalUserId)),
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  const actor = rows[0];
  if (!actor || actor.actorId !== sourceSenderId) throw new DetectionAccessDeniedError();
  return actor.actorId;
}

async function persistSourceMessages(
  transaction: Transaction,
  detection: DetectionRow,
  actionId: string,
): Promise<void> {
  for (const message of detection.sourceContextSnapshot) {
    const senderRows = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.maxUserId, BigInt(message.senderMaxUserId)))
      .limit(1);
    if (!senderRows[0]) continue;
    const rawOutput = detection.rawAiOutput;
    const attachments =
      message.messageId === detection.sourceMessageId &&
      Array.isArray(rawOutput.triggerAttachmentMetadata)
        ? (rawOutput.triggerAttachmentMetadata as Record<string, unknown>[])
        : [];
    await transaction
      .insert(sourceMessages)
      .values({
        actionId,
        chatId: detection.chatId,
        maxMessageId: message.messageId,
        senderId: senderRows[0].id,
        occurredAt: new Date(message.timestamp),
        text: message.text,
        attachmentMetadata: attachments,
      })
      .onConflictDoNothing();
  }
}

async function getExternalUserId(transaction: Transaction, userId: string): Promise<string> {
  const rows = await transaction
    .select({ maxUserId: users.maxUserId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!rows[0]) throw new Error('Assignee not found');
  return rows[0].maxUserId.toString();
}

async function getCreatorName(transaction: Transaction, userId: string): Promise<string> {
  const rows = await transaction
    .select({ firstName: users.firstName, lastName: users.lastName, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const creator = rows[0];
  if (!creator) throw new Error('Creator not found');
  return (
    [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim() ||
    creator.username ||
    'Без имени'
  );
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error('AI returned an invalid deadline timestamp');
  return date;
}
