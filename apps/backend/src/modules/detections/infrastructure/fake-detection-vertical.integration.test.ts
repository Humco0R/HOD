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
  actionEvents,
  actions,
  chats,
  sourceMessages,
  users,
  workspaceMembers,
  workspaces,
} from '../../../infrastructure/db/schema';
import { closeRedis, createRedisConnection } from '../../../infrastructure/redis/redis';
import {
  BullMqNotificationPublisher,
  notificationJobId,
  type OutboundNotification,
} from '../../notifications';
import { DrizzleChatDirectoryStore } from '../../workspaces';
import { DetectActionUseCase } from '../application/detect-action.usecase';
import { HandleDetectionCallbackUseCase } from '../application/handle-detection-callback.usecase';
import { QueueMessageForDetectionUseCase } from '../application/queue-message-for-detection.usecase';
import type { DetectionJob } from '../domain/detection';
import { BullMqDetectionMessaging, BullMqDetectionQueue } from './bullmq-detection.adapters';
import { DrizzleDetectionRepository } from './drizzle-detection.repository';
import { DrizzleDetectionManagementStore } from './drizzle-detection-management.store';
import { DrizzleDetectionWorkspaceContext } from './drizzle-detection-workspace-context';
import { RedisConversationContext } from './redis-conversation-context';
import { RedisRecentGroupTaskGuard } from './redis-recent-group-task.guard';

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

afterAll(async () => {
  await postgres.close();
});

