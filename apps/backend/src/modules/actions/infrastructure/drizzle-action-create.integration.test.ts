import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../infrastructure/db/client';
import { createPostgresConnection } from '../../../infrastructure/db/postgres';
import { actionEvents, actions } from '../../../infrastructure/db/schema';
import { DrizzlePersonalWorkspaceStore } from '../../personal';
import { DrizzleActionCreateRepository } from './drizzle-action-create.repository';

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

describe('DrizzleActionCreateRepository', () => {
  it('creates one personal Action and one audit event on repeated confirmation', async () => {
    const personal = await new DrizzlePersonalWorkspaceStore(database).bootstrap({
      externalDialogId: '90001',
      user: { externalUserId: '42001', firstName: 'Иван', lastName: null, username: null },
      timezone: 'Asia/Krasnoyarsk',
    });
    const repository = new DrizzleActionCreateRepository(database);
    const input = {
      id: randomUUID(),
      workspaceId: personal.workspaceId,
      chatId: personal.chatId,
      actorUserId: personal.userId,
      title: 'Подготовить презентацию',
      description: 'К защите проекта',
      deadlineKind: 'DATE_ONLY' as const,
      deadlineDate: '2026-09-25',
      deadlineAt: null,
      deadlineRaw: '25.09.2026',
    };

    expect(await repository.create(input)).toEqual({ actionId: input.id, created: true });
    expect(await repository.create(input)).toEqual({ actionId: input.id, created: false });
    expect(await repository.exists(input.id, personal.userId)).toBe(true);

    const storedActions = await database.select().from(actions);
    const events = await database.select().from(actionEvents);
    expect(storedActions).toHaveLength(1);
    expect(storedActions[0]).toMatchObject({
      id: input.id,
      creatorId: personal.userId,
      assigneeId: personal.userId,
      title: input.title,
      description: input.description,
      deadlineDate: '2026-09-25',
      sourceMessageId: `manual:${input.id}`,
      status: 'NEW',
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actionId: input.id, type: 'ACTION_CREATED' });
  });

  it('refuses creation with a user outside the personal workspace', async () => {
    const store = new DrizzlePersonalWorkspaceStore(database);
    const owner = await store.bootstrap({
      externalDialogId: '90001',
      user: { externalUserId: '42001', firstName: 'Иван', lastName: null, username: null },
      timezone: 'Asia/Krasnoyarsk',
    });
    const outsider = await store.bootstrap({
      externalDialogId: '90002',
      user: { externalUserId: '42002', firstName: 'Пётр', lastName: null, username: null },
      timezone: 'Asia/Krasnoyarsk',
    });
    const repository = new DrizzleActionCreateRepository(database);

    await expect(
      repository.create({
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        chatId: owner.chatId,
        actorUserId: outsider.userId,
        title: 'Чужое дело',
        description: null,
        deadlineKind: 'UNKNOWN',
        deadlineDate: null,
        deadlineAt: null,
        deadlineRaw: null,
      }),
    ).rejects.toThrow('Personal workspace is unavailable');
    expect(await database.select().from(actions)).toHaveLength(0);
  });
});
