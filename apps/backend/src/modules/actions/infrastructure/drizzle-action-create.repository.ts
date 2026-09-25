import { and, eq } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/client';
import { actions, actionEvents, chats, workspaceMembers } from '../../../infrastructure/db/schema';
import type { ActionCreatePort, CreateActionInput } from '../application/action-create.port';

export class DrizzleActionCreateRepository implements ActionCreatePort {
  constructor(private readonly database: Database) {}

  async exists(actionId: string, actorUserId: string): Promise<boolean> {
    const rows = await this.database
      .select({ id: actions.id })
      .from(actions)
      .where(and(eq(actions.id, actionId), eq(actions.creatorId, actorUserId)))
      .limit(1);
    return rows.length > 0;
  }

  create(input: CreateActionInput): Promise<{ actionId: string; created: boolean }> {
    return this.database.transaction(async (transaction) => {
      const membership = await transaction
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .innerJoin(chats, eq(chats.workspaceId, workspaceMembers.workspaceId))
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.actorUserId),
            eq(workspaceMembers.status, 'ACTIVE'),
            eq(chats.id, input.chatId),
            eq(chats.context, 'DIALOG'),
            eq(chats.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      if (!membership[0]) throw new Error('Personal workspace is unavailable');

      const inserted = await transaction
        .insert(actions)
        .values({
          id: input.id,
          workspaceId: input.workspaceId,
          creatorId: input.actorUserId,
          assigneeId: input.actorUserId,
          title: input.title,
          description: input.description,
          status: 'NEW',
          deadlineKind: input.deadlineKind,
          deadlineDate: input.deadlineDate,
          deadlineAt: input.deadlineAt,
          deadlineRaw: input.deadlineRaw,
          expectedResultType: 'NONE',
          sourceChatId: input.chatId,
          sourceMessageId: `manual:${input.id}`,
          sourceContextSnapshot: [],
        })
        .onConflictDoNothing({ target: actions.id })
        .returning({ id: actions.id });
      if (inserted[0]) {
        await transaction.insert(actionEvents).values({
          actionId: inserted[0].id,
          workspaceId: input.workspaceId,
          actorId: input.actorUserId,
          type: 'ACTION_CREATED',
          fromStatus: null,
          toStatus: 'NEW',
          idempotencyKey: `manual-create:${input.id}`,
          metadata: { source: 'PERSONAL_BOT' },
        });
        return { actionId: inserted[0].id, created: true };
      }

      const existing = await transaction
        .select({ id: actions.id, workspaceId: actions.workspaceId, creatorId: actions.creatorId })
        .from(actions)
        .where(eq(actions.id, input.id))
        .limit(1);
      if (
        !existing[0] ||
        existing[0].workspaceId !== input.workspaceId ||
        existing[0].creatorId !== input.actorUserId
      ) {
        throw new Error('Action creation conflict could not be resolved');
      }
      return { actionId: existing[0].id, created: false };
    });
  }
}
