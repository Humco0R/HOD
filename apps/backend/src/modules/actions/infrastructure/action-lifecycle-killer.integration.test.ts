import { resolve } from 'node:path';

import { count, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../infrastructure/db/client';
import { createPostgresConnection } from '../../../infrastructure/db/postgres';
import {
  actionEvents,
  actions,
  attachments,
  chats,
  users,
  workspaceMembers,
  workspaces,
} from '../../../infrastructure/db/schema';
import type { NotificationPublisher, OutboundNotification } from '../../notifications';
import { HandleActionCallbackUseCase } from '../application/handle-action-callback.usecase';
import { TransitionActionUseCase } from '../application/transition-action.usecase';
import { TransitionActionWithNotificationUseCase } from '../application/transition-action-with-notification.usecase';
import { DrizzleActionContextStore } from './drizzle-action-context.store';
import { DrizzleActionLifecycleStore } from './drizzle-action-lifecycle.store';
import { DrizzleActionReadRepository } from './drizzle-action-read.repository';
import { QueueActionLifecycleNotifications } from './queue-action-lifecycle.notifications';

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

class RecordingNotifications implements NotificationPublisher {
  readonly messages: Array<{ notification: OutboundNotification; idempotencyKey: string }> = [];

  publish(notification: OutboundNotification, idempotencyKey: string): Promise<void> {
    this.messages.push({ notification, idempotencyKey });
    return Promise.resolve();
  }
}

describe('Action lifecycle killer backend scenario', () => {
  it('automatically verifies a self-assigned result without a review notification', async () => {
    const [user] = await database
      .insert(users)
      .values({ maxUserId: 303n, firstName: 'Иван' })
      .returning();
    const [workspace] = await database
      .insert(workspaces)
      .values({
        name: 'Личные дела',
        ownerId: user!.id,
        settings: { timezone: 'Asia/Krasnoyarsk' },
      })
      .returning();
    await database
      .insert(workspaceMembers)
      .values({ workspaceId: workspace!.id, userId: user!.id, role: 'OWNER' });
    const [chat] = await database
      .insert(chats)
      .values({ workspaceId: workspace!.id, maxChatId: 88002n })
      .returning();
    const [action] = await database
      .insert(actions)
      .values({
        workspaceId: workspace!.id,
        creatorId: user!.id,
        assigneeId: user!.id,
        title: 'Моё дело',
        status: 'IN_PROGRESS',
        sourceChatId: chat!.id,
        sourceMessageId: 'self-review-source',
        sourceContextSnapshot: [],
      })
      .returning();
    const recording = new RecordingNotifications();
    const transitions = new TransitionActionWithNotificationUseCase(
      new TransitionActionUseCase(new DrizzleActionLifecycleStore(database)),
      new DrizzleActionContextStore(database),
      new QueueActionLifecycleNotifications(recording),
    );
    const reads = new DrizzleActionReadRepository(database);

    const request = {
      actionId: action!.id,
      workspaceId: workspace!.id,
      actorId: user!.id,
      idempotencyKey: 'self-submit',
      command: 'SUBMIT_RESULT' as const,
    };
    const submitted = await transitions.execute(request);
    expect(submitted.action.status).toBe('VERIFIED');
    expect((await reads.list(user!.id, 'created', new Date()))[0]?.status).toBe('VERIFIED');
    expect(recording.messages).toHaveLength(0);

    const retry = await transitions.execute(request);
    expect(retry.action.status).toBe('VERIFIED');
    expect(retry.idempotent).toBe(true);
    const [eventCount] = await database.select({ value: count() }).from(actionEvents);
    expect(eventCount?.value).toBe(2);
  });

  it('accepts, executes, blocks, returns and verifies with audit and notifications', async () => {
    const [creator, assignee] = await database
      .insert(users)
      .values([
        { maxUserId: 301n, firstName: 'Алексей' },
        { maxUserId: 302n, firstName: 'Антон' },
      ])
      .returning();
    const [workspace] = await database
      .insert(workspaces)
      .values({
        name: 'Сервисная команда',
        ownerId: creator!.id,
        settings: { timezone: 'Asia/Yekaterinburg' },
      })
      .returning();
    await database.insert(workspaceMembers).values([
      { workspaceId: workspace!.id, userId: creator!.id, role: 'OWNER' },
      { workspaceId: workspace!.id, userId: assignee!.id, role: 'MEMBER' },
    ]);
    const [chat] = await database
      .insert(chats)
      .values({ workspaceId: workspace!.id, maxChatId: 88001n })
      .returning();
    const [action] = await database
      .insert(actions)
      .values({
        workspaceId: workspace!.id,
        creatorId: creator!.id,
        assigneeId: assignee!.id,
        title: 'Проверить кондиционер',
        expectedResultType: 'PHOTO',
        sourceChatId: chat!.id,
        sourceMessageId: 'killer-source',
        sourceContextSnapshot: [],
      })
      .returning();
    const contexts = new DrizzleActionContextStore(database);
    const recording = new RecordingNotifications();
    const transitions = new TransitionActionWithNotificationUseCase(
      new TransitionActionUseCase(new DrizzleActionLifecycleStore(database)),
      contexts,
      new QueueActionLifecycleNotifications(recording),
    );
    const callbacks = new HandleActionCallbackUseCase(contexts, transitions);

    const callback = (operation: 'accept' | 'start' | 'verify' | 'cancel', actorId: string) => ({
      kind: 'message.callback' as const,
      eventId: `callback:${operation}-1`,
      occurredAt: new Date(),
      externalChatId: null,
      externalMessageId: null,
      actor: {
        externalUserId: actorId,
        firstName: actorId === '301' ? 'Алексей' : 'Антон',
        lastName: null,
        username: null,
      },
      payload: `hod:action:${operation}:${action!.id}`,
      callbackId: `${operation}-1`,
    });

    await callbacks.handle(callback('accept', '302'));
    await callbacks.handle(callback('accept', '302'));
    await callbacks.handle(callback('start', '302'));
    await transitions.execute({
      actionId: action!.id,
      workspaceId: workspace!.id,
      actorId: assignee!.id,
      idempotencyKey: 'block-1',
      command: 'BLOCK',
      reason: 'Жду запчасть',
    });
    await transitions.execute({
      actionId: action!.id,
      workspaceId: workspace!.id,
      actorId: assignee!.id,
      idempotencyKey: 'unblock-1',
      command: 'UNBLOCK',
    });
    await database.insert(attachments).values({
      workspaceId: workspace!.id,
      actionId: action!.id,
      uploadedById: assignee!.id,
      storageKey: 'proof/killer-photo.jpg',
      originalName: 'result.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 128,
      checksumSha256: 'a'.repeat(64),
    });
    await transitions.execute({
      actionId: action!.id,
      workspaceId: workspace!.id,
      actorId: assignee!.id,
      idempotencyKey: 'submit-1',
      command: 'SUBMIT_RESULT',
    });
    await transitions.execute({
      actionId: action!.id,
      workspaceId: workspace!.id,
      actorId: creator!.id,
      idempotencyKey: 'return-1',
      command: 'RETURN',
      reason: 'Нужно фото общего плана',
    });
    await transitions.execute({
      actionId: action!.id,
      workspaceId: workspace!.id,
      actorId: assignee!.id,
      idempotencyKey: 'submit-2',
      command: 'SUBMIT_RESULT',
      reason: 'Добавил второе фото',
    });
    await callbacks.handle(callback('verify', '301'));

    const [storedAction, eventCount] = await Promise.all([
      database.select().from(actions),
      database.select({ value: count() }).from(actionEvents),
    ]);
    expect(storedAction[0]?.status).toBe('VERIFIED');
    expect(storedAction[0]?.verifiedAt).toBeInstanceOf(Date);
    expect(eventCount[0]?.value).toBe(8);
    expect(recording.messages).toHaveLength(9);
    expect(recording.messages[4]?.notification).toMatchObject({
      target: { type: 'USER', externalId: '302' },
    });
    expect(recording.messages[5]?.notification).toMatchObject({
      target: { type: 'USER', externalId: '301' },
    });
    expect(recording.messages[6]?.notification.text).toContain('Нужно фото общего плана');
    expect(recording.messages[8]?.notification.text).toContain('Результат принят');

    await callbacks.handle(callback('cancel', '301'));
    const [deletedAction, deletedEvents, cancellationEvents] = await Promise.all([
      database.select().from(actions),
      database.select().from(actionEvents),
      database.select().from(actionEvents).where(eq(actionEvents.type, 'ACTION_CANCELLED')),
    ]);
    expect(deletedAction[0]?.status).toBe('CANCELLED');
    expect(deletedAction[0]?.verifiedAt).toEqual(storedAction[0]?.verifiedAt);
    expect(deletedEvents).toHaveLength(9);
    expect(cancellationEvents[0]).toMatchObject({
      type: 'ACTION_CANCELLED',
      fromStatus: 'VERIFIED',
      toStatus: 'CANCELLED',
    });
    await callbacks.handle({
      ...callback('cancel', '301'),
      callbackId: 'cancel-retry',
      eventId: 'callback:cancel-retry',
    });
    await expect(
      callbacks.handle({
        ...callback('cancel', '302'),
        callbackId: 'cancel-assignee',
        eventId: 'callback:cancel-assignee',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const afterRetry = await database
      .select({ value: count() })
      .from(actionEvents)
      .where(eq(actionEvents.type, 'ACTION_CANCELLED'));
    expect(afterRetry[0]?.value).toBe(1);
    const visibleActions = await new DrizzleActionReadRepository(database).list(
      assignee!.id,
      'assigned',
      new Date(),
    );
    expect(visibleActions).toEqual([]);
  });
});
