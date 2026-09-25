import { resolve } from 'node:path';

import { count, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../infrastructure/db/client';
import { createPostgresConnection } from '../../../infrastructure/db/postgres';
import {
  actionEvents,
  actions,
  chats,
  users,
  workspaceMembers,
  workspaces,
} from '../../../infrastructure/db/schema';
import { TransitionActionUseCase } from '../application/transition-action.usecase';
import { DrizzleActionLifecycleStore } from './drizzle-action-lifecycle.store';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for integration tests');
}

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

describe('DrizzleActionLifecycleStore', () => {
  it('supports several chats in one workspace and persists an idempotent transition', async () => {
    const [creator, assignee] = await database
      .insert(users)
      .values([
        { maxUserId: 101n, firstName: 'Алексей' },
        { maxUserId: 102n, firstName: 'Антон' },
      ])
      .returning();
    const [workspace] = await database
      .insert(workspaces)
      .values({
        name: 'Сервисная команда',
        ownerId: creator!.id,
        settings: { timezone: 'Europe/Moscow' },
      })
      .returning();
    await database.insert(workspaceMembers).values([
      { workspaceId: workspace!.id, userId: creator!.id, role: 'OWNER' },
      { workspaceId: workspace!.id, userId: assignee!.id, role: 'MEMBER' },
    ]);
    const insertedChats = await database
      .insert(chats)
      .values([
        { workspaceId: workspace!.id, maxChatId: 201n, title: 'Монтажники' },
        { workspaceId: workspace!.id, maxChatId: 202n, title: 'Сервис' },
      ])
      .returning();
    const [action] = await database
      .insert(actions)
      .values({
        workspaceId: workspace!.id,
        creatorId: creator!.id,
        assigneeId: assignee!.id,
        title: 'Проверить кондиционер',
        expectedResultType: 'PHOTO',
        sourceChatId: insertedChats[0]!.id,
        sourceMessageId: 'mid.1',
        sourceContextSnapshot: [],
      })
      .returning();
    const useCase = new TransitionActionUseCase(new DrizzleActionLifecycleStore(database));
    const request = {
      actionId: action!.id,
      workspaceId: workspace!.id,
      actorId: assignee!.id,
      idempotencyKey: 'callback-accept-1',
      command: 'ACCEPT' as const,
    };

    const results = await Promise.all([useCase.execute(request), useCase.execute(request)]);
    const eventCount = await database
      .select({ value: count() })
      .from(actionEvents)
      .where(eq(actionEvents.actionId, action!.id));

    expect(insertedChats).toHaveLength(2);
    expect(results.map((result) => result.action.status)).toEqual(['ACCEPTED', 'ACCEPTED']);
    expect(results.map((result) => result.idempotent).sort()).toEqual([false, true]);
    expect(eventCount[0]?.value).toBe(1);
  });

  it('does not resolve an action through another workspace', async () => {
    const [creator, assignee] = await database
      .insert(users)
      .values([
        { maxUserId: 301n, firstName: 'Ольга' },
        { maxUserId: 302n, firstName: 'Игорь' },
      ])
      .returning();
    const [workspace, otherWorkspace] = await database
      .insert(workspaces)
      .values([
        { name: 'A', ownerId: creator!.id, settings: { timezone: 'UTC' } },
        { name: 'B', ownerId: creator!.id, settings: { timezone: 'UTC' } },
      ])
      .returning();
    const [chat] = await database
      .insert(chats)
      .values({ workspaceId: workspace!.id, maxChatId: 401n })
      .returning();
    const [action] = await database
      .insert(actions)
      .values({
        workspaceId: workspace!.id,
        creatorId: creator!.id,
        assigneeId: assignee!.id,
        title: 'Изолированное дело',
        sourceChatId: chat!.id,
        sourceMessageId: 'mid.isolated',
        sourceContextSnapshot: [],
      })
      .returning();
    const useCase = new TransitionActionUseCase(new DrizzleActionLifecycleStore(database));

    await expect(
      useCase.execute({
        actionId: action!.id,
        workspaceId: otherWorkspace!.id,
        actorId: assignee!.id,
        idempotencyKey: 'wrong-workspace',
        command: 'ACCEPT',
      }),
    ).rejects.toThrow('Action not found in workspace');
  });
});
