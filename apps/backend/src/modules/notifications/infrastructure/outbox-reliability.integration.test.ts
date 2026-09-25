import { resolve } from 'node:path';

import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ApplicationOutboxHandler } from '../../../integrations/outbox/application-outbox.handler';
import { createDatabase } from '../../../infrastructure/db/client';
import { createPostgresConnection } from '../../../infrastructure/db/postgres';
import {
  actions,
  chats,
  outboxEvents,
  users,
  workspaceMembers,
  workspaces,
} from '../../../infrastructure/db/schema';
import {
  DrizzleActionContextStore,
  DrizzleActionLifecycleStore,
  DrizzleActionReminderStore,
  QueueActionLifecycleNotifications,
  QueueActionReminderNotifications,
  ScheduleActionRemindersUseCase,
  TransitionActionUseCase,
  TransitionActionWithNotificationUseCase,
} from '../../actions';
import { BullMqDetectionMessaging } from '../../detections';
import type { NotificationPublisher, OutboundNotification } from '../application/notification.port';
import { DispatchOutboxUseCase } from '../application/dispatch-outbox.usecase';
import { DrizzleOutboxStore } from './drizzle-outbox.store';

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

describe('transactional outbox and reminders', () => {
  it('recovers a notification after the domain commit succeeded but direct queueing failed', async () => {
    const seed = await seedAction({ status: 'IN_PROGRESS' });
    const contexts = new DrizzleActionContextStore(database);
    const transitions = new TransitionActionWithNotificationUseCase(
      new TransitionActionUseCase(new DrizzleActionLifecycleStore(database)),
      contexts,
      new QueueActionLifecycleNotifications(new FailingPublisher()),
    );

    await expect(
      transitions.execute({
        actionId: seed.actionId,
        workspaceId: seed.workspaceId,
        actorId: seed.assigneeId,
        idempotencyKey: 'submit-with-outage',
        command: 'SUBMIT_RESULT',
        reason: 'Готово',
      }),
    ).rejects.toThrow('queue unavailable');

    const [storedAction] = await database.select().from(actions);
    const [pending] = await database.select().from(outboxEvents);
    expect(storedAction?.status).toBe('DONE');
    expect(pending).toMatchObject({
      status: 'PENDING',
      topic: 'ACTION_TRANSITION_NOTIFICATION_REQUESTED',
    });

    const recording = new RecordingPublisher();
    const dispatcher = createDispatcher(recording, contexts);
    await expect(dispatcher.execute()).resolves.toEqual({ published: 1, failed: 0 });
    await expect(dispatcher.execute()).resolves.toEqual({ published: 0, failed: 0 });
    expect(recording.messages).toHaveLength(1);
    expect(recording.messages[0]?.notification.text).toContain('Дело поступило на проверку');
    const [published] = await database.select().from(outboxEvents);
    expect(published?.status).toBe('PUBLISHED');
  });

  it('uses PostgreSQL deadlines as reminder source of truth and deduplicates scans', async () => {
    const seed = await seedAction({
      status: 'IN_PROGRESS',
      deadlineAt: new Date('2026-09-20T12:30:00.000Z'),
    });
    await database.insert(actions).values([
      {
        workspaceId: seed.workspaceId,
        creatorId: seed.creatorId,
        assigneeId: seed.assigneeId,
        title: 'Дата без времени',
        deadlineKind: 'DATE_ONLY',
        deadlineDate: '2026-09-20',
        sourceChatId: seed.chatId,
        sourceMessageId: 'date-only',
        sourceContextSnapshot: [],
      },
      {
        workspaceId: seed.workspaceId,
        creatorId: seed.creatorId,
        assigneeId: seed.assigneeId,
        title: 'Слишком рано',
        deadlineKind: 'EXACT_DATETIME',
        deadlineAt: new Date('2026-09-20T15:00:00.000Z'),
        sourceChatId: seed.chatId,
        sourceMessageId: 'future',
        sourceContextSnapshot: [],
      },
    ]);
    const reminders = new ScheduleActionRemindersUseCase(new DrizzleActionReminderStore(database));
    const now = new Date('2026-09-20T12:00:00.000Z');
    await reminders.execute(now, 60);
    await reminders.execute(now, 60);
    const stored = await database.select().from(outboxEvents);
    expect(stored).toHaveLength(2);
    expect(stored.every(({ topic }) => topic === 'ACTION_REMINDER_REQUESTED')).toBe(true);
  });

  it('backs off malformed events without logging their payload', async () => {
    const [event] = await database
      .insert(outboxEvents)
      .values({ topic: 'UNKNOWN', dedupeKey: 'unknown-1', payload: { secret: 'do-not-log' } })
      .returning();
    const dispatcher = createDispatcher(
      new RecordingPublisher(),
      new DrizzleActionContextStore(database),
    );
    const dispatchAt = new Date(event!.createdAt.valueOf() + 1_000);
    await expect(dispatcher.execute(dispatchAt)).resolves.toEqual({ published: 0, failed: 1 });
    const [failed] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, event!.id));
    expect(failed).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(failed?.availableAt.valueOf()).toBeGreaterThan(Date.now());
    expect(failed?.lastError).not.toContain('do-not-log');
  });

  it('claims each event once across concurrent dispatchers and recovers stale locks', async () => {
    await database.insert(outboxEvents).values([
      { topic: 'TEST', dedupeKey: 'pending-once', payload: {} },
      {
        topic: 'TEST',
        dedupeKey: 'stale-lock',
        payload: {},
        status: 'PROCESSING',
        lockedAt: new Date('2026-09-20T10:00:00.000Z'),
      },
    ]);
    const now = new Date('2030-09-20T12:00:00.000Z');
    const first = new DrizzleOutboxStore(database);
    const second = new DrizzleOutboxStore(database);
    const claims = await Promise.all([first.claimBatch(now, 10), second.claimBatch(now, 10)]);
    expect(claims.flat()).toHaveLength(2);
    expect(new Set(claims.flat().map(({ id }) => id)).size).toBe(2);
  });
});

