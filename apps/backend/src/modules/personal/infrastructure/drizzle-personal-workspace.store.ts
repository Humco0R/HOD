import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/client';
import { chats, users, workspaceMembers, workspaces } from '../../../infrastructure/db/schema';
import type {
  PersonalWorkspaceContext,
  PersonalWorkspaceStore,
} from '../application/personal-workspace.port';

export class DrizzlePersonalWorkspaceStore implements PersonalWorkspaceStore {
  constructor(private readonly database: Database) {}

  async findByExternalUserId(externalUserId: string): Promise<PersonalWorkspaceContext | null> {
    const rows = await this.database
      .select({
        workspaceId: workspaces.id,
        chatId: chats.id,
        userId: users.id,
        settings: workspaces.settings,
      })
      .from(users)
      .innerJoin(workspaces, eq(workspaces.ownerId, users.id))
      .innerJoin(chats, eq(chats.workspaceId, workspaces.id))
      .innerJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, users.id)),
      )
      .where(
        and(
          eq(users.maxUserId, BigInt(externalUserId)),
          eq(chats.context, 'DIALOG'),
          eq(workspaceMembers.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    const context = rows[0];
    return context
      ? {
          workspaceId: context.workspaceId,
          chatId: context.chatId,
          userId: context.userId,
          timezone: context.settings.timezone,
        }
      : null;
  }

  bootstrap(input: {
    externalDialogId: string | null;
    user: {
      externalUserId: string;
      firstName: string;
      lastName: string | null;
      username: string | null;
    };
    timezone: string;
  }): Promise<PersonalWorkspaceContext> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${'personal:' + input.user.externalUserId}, 0))`,
      );
      const userRows = await transaction
        .insert(users)
        .values({
          maxUserId: BigInt(input.user.externalUserId),
          firstName: input.user.firstName,
          lastName: input.user.lastName,
          username: input.user.username,
        })
        .onConflictDoUpdate({
          target: users.maxUserId,
          set: {
            firstName: input.user.firstName,
            lastName: input.user.lastName,
            username: input.user.username,
            updatedAt: new Date(),
          },
        })
        .returning({ id: users.id });
      const userId = userRows[0]!.id;

      const existing = await transaction
        .select({
          workspaceId: workspaces.id,
          chatId: chats.id,
          settings: workspaces.settings,
        })
        .from(workspaces)
        .innerJoin(chats, eq(chats.workspaceId, workspaces.id))
        .where(and(eq(workspaces.ownerId, userId), eq(chats.context, 'DIALOG')))
        .limit(1);
      if (existing[0]) {
        await transaction
          .update(chats)
          .set({
            ...(input.externalDialogId ? { maxChatId: BigInt(input.externalDialogId) } : {}),
            status: 'ACTIVE',
            updatedAt: new Date(),
          })
          .where(eq(chats.id, existing[0].chatId));
        await transaction
          .update(workspaceMembers)
          .set({ status: 'ACTIVE' })
          .where(
            and(
              eq(workspaceMembers.workspaceId, existing[0].workspaceId),
              eq(workspaceMembers.userId, userId),
            ),
          );
        return {
          workspaceId: existing[0].workspaceId,
          chatId: existing[0].chatId,
          userId,
          timezone: existing[0].settings.timezone,
        };
      }

      const workspaceRows = await transaction
        .insert(workspaces)
        .values({
          name: `${input.user.firstName} — личные дела`,
          ownerId: userId,
          settings: { timezone: input.timezone },
        })
        .returning({ id: workspaces.id });
      const workspaceId = workspaceRows[0]!.id;
      const chatRows = await transaction
        .insert(chats)
        .values({
          workspaceId,
          maxChatId: input.externalDialogId ? BigInt(input.externalDialogId) : null,
          context: 'DIALOG',
          title: 'Личные дела',
          botHasReadAccess: true,
          status: 'ACTIVE',
        })
        .returning({ id: chats.id });
      await transaction.insert(workspaceMembers).values({
        workspaceId,
        userId,
        role: 'OWNER',
        status: 'ACTIVE',
      });
      return {
        workspaceId,
        chatId: chatRows[0]!.id,
        userId,
        timezone: input.timezone,
      };
    });
  }
}
