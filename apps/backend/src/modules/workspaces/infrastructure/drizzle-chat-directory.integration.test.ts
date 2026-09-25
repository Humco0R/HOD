import { resolve } from 'node:path';

import { count, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../infrastructure/db/client';
import { createPostgresConnection } from '../../../infrastructure/db/postgres';
import { chats, users, workspaceMembers, workspaces } from '../../../infrastructure/db/schema';
import type { ExternalChatSnapshot } from '../application/chat-directory.port';
import { DrizzleChatDirectoryStore } from './drizzle-chat-directory.store';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for integration tests');

const postgres = createPostgresConnection(databaseUrl);
const database = createDatabase(postgres.pool);

beforeAll(async () => {
  await migrate(database, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
});

beforeEach(async () => {
  await postgres.pool.query(
    'TRUNCATE outbox_events, attachments, action_events, source_messages, actions, action_detections, chats, workspace_members, workspaces, users RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await postgres.close();
});

describe('DrizzleChatDirectoryStore', () => {
  it('atomically bootstraps one workspace for a chat and keeps all members', async () => {
    const store = new DrizzleChatDirectoryStore(database);
    const owner = { externalUserId: '42', firstName: 'Ольга', lastName: null, username: 'olga' };
    const snapshot: ExternalChatSnapshot = {
      externalChatId: '77001',
      title: 'Сервисная бригада',
      status: 'ACTIVE',
      botHasReadAccess: true,
      ownerExternalUserId: '41',
      members: [
        { externalUserId: '41', firstName: 'Иван', lastName: null, username: null },
        { externalUserId: '43', firstName: 'Антон', lastName: null, username: null },
      ],
    };

    const contexts = await Promise.all([
      store.bootstrapChat({ snapshot, owner, timezone: 'Asia/Yekaterinburg' }),
      store.bootstrapChat({ snapshot, owner, timezone: 'Asia/Yekaterinburg' }),
    ]);
    const [workspaceCount, chatCount, memberCount, ownerMembership] = await Promise.all([
      database.select({ value: count() }).from(workspaces),
      database.select({ value: count() }).from(chats),
      database.select({ value: count() }).from(workspaceMembers),
      database
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(eq(users.maxUserId, 42n)),
    ]);

    expect(contexts[0]).toEqual(contexts[1]);
    expect(workspaceCount[0]?.value).toBe(1);
    expect(chatCount[0]?.value).toBe(1);
    expect(memberCount[0]?.value).toBe(3);
    expect(ownerMembership[0]?.role).toBe('OWNER');
  });

  it('reactivates and removes a known workspace member', async () => {
    const store = new DrizzleChatDirectoryStore(database);
    const owner = { externalUserId: '51', firstName: 'Лев', lastName: null, username: null };
    const snapshot: ExternalChatSnapshot = {
      externalChatId: '77002',
      title: null,
      status: 'ACTIVE',
      botHasReadAccess: false,
      ownerExternalUserId: '51',
      members: [owner],
    };
    await store.bootstrapChat({ snapshot, owner, timezone: 'UTC' });

    await store.activateMember('77002', {
      externalUserId: '52',
      firstName: 'Марк',
      lastName: null,
      username: null,
    });
    await store.removeMember('77002', '52');

    const rows = await database
      .select({ status: workspaceMembers.status })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(users.maxUserId, 52n));
    expect(rows[0]?.status).toBe('REMOVED');
  });
});
