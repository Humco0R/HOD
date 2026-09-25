import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/client';
import { chats, users, workspaceMembers, workspaces } from '../../../infrastructure/db/schema';
import type {
  ChatDirectoryContext,
  ChatDirectoryStore,
  ChatParticipantContext,
  ExternalChatSnapshot,
  ExternalUserProfile,
} from '../application/chat-directory.port';

export class DrizzleChatDirectoryStore implements ChatDirectoryStore {
  constructor(private readonly database: Database) {}

  async findByExternalChatId(externalChatId: string): Promise<ChatDirectoryContext | null> {
    const rows = await this.database
      .select({ chatId: chats.id, workspaceId: chats.workspaceId })
      .from(chats)
      .where(and(eq(chats.maxChatId, BigInt(externalChatId)), eq(chats.context, 'GROUP')))
      .limit(1);
    return rows[0] ?? null;
  }

  async findParticipant(
    externalChatId: string,
    externalUserId: string,
  ): Promise<ChatParticipantContext | null> {
    const rows = await this.database
      .select({ chatId: chats.id, workspaceId: chats.workspaceId, userId: users.id })
      .from(chats)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, chats.workspaceId))
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(
          eq(chats.maxChatId, BigInt(externalChatId)),
          eq(chats.context, 'GROUP'),
          eq(users.maxUserId, BigInt(externalUserId)),
          eq(workspaceMembers.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  bootstrapChat(input: {
    snapshot: ExternalChatSnapshot;
    owner: ExternalUserProfile;
    timezone: string;
  }): Promise<ChatDirectoryContext> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.snapshot.externalChatId}, 0))`,
      );

      const existing = await transaction
        .select({ chatId: chats.id, workspaceId: chats.workspaceId })
        .from(chats)
        .where(
          and(
            eq(chats.maxChatId, BigInt(input.snapshot.externalChatId)),
            eq(chats.context, 'GROUP'),
          ),
        )
        .limit(1);
      if (existing[0]) return existing[0];

      const ownerId = await upsertUser(transaction, input.owner);
      const workspaceRows = await transaction
        .insert(workspaces)
        .values({
          name: input.snapshot.title ?? `MAX chat ${input.snapshot.externalChatId}`,
          ownerId,
          settings: { timezone: input.timezone },
        })
        .returning({ id: workspaces.id });
      const workspaceId = workspaceRows[0]!.id;

      const chatRows = await transaction
        .insert(chats)
        .values({
          workspaceId,
          maxChatId: BigInt(input.snapshot.externalChatId),
          context: 'GROUP',
          title: input.snapshot.title,
          botHasReadAccess: input.snapshot.botHasReadAccess,
          status: input.snapshot.status,
        })
        .returning({ id: chats.id });

      const memberIds = new Map<string, string>([[input.owner.externalUserId, ownerId]]);
      for (const member of input.snapshot.members) {
        memberIds.set(member.externalUserId, await upsertUser(transaction, member));
      }

      await transaction.insert(workspaceMembers).values(
        [...memberIds.entries()].map(([externalUserId, userId]) => ({
          workspaceId,
          userId,
          role:
            externalUserId === input.owner.externalUserId
              ? ('OWNER' as const)
              : ('MEMBER' as const),
          status: 'ACTIVE' as const,
        })),
      );

      return { workspaceId, chatId: chatRows[0]!.id };
    });
  }

  async activateMember(externalChatId: string, user: ExternalUserProfile): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const context = await findChat(transaction, externalChatId);
      if (!context) throw new Error('Chat is not registered');
      const userId = await upsertUser(transaction, user);
      await transaction
        .insert(workspaceMembers)
        .values({ workspaceId: context.workspaceId, userId, role: 'MEMBER', status: 'ACTIVE' })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
          set: { status: 'ACTIVE' },
        });
    });
  }

  async removeMember(externalChatId: string, externalUserId: string): Promise<void> {
    const context = await this.findByExternalChatId(externalChatId);
    if (!context) return;
    const matchedUsers = await this.database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.maxUserId, BigInt(externalUserId)))
      .limit(1);
    if (!matchedUsers[0]) return;
    await this.database
      .update(workspaceMembers)
      .set({ status: 'REMOVED' })
      .where(
        and(
          eq(workspaceMembers.workspaceId, context.workspaceId),
          eq(workspaceMembers.userId, matchedUsers[0].id),
        ),
      );
  }

  async updateChat(input: {
    externalChatId: string;
    title?: string;
    status?: ExternalChatSnapshot['status'];
  }): Promise<void> {
    await this.database
      .update(chats)
      .set({ title: input.title, status: input.status, updatedAt: new Date() })
      .where(and(eq(chats.maxChatId, BigInt(input.externalChatId)), eq(chats.context, 'GROUP')));
  }
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function findChat(
  transaction: Transaction,
  externalChatId: string,
): Promise<ChatDirectoryContext | null> {
  const rows = await transaction
    .select({ chatId: chats.id, workspaceId: chats.workspaceId })
    .from(chats)
    .where(and(eq(chats.maxChatId, BigInt(externalChatId)), eq(chats.context, 'GROUP')))
    .limit(1);
  return rows[0] ?? null;
}

async function upsertUser(transaction: Transaction, user: ExternalUserProfile): Promise<string> {
  const rows = await transaction
    .insert(users)
    .values({
      maxUserId: BigInt(user.externalUserId),
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
    })
    .onConflictDoUpdate({
      target: users.maxUserId,
      set: {
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        updatedAt: new Date(),
      },
    })
    .returning({ id: users.id });
  return rows[0]!.id;
}
