import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { Queue, QueueEvents, Worker } from 'bullmq';
import { count, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FakeAiDetectionAdapter } from '../../../integrations/ai/fake-ai-detection.adapter';
import { createDatabase } from '../../../infrastructure/db/client';
import { createPostgresConnection } from '../../../infrastructure/db/postgres';
import {
  actionDetections,
  actions,
  chats,
  outboxEvents,
  workspaceMembers,
  workspaces,
} from '../../../infrastructure/db/schema';
import { closeRedis, createRedisConnection } from '../../../infrastructure/redis/redis';
import {
  DrizzleActionEditRepository,
  DrizzleActionReadRepository,
  DrizzleActionReminderStore,
  ScheduleActionRemindersUseCase,
} from '../../actions';
import {
  BullMqDetectionMessaging,
  BullMqDetectionQueue,
  DetectActionUseCase,
  DrizzleDetectionRepository,
  DrizzleDetectionWorkspaceContext,
  HandleDetectionCallbackUseCase,
  type DetectionJob,
} from '../../detections';
import {
  BullMqNotificationPublisher,
  notificationJobId,
  type OutboundNotification,
} from '../../notifications';
import { HandlePersonalInboxUseCase } from '../application/handle-personal-inbox.usecase';
import { DrizzlePersonalWorkspaceStore } from './drizzle-personal-workspace.store';
import { RedisPersonalActionEditSessionStore } from './redis-personal-action-edit-session.store';
import { RedisPersonalActionCreateSessionStore } from './redis-personal-action-create-session.store';
import { RedisPersonalActionResultSessionStore } from './redis-personal-action-result-session.store';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl) {
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required for integration tests');
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

afterAll(async () => postgres.close());

describe('personal forwarded-message vertical slice', () => {
  it('bootstraps once, proposes to the user, confirms once, and exposes the Action to Mini App/reminders', async () => {
    const queueConnection = createRedisConnection(redisUrl, true);
    const workerConnection = createRedisConnection(redisUrl, true);
    const eventConnection = createRedisConnection(redisUrl, true);
    const detectionQueue = new Queue<DetectionJob>('detection', {
      connection: queueConnection,
      prefix: 'hod',
    });
    const notificationQueue = new Queue<OutboundNotification>('notification', {
      connection: queueConnection,
      prefix: 'hod',
    });
    const queueEvents = new QueueEvents('detection', {
      connection: eventConnection,
      prefix: 'hod',
    });
    const repository = new DrizzleDetectionRepository(database);
    const messaging = new BullMqDetectionMessaging(
      new BullMqNotificationPublisher(notificationQueue),
    );
    const detector = new DetectActionUseCase(
      new FakeAiDetectionAdapter(),
      repository,
      messaging,
      new DrizzleDetectionWorkspaceContext(database),
      { high: 0.85, medium: 0.6 },
    );
    const worker = new Worker<DetectionJob>('detection', (job) => detector.execute(job.data), {
      connection: workerConnection,
      prefix: 'hod',
    });

    try {
      const store = new DrizzlePersonalWorkspaceStore(database);
      const notifications = new BullMqNotificationPublisher(notificationQueue);
      const inbox = new HandlePersonalInboxUseCase(
        store,
        new BullMqDetectionQueue(detectionQueue),
        notifications,
        'Asia/Krasnoyarsk',
        new RedisPersonalActionEditSessionStore(queueConnection),
        new DrizzleActionEditRepository(database),
        new RedisPersonalActionCreateSessionStore(queueConnection),
        new RedisPersonalActionResultSessionStore(queueConnection),
        {
          get: () => Promise.resolve(null),
          set: () => Promise.resolve(),
          clear: () => Promise.resolve(),
        },
      );
      const actor = {
        externalUserId: '42001',
        firstName: 'Иван',
        lastName: 'Петров',
        username: 'ivan',
      };
      const started = {
        kind: 'personal.started' as const,
        eventId: `bot_started:${randomUUID()}`,
        occurredAt: new Date('2026-09-21T08:00:00.000Z'),
        externalDialogId: '92001',
        actor,
      };
      await inbox.handle(started);
      await inbox.handle({ ...started, eventId: `bot_started:${randomUUID()}` });

      const [workspaceCount, chatRows, membershipCount] = await Promise.all([
        database.select({ value: count() }).from(workspaces),
        database.select().from(chats),
        database.select({ value: count() }).from(workspaceMembers),
      ]);
      expect(workspaceCount[0]?.value).toBe(1);
      expect(chatRows).toHaveLength(1);
      expect(chatRows[0]?.context).toBe('DIALOG');
      expect(membershipCount[0]?.value).toBe(1);

      const eventId = `message:${randomUUID()}`;
      const sourceMessageId = randomUUID();
      await inbox.handle({
        kind: 'personal.message.created',
        eventId,
        occurredAt: new Date('2026-09-21T08:01:00.000Z'),
        externalMessageId: sourceMessageId,
        author: actor,
        text: null,
        attachmentMetadata: [],
        forwardedMessage: {
          messageId: 'original-1',
          text: 'Проверь кондиционер и пришли фото',
          attachmentMetadata: [],
        },
      });
      const jobId = createHash('sha256').update(eventId).digest('hex');
      await (await detectionQueue.getJob(jobId))!.waitUntilFinished(queueEvents, 10_000);

      const detections = await database.select().from(actionDetections);
      expect(detections).toHaveLength(1);
      const personal = await store.findByExternalUserId(actor.externalUserId);
      expect(detections[0]?.suggestedAssigneeId).toBe(personal?.userId);
      const proposal = await notificationQueue.getJob(
        notificationJobId(`proposal-${detections[0]!.id}`),
      );
      expect(proposal?.data.target).toEqual({ type: 'USER', externalId: '42001' });

      const callbacks = new HandleDetectionCallbackUseCase(repository, messaging);
      const callback = {
        kind: 'message.callback' as const,
        eventId: 'callback:personal-confirm-1',
        occurredAt: new Date('2026-09-21T08:02:00.000Z'),
        externalChatId: null,
        externalMessageId: 'proposal-message',
        actor,
        payload: `hod:detection:confirm:${detections[0]!.id}`,
        callbackId: 'personal-confirm-1',
      };
      await callbacks.handle(callback);
      await callbacks.handle(callback);

      const storedActions = await database.select().from(actions);
      expect(storedActions).toHaveLength(1);
      expect(storedActions[0]).toMatchObject({
        creatorId: personal?.userId,
        assigneeId: personal?.userId,
      });
      const visible = await new DrizzleActionReadRepository(database).list(
        personal!.userId,
        'assigned',
        new Date('2026-09-21T08:03:00.000Z'),
      );
      expect(visible.map((action) => action.id)).toEqual([storedActions[0]!.id]);

      await database
        .update(actions)
        .set({
          deadlineKind: 'EXACT_DATETIME',
          deadlineAt: new Date('2026-09-21T08:30:00.000Z'),
        })
        .where(eq(actions.id, storedActions[0]!.id));
      await new ScheduleActionRemindersUseCase(new DrizzleActionReminderStore(database)).execute(
        new Date('2026-09-21T08:00:00.000Z'),
        60,
      );
      const reminders = await database
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.topic, 'ACTION_REMINDER_REQUESTED'));
      expect(reminders).toHaveLength(1);
    } finally {
      await worker.close();
      await queueEvents.close();
      await detectionQueue.close();
      await notificationQueue.close();
      await Promise.all([
        closeRedis(queueConnection),
        closeRedis(workerConnection),
        closeRedis(eventConnection),
      ]);
    }
  });
});
