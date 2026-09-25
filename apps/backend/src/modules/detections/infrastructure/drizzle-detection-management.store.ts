import { and, eq } from 'drizzle-orm';

import type { DetectionDetail, DetectionEdit } from '@hod/contracts';

import type { Database } from '../../../infrastructure/db/client';
import { actionDetections, users, workspaceMembers } from '../../../infrastructure/db/schema';
import { DetectionAccessDeniedError } from '../domain/detection-access-denied.error';

export class DrizzleDetectionManagementStore {
  constructor(private readonly database: Database) {}

  async getForExternalUser(
    detectionId: string,
    externalUserId: string,
  ): Promise<DetectionDetail | null> {
    const userId = await this.userIdForExternal(externalUserId);
    return userId ? this.get(detectionId, userId) : null;
  }

  async chooseAssignee(
    detectionId: string,
    externalUserId: string,
    assigneeId: string,
  ): Promise<void> {
    const userId = await this.userIdForExternal(externalUserId);
    if (!userId) throw new DetectionAccessDeniedError();
    await this.database.transaction(async (transaction) => {
      const rows = await transaction
        .select({ detection: actionDetections })
        .from(actionDetections)
        .where(eq(actionDetections.id, detectionId))
        .for('update')
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error('Detection not found');
      const memberships = await transaction
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, row.detection.workspaceId),
            eq(workspaceMembers.userId, userId),
            eq(workspaceMembers.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      if (!memberships[0] || userId !== row.detection.sourceSenderId)
        throw new DetectionAccessDeniedError();
      if (row.detection.status !== 'PENDING') throw new Error('Detection is no longer pending');
      const assignees = await transaction
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, row.detection.workspaceId),
            eq(workspaceMembers.userId, assigneeId),
            eq(workspaceMembers.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      if (!assignees[0]) throw new Error('Assignee is not an active workspace member');
      await transaction
        .update(actionDetections)
        .set({ suggestedAssigneeId: assigneeId })
        .where(eq(actionDetections.id, detectionId));
    });
  }

  private async userIdForExternal(externalUserId: string): Promise<string | null> {
    if (!/^\d+$/.test(externalUserId)) return null;
    const rows = await this.database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.maxUserId, BigInt(externalUserId)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async get(detectionId: string, userId: string): Promise<DetectionDetail | null> {
    const detection = await this.getAuthorized(detectionId, userId);
    if (!detection) return null;
    const members = await this.database
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, detection.workspaceId),
          eq(workspaceMembers.status, 'ACTIVE'),
        ),
      );
    return {
      id: detection.id,
      title: detection.title,
      assigneeId: detection.suggestedAssigneeId,
      deadlineKind: detection.deadlineKind,
      deadlineAt: detection.suggestedDeadlineAt?.toISOString() ?? null,
      deadlineDate: detection.suggestedDeadlineDate,
      deadlineDependency: detection.suggestedDeadlineDependency,
      deadlineRaw: detection.suggestedDeadlineRaw,
      expectedResultType: detection.expectedResultType,
      expectedResultText: detection.expectedResultText,
      location: detection.location,
      status: detection.status,
      members,
    };
  }

  update(detectionId: string, userId: string, edit: DetectionEdit): Promise<void> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .select({ detection: actionDetections })
        .from(actionDetections)
        .where(eq(actionDetections.id, detectionId))
        .for('update')
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error('Detection not found');
      const memberships = await transaction
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, row.detection.workspaceId),
            eq(workspaceMembers.userId, userId),
            eq(workspaceMembers.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      if (!memberships[0] || userId !== row.detection.sourceSenderId)
        throw new DetectionAccessDeniedError();
      if (row.detection.status !== 'PENDING') throw new Error('Detection is no longer pending');
      const assignees = await transaction
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, row.detection.workspaceId),
            eq(workspaceMembers.userId, edit.assigneeId),
            eq(workspaceMembers.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      if (!assignees[0]) throw new Error('Assignee is not an active workspace member');

      await transaction
        .update(actionDetections)
        .set({
          title: edit.title,
          suggestedAssigneeId: edit.assigneeId,
          deadlineKind: edit.deadlineKind,
          suggestedDeadlineAt:
            edit.deadlineKind === 'EXACT_DATETIME' && edit.deadlineAt
              ? new Date(edit.deadlineAt)
              : null,
          suggestedDeadlineDate: edit.deadlineKind === 'DATE_ONLY' ? edit.deadlineDate : null,
          suggestedDeadlineDependency:
            edit.deadlineKind === 'DEPENDENCY' ? edit.deadlineDependency : null,
          suggestedDeadlineRaw: edit.deadlineRaw,
          expectedResultType: edit.expectedResultType,
          expectedResultText: edit.expectedResultText,
          location: edit.location,
        })
        .where(eq(actionDetections.id, detectionId));
    });
  }

  private async getAuthorized(detectionId: string, userId: string) {
    const rows = await this.database
      .select({ detection: actionDetections })
      .from(actionDetections)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, actionDetections.workspaceId))
      .where(
        and(
          eq(actionDetections.id, detectionId),
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row || userId !== row.detection.sourceSenderId) return null;
    return row.detection;
  }
}