class FailingPublisher implements NotificationPublisher {
  publish(): Promise<void> {
    return Promise.reject(new Error('queue unavailable'));
  }
}

class RecordingPublisher implements NotificationPublisher {
  readonly messages: Array<{ notification: OutboundNotification; idempotencyKey: string }> = [];
  publish(notification: OutboundNotification, idempotencyKey: string): Promise<void> {
    this.messages.push({ notification, idempotencyKey });
    return Promise.resolve();
  }
}

function createDispatcher(publisher: NotificationPublisher, contexts: DrizzleActionContextStore) {
  return new DispatchOutboxUseCase(
    new DrizzleOutboxStore(database),
    new ApplicationOutboxHandler(
      new BullMqDetectionMessaging(publisher),
      contexts,
      new QueueActionLifecycleNotifications(publisher),
      new QueueActionReminderNotifications(publisher),
    ),
  );
}

async function seedAction(input: { status: 'IN_PROGRESS'; deadlineAt?: Date }) {
  const [creator, assignee] = await database
    .insert(users)
    .values([
      { maxUserId: 901n, firstName: 'Алексей' },
      { maxUserId: 902n, firstName: 'Антон' },
    ])
    .returning();
  const [workspace] = await database
    .insert(workspaces)
    .values({
      name: 'Reliability',
      ownerId: creator!.id,
      settings: { timezone: 'Asia/Krasnoyarsk' },
    })
    .returning();
  await database.insert(workspaceMembers).values([
    { workspaceId: workspace!.id, userId: creator!.id, role: 'OWNER' },
    { workspaceId: workspace!.id, userId: assignee!.id, role: 'MEMBER' },
  ]);
  const [chat] = await database
    .insert(chats)
    .values({ workspaceId: workspace!.id, maxChatId: 9901n })
    .returning();
  const [action] = await database
    .insert(actions)
    .values({
      workspaceId: workspace!.id,
      creatorId: creator!.id,
      assigneeId: assignee!.id,
      title: 'Надёжное дело',
      status: input.status,
      deadlineKind: input.deadlineAt ? 'EXACT_DATETIME' : 'UNKNOWN',
      deadlineAt: input.deadlineAt,
      expectedResultType: 'NONE',
      sourceChatId: chat!.id,
      sourceMessageId: 'reliability-source',
      sourceContextSnapshot: [],
    })
    .returning();
  return {
    actionId: action!.id,
    workspaceId: workspace!.id,
    creatorId: creator!.id,
    assigneeId: assignee!.id,
    chatId: chat!.id,
  };
}
