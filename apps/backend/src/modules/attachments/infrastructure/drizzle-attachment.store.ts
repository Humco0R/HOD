import { and, eq } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/client';
import { actions, attachments, workspaceMembers } from '../../../infrastructure/db/schema';
import type {
  AttachmentStore,
  AttachmentUploadContext,
  StoredAttachment,
} from '../application/attachment-store.port';

export class DrizzleAttachmentStore implements AttachmentStore {
  constructor(private readonly database: Database) {}

  async getUploadContext(
    actionId: string,
    userId: string,
  ): Promise<AttachmentUploadContext | null> {
    const rows = await this.database
      .select({
        workspaceId: actions.workspaceId,
        actionId: actions.id,
        uploaderId: workspaceMembers.userId,
        assigneeId: actions.assigneeId,
        status: actions.status,
      })
      .from(actions)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, actions.workspaceId))
      .where(
        and(
          eq(actions.id, actionId),
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (
      !row ||
      row.assigneeId !== userId ||
      (row.status !== 'IN_PROGRESS' && row.status !== 'BLOCKED')
    ) {
      return null;
    }
    return { workspaceId: row.workspaceId, actionId: row.actionId, uploaderId: row.uploaderId };
  }

  async create(input: {
    context: AttachmentUploadContext;
    storageKey: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string;
  }): Promise<{ id: string }> {
    const rows = await this.database
      .insert(attachments)
      .values({
        workspaceId: input.context.workspaceId,
        actionId: input.context.actionId,
        uploadedById: input.context.uploaderId,
        storageKey: input.storageKey,
        originalName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        checksumSha256: input.checksumSha256,
      })
      .returning({ id: attachments.id });
    return rows[0]!;
  }

  async getForDownload(attachmentId: string, userId: string): Promise<StoredAttachment | null> {
    const rows = await this.database
      .select({
        id: attachments.id,
        storageKey: attachments.storageKey,
        originalName: attachments.originalName,
        mimeType: attachments.mimeType,
      })
      .from(attachments)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, attachments.workspaceId))
      .where(
        and(
          eq(attachments.id, attachmentId),
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async removeOwn(actionId: string, attachmentId: string, userId: string): Promise<string | null> {
    const context = await this.getUploadContext(actionId, userId);
    if (!context) return null;
    const rows = await this.database
      .delete(attachments)
      .where(
        and(
          eq(attachments.id, attachmentId),
          eq(attachments.actionId, actionId),
          eq(attachments.uploadedById, userId),
        ),
      )
      .returning({ storageKey: attachments.storageKey });
    return rows[0]?.storageKey ?? null;
  }
}