describe('fake detection vertical slice', () => {
  it('claims one of four repeated messages and keeps authors and chats separate', async () => {
    const connection = createRedisConnection(redisUrl);
    const guard = new RedisRecentGroupTaskGuard(connection);
    const baseJob: DetectionJob = {
      sourceMode: 'GROUP_CHAT',
      assignmentStrategy: 'RESOLVE_FROM_TEXT',
      proposalTarget: { type: 'CHAT', externalId: '77003' },
      workspaceId: randomUUID(),
      chatId: randomUUID(),
      externalChatId: '77003',
      sourceMessageId: randomUUID(),
      sourceSenderId: randomUUID(),
      sourceSenderExternalId: '101',
      occurredAt: new Date().toISOString(),
      text: 'Илья, надо доделать бота сегодня',
      attachmentMetadata: [],
      context: [],
    };
    const repeated = Array.from({ length: 4 }, (_, index) => ({
      ...baseJob,
      sourceMessageId: randomUUID(),
      text:
        index % 2 === 0
          ? 'Илья, надо доделать бота сегодня'
          : '  ИЛЬЯ, надо   доделать бота сегодня  ',
    }));
    try {
      const claims = await Promise.all(repeated.map((job) => guard.claim(job)));
      expect(claims.filter(Boolean)).toHaveLength(1);
      const winner = repeated[claims.findIndex(Boolean)]!;
      expect(await guard.claim(winner)).toBe(true);
      expect(await guard.claim({ ...baseJob, sourceMessageId: randomUUID() })).toBe(false);
      expect(
        await guard.claim({
          ...baseJob,
          sourceMessageId: randomUUID(),
          sourceSenderId: randomUUID(),
        }),
      ).toBe(true);
      expect(
        await guard.claim({ ...baseJob, sourceMessageId: randomUUID(), chatId: randomUUID() }),
      ).toBe(true);
      await guard.release(winner);
      expect(await guard.claim({ ...baseJob, sourceMessageId: randomUUID() })).toBe(true);
    } finally {
      await closeRedis(connection);
    }
  });

  it('runs message → BullMQ → proposal → confirmation → Action without duplicates', async () => {
    const queueConnection = createRedisConnection(redisUrl, true);
    const workerConnection = createRedisConnection(redisUrl, true);
    const eventConnection = createRedisConnection(redisUrl, true);
    const contextConnection = createRedisConnection(redisUrl);
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
      new RedisRecentGroupTaskGuard(contextConnection),
    );
    const worker = new Worker<DetectionJob>(
      'detection',
      async (job) => detector.execute(job.data),
      {
        connection: workerConnection,
        prefix: 'hod',
        concurrency: 4,
      },
    );

    try {
      await contextConnection.del('context:max-chat:77003');
      const [owner, assignee] = await database
        .insert(users)
        .values([
          { maxUserId: 101n, firstName: 'Алексей', username: 'alexey' },
          { maxUserId: 102n, firstName: 'Антон', username: 'anton' },
        ])
        .returning();
      const [workspace] = await database
        .insert(workspaces)
        .values({
          name: 'Сервисная команда',
          ownerId: owner!.id,
          settings: { timezone: 'Asia/Yekaterinburg' },
        })
        .returning();
      await database.insert(workspaceMembers).values([
        { workspaceId: workspace!.id, userId: owner!.id, role: 'OWNER' },
        { workspaceId: workspace!.id, userId: assignee!.id, role: 'MEMBER' },
      ]);
      await database.insert(chats).values({
        workspaceId: workspace!.id,
        maxChatId: 77003n,
        title: 'Монтажники',
      });

      const messageId = randomUUID();
      const eventId = `message:${messageId}`;
      const queueUseCase = new QueueMessageForDetectionUseCase(
        new DrizzleChatDirectoryStore(database),
        new RedisConversationContext(contextConnection),
        new BullMqDetectionQueue(detectionQueue),
      );
      await queueUseCase.handle({
        kind: 'message.created',
        eventId,
        occurredAt: new Date('2026-09-20T08:00:00.000Z'),
        externalChatId: '77003',
        externalMessageId: messageId,
        author: {
          externalUserId: '101',
          firstName: 'Алексей',
          lastName: null,
          username: 'alexey',
        },
        text: 'Антон, завтра после Кирова заедь на Пушкина, проверь кондиционер и пришли фото.',
        attachmentMetadata: [],
      });

      const duplicateEventIds = Array.from({ length: 3 }, () => `message:${randomUUID()}`);
      for (const duplicateEventId of duplicateEventIds) {
        await queueUseCase.handle({
          kind: 'message.created',
          eventId: duplicateEventId,
          occurredAt: new Date('2026-09-20T08:00:01.000Z'),
          externalChatId: '77003',
          externalMessageId: duplicateEventId.slice('message:'.length),
          author: {
            externalUserId: '101',
            firstName: 'Алексей',
            lastName: null,
            username: 'alexey',
          },
          text: '  АНТОН, завтра после Кирова заедь на Пушкина, проверь кондиционер и пришли фото.  ',
          attachmentMetadata: [],
        });
      }
      for (const queuedEventId of [eventId, ...duplicateEventIds]) {
        const jobId = createHash('sha256').update(queuedEventId).digest('hex');
        const queuedJob = await detectionQueue.getJob(jobId);
        expect(queuedJob).not.toBeNull();
        await queuedJob!.waitUntilFinished(queueEvents, 10_000);
      }

      const detections = await database.select().from(actionDetections);
      expect(detections).toHaveLength(1);
      expect(detections[0]).toMatchObject({
        title: 'Проверить кондиционер',
        suggestedAssigneeId: assignee!.id,
        deadlineKind: 'DEPENDENCY',
        suggestedDeadlineDependency: 'после Кирова',
        expectedResultType: 'PHOTO',
        location: 'Пушкина',
        status: 'PENDING',
      });
      const proposal = await notificationQueue.getJob(
        notificationJobId(`proposal-${detections[0]!.id}`),
      );
      expect(proposal?.data.buttons[0]?.payload).toBe(`hod:detection:confirm:${detections[0]!.id}`);

      const callbacks = new HandleDetectionCallbackUseCase(repository, messaging);
      const callbackEvent = {
        kind: 'message.callback' as const,
        eventId: 'callback:confirm-1',
        occurredAt: new Date('2026-09-20T08:01:00.000Z'),
        externalChatId: '77003',
        externalMessageId: 'proposal-message',
        actor: {
          externalUserId: '101',
          firstName: 'Алексей',
          lastName: null,
          username: 'alexey',
        },
        payload: `hod:detection:confirm:${detections[0]!.id}`,
        callbackId: 'confirm-1',
      };
      await callbacks.handle(callbackEvent);
      await callbacks.handle(callbackEvent);

      const [actionCount, eventCount, sourceCount, acceptedDetection] = await Promise.all([
        database.select({ value: count() }).from(actions),
        database.select({ value: count() }).from(actionEvents),
        database.select({ value: count() }).from(sourceMessages),
        database
          .select({ status: actionDetections.status })
          .from(actionDetections)
          .where(eq(actionDetections.id, detections[0]!.id)),
      ]);
      expect(actionCount[0]?.value).toBe(1);
      expect(eventCount[0]?.value).toBe(1);
      expect(sourceCount[0]?.value).toBeGreaterThanOrEqual(1);
      expect(acceptedDetection[0]?.status).toBe('ACCEPTED');
      const assignment = await notificationQueue.getJob(
        notificationJobId(`assignment-${(await database.select().from(actions))[0]!.id}`),
      );
      expect(assignment?.data.text).toContain('Постановщик: Алексей');
    } finally {
      await worker.close();
      await queueEvents.close();
      await detectionQueue.close();
      await notificationQueue.close();
      await Promise.all([
        closeRedis(queueConnection),
        closeRedis(workerConnection),
        closeRedis(eventConnection),
        closeRedis(contextConnection),
      ]);
    }
  });

  it('does not guess an ambiguous assignee and authorizes only the source author', async () => {
    const [owner, author, antonOne, antonTwo, outsider] = await database
      .insert(users)
      .values([
        { maxUserId: 201n, firstName: 'Ольга' },
        { maxUserId: 202n, firstName: 'Павел' },
        { maxUserId: 203n, firstName: 'Антон' },
        { maxUserId: 204n, firstName: 'Антон' },
        { maxUserId: 205n, firstName: 'Игорь' },
      ])
      .returning();
    const [workspace] = await database
      .insert(workspaces)
      .values({ name: 'Команда', ownerId: owner!.id, settings: { timezone: 'UTC' } })
      .returning();
    await database.insert(workspaceMembers).values(
      [owner, author, antonOne, antonTwo, outsider].map((user) => ({
        workspaceId: workspace!.id,
        userId: user!.id,
        role: user!.id === owner!.id ? ('OWNER' as const) : ('MEMBER' as const),
      })),
    );
    const [chat] = await database
      .insert(chats)
      .values({ workspaceId: workspace!.id, maxChatId: 77004n })
      .returning();
    const repository = new DrizzleDetectionRepository(database);
    const ambiguous = await repository.resolveAssignee(workspace!.id, 'Антон');
    expect(ambiguous).toEqual({ status: 'AMBIGUOUS', userId: null });

    const baseJob: DetectionJob = {
      sourceMode: 'GROUP_CHAT',
      assignmentStrategy: 'RESOLVE_FROM_TEXT',
      proposalTarget: { type: 'CHAT', externalId: '77004' },
      workspaceId: workspace!.id,
      chatId: chat!.id,
      externalChatId: '77004',
      sourceMessageId: 'ambiguous-message',
      sourceSenderId: author!.id,
      sourceSenderExternalId: '202',
      occurredAt: '2026-09-20T09:00:00.000Z',
      text: 'Антон, проверь объект',
      attachmentMetadata: [],
      context: [
        {
          messageId: 'ambiguous-message',
          senderMaxUserId: '202',
          timestamp: '2026-09-20T09:00:00.000Z',
          text: 'Антон, проверь объект',
        },
      ],
    };
    const candidate = await new FakeAiDetectionAdapter().detect({
      job: baseJob,
      timezone: 'UTC',
      members: [],
    });
    const unresolvedDetection = await repository.create({
      job: baseJob,
      candidate,
      assignee: ambiguous,
    });
    await expect(
      repository.confirm({
        detectionId: unresolvedDetection.detectionId,
        actorExternalUserId: '202',
        idempotencyKey: 'ambiguous-confirm',
      }),
    ).rejects.toThrow('assignee must be resolved');

    const management = new DrizzleDetectionManagementStore(database);
    expect(
      (await management.getForExternalUser(unresolvedDetection.detectionId, '202'))?.members,
    ).toHaveLength(5);
    expect(await management.getForExternalUser(unresolvedDetection.detectionId, '205')).toBeNull();
    expect(await management.getForExternalUser(unresolvedDetection.detectionId, '201')).toBeNull();
    await expect(
      management.chooseAssignee(unresolvedDetection.detectionId, '205', antonOne!.id),
    ).rejects.toThrow('Only the source author');
    await expect(
      management.chooseAssignee(unresolvedDetection.detectionId, '201', antonOne!.id),
    ).rejects.toThrow('Only the source author');
    await expect(
      repository.reject({
        detectionId: unresolvedDetection.detectionId,
        actorExternalUserId: '201',
      }),
    ).rejects.toThrow('Only the source author');
    await management.chooseAssignee(unresolvedDetection.detectionId, '202', antonOne!.id);
    expect(
      (await management.getForExternalUser(unresolvedDetection.detectionId, '202'))?.assigneeId,
    ).toBe(antonOne!.id);
    const chosen = await repository.confirm({
      detectionId: unresolvedDetection.detectionId,
      actorExternalUserId: '202',
      idempotencyKey: 'ambiguous-confirm-after-selection',
    });
    expect(chosen.assigneeExternalUserId).toBe('203');

    const uniqueCandidate = { ...candidate, assigneeReference: 'Игорь' };
    const resolved = await repository.resolveAssignee(workspace!.id, 'Игорь');
    const resolvableDetection = await repository.create({
      job: { ...baseJob, sourceMessageId: 'authorized-message' },
      candidate: uniqueCandidate,
      assignee: resolved,
    });
    await expect(
      repository.confirm({
        detectionId: resolvableDetection.detectionId,
        actorExternalUserId: '205',
        idempotencyKey: 'unauthorized-confirm',
      }),
    ).rejects.toThrow('Only the source author');

    await expect(
      repository.confirm({
        detectionId: resolvableDetection.detectionId,
        actorExternalUserId: '201',
        idempotencyKey: 'owner-confirm',
      }),
    ).rejects.toThrow('Only the source author');
    const confirmed = await repository.confirm({
      detectionId: resolvableDetection.detectionId,
      actorExternalUserId: '202',
      idempotencyKey: 'author-confirm',
    });
    expect(confirmed).toMatchObject({ idempotent: false, assigneeExternalUserId: '205' });

    const rejectedJob = {
      ...baseJob,
      sourceMessageId: 'rejected-message',
      context: [{ ...baseJob.context[0]!, messageId: 'rejected-message' }],
    };
    const toReject = await repository.create({
      job: rejectedJob,
      candidate: uniqueCandidate,
      assignee: resolved,
    });
    const rejected = await repository.reject({
      detectionId: toReject.detectionId,
      actorExternalUserId: '202',
    });
    expect(rejected).toEqual({ idempotent: false });
  });
});
