import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../infrastructure/db/client';
import { createPostgresConnection } from '../../../infrastructure/db/postgres';
import { actions, chats, users, workspaces } from '../../../infrastructure/db/schema';
import { DrizzleActionEditRepository } from './drizzle-action-edit.repository';

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

afterAll(async () => postgres.close());

describe('DrizzleActionEditRepository', () => {
  it('edits only active self-assigned tasks', async () => {
    const creatorId = randomUUID();
    const assigneeId = randomUUID();
    const workspaceId = randomUUID();
    const chatId = randomUUID();
    const selfActionId = randomUUID();
    const delegatedActionId = randomUUID();
    await database.insert(users).values([
      { id: creatorId, maxUserId: 101n, firstName: 'Иван' },
      { id: assigneeId, maxUserId: 102n, firstName: 'Анна' },
    ]);
    await database.insert(workspaces).values({
      id: workspaceId,
      name: 'Команда',
      ownerId: creatorId,
      settings: { timezone: 'Asia/Krasnoyarsk' },
    });
    await database.insert(chats).values({ id: chatId, workspaceId });
    await database.insert(actions).values([
      {
        id: selfActionId,
        workspaceId,
        creatorId,
        assigneeId: creatorId,
        title: 'Своё дело',
        sourceChatId: chatId,
        sourceMessageId: 'self',
        sourceContextSnapshot: [],
      },
      {
        id: delegatedActionId,
        workspaceId,
        creatorId,
        assigneeId,
        title: 'Порученное дело',
        sourceChatId: chatId,
        sourceMessageId: 'delegated',
        sourceContextSnapshot: [],
      },
    ]);

    const repository = new DrizzleActionEditRepository(database);
    expect(
      await repository.updateTitle({
        actionId: selfActionId,
        actorUserId: creatorId,
        title: 'Новое название',
      }),
    ).toBe(true);
    expect(
      await repository.updateTitle({
        actionId: delegatedActionId,
        actorUserId: creatorId,
        title: 'Изменённое поручение',
      }),
    ).toBe(false);
    expect(
      await repository.updateDescription({
        actionId: delegatedActionId,
        actorUserId: creatorId,
        description: 'Новое описание',
      }),
    ).toBe(false);
    expect(
      await repository.updateLocation({
        actionId: delegatedActionId,
        actorUserId: creatorId,
        location: 'Новое место',
      }),
    ).toBe(false);
    expect(
      await repository.updateDeadline({
        actionId: delegatedActionId,
        actorUserId: creatorId,
        deadlineKind: 'UNKNOWN',
        deadlineAt: null,
        deadlineDate: null,
        deadlineDependency: null,
        deadlineRaw: null,
      }),
    ).toBe(false);
    const stored = await database.select().from(actions).where(eq(actions.id, delegatedActionId));
    expect(stored[0]).toMatchObject({
      title: 'Порученное дело',
      description: null,
      location: null,
    });

    for (const status of ['DONE', 'VERIFIED', 'CANCELLED'] as const) {
      const actionId = randomUUID();
      await database.insert(actions).values({
        id: actionId,
        workspaceId,
        creatorId,
        assigneeId: creatorId,
        title: 'Исходное название',
        description: 'Исходное описание',
        location: 'Исходное место',
        status,
        sourceChatId: chatId,
        sourceMessageId: `terminal-${status}`,
        sourceContextSnapshot: [],
      });

      expect(
        await repository.updateTitle({ actionId, actorUserId: creatorId, title: 'Новое название' }),
      ).toBe(false);
      expect(
        await repository.updateDescription({
          actionId,
          actorUserId: creatorId,
          description: 'Новое описание',
        }),
      ).toBe(false);
      expect(
        await repository.updateLocation({
          actionId,
          actorUserId: creatorId,
          location: 'Новое место',
        }),
      ).toBe(false);
      expect(
        await repository.updateDeadline({
          actionId,
          actorUserId: creatorId,
          deadlineKind: 'DATE_ONLY',
          deadlineAt: null,
          deadlineDate: '2026-09-25',
          deadlineDependency: null,
          deadlineRaw: null,
        }),
      ).toBe(false);

      const [unchanged] = await database.select().from(actions).where(eq(actions.id, actionId));
      expect(unchanged).toMatchObject({
        title: 'Исходное название',
        description: 'Исходное описание',
        location: 'Исходное место',
        deadlineKind: 'UNKNOWN',
        deadlineDate: null,
      });
    }
  });
});
