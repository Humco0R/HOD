import { UnrecoverableError, Worker } from 'bullmq';
import type { Logger } from 'pino';

import type { RuntimeConfig } from '@hod/config';

import { FakeAiDetectionAdapter } from '../../integrations/ai/fake-ai-detection.adapter';
import {
  GigaChatDetectionAdapter,
  GigaChatDetectionError,
} from '../../integrations/ai/gigachat-detection.adapter';
import { ApplicationOutboxHandler } from '../../integrations/outbox/application-outbox.handler';
import {
  MaxNotificationGateway,
  RedisMaxScreenStore,
} from '../../integrations/max/max-notification.gateway';
import {
  DrizzleActionContextStore,
  DrizzleActionReminderStore,
  QueueActionLifecycleNotifications,
  QueueActionReminderNotifications,
  ScheduleActionRemindersUseCase,
} from '../../modules/actions';
import { DrizzleAttachmentStore, LocalProofStorage } from '../../modules/attachments';
import {
  BullMqDetectionMessaging,
  DetectActionUseCase,
  DrizzleDetectionRepository,
  DrizzleDetectionWorkspaceContext,
  RedisRecentGroupTaskGuard,
  type DetectionJob,
} from '../../modules/detections';
import {
  BullMqNotificationPublisher,
  DispatchOutboxUseCase,
  DrizzleOutboxStore,
  type OutboundNotification,
} from '../../modules/notifications';
import { toSafeErrorLog } from '../../shared/logger';
import type { Database } from '../db/client';
import { closeRedis, createRedisConnection, type RedisConnection } from '../redis/redis';
import type { ApplicationQueues } from './queues';

export interface ApplicationWorkers {
  close(): Promise<void>;
}

export function createApplicationWorkers(
  config: RuntimeConfig,
  database: Database,
  queues: ApplicationQueues,
  logger: Logger,
): ApplicationWorkers {
  const workers: Worker[] = [];
  const connections: RedisConnection[] = [];
  const timers: NodeJS.Timeout[] = [];
  const recurringRuns = new Set<Promise<void>>();
  let closing = false;

  const notificationPublisher = new BullMqNotificationPublisher(queues.notification);
  const detectionMessaging = new BullMqDetectionMessaging(notificationPublisher);
  const actionContexts = new DrizzleActionContextStore(database);
  const outboxStore = new DrizzleOutboxStore(database);
  const outboxDispatcher = new DispatchOutboxUseCase(
    outboxStore,
    new ApplicationOutboxHandler(
      detectionMessaging,
      actionContexts,
      new QueueActionLifecycleNotifications(notificationPublisher),
      new QueueActionReminderNotifications(notificationPublisher),
    ),
  );
  const reminders = new ScheduleActionRemindersUseCase(new DrizzleActionReminderStore(database));

  scheduleExclusive(
    'outbox',
    config.OUTBOX_POLL_INTERVAL_MS,
    async () => {
      const result = await outboxDispatcher.execute();
      if (result.failed) logger.warn(result, 'Outbox dispatch had failed events');
    },
    timers,
    recurringRuns,
    () => closing,
    logger,
  );
  scheduleExclusive(
    'reminders',
    config.REMINDER_SCAN_INTERVAL_SECONDS * 1_000,
    async () => {
      await reminders.execute(new Date(), config.REMINDER_LEAD_MINUTES);
    },
    timers,
    recurringRuns,
    () => closing,
    logger,
  );
  scheduleExclusive(
    'outbox-cleanup',
    60 * 60_000,
    async () => {
      const before = new Date(Date.now() - config.OUTBOX_RETENTION_DAYS * 24 * 60 * 60_000);
      await outboxStore.cleanupPublished(before);
    },
    timers,
    recurringRuns,
    () => closing,
    logger,
  );

  if (config.AI_PROVIDER === 'fake' || config.AI_PROVIDER === 'gigachat') {
    const connection = createRedisConnection(config.REDIS_URL, true);
    connections.push(connection);
    const ai =
      config.AI_PROVIDER === 'fake'
        ? new FakeAiDetectionAdapter()
        : new GigaChatDetectionAdapter(
            {
              credentials: config.GIGACHAT_CREDENTIALS!,
              scope: config.GIGACHAT_SCOPE,
              model: config.GIGACHAT_MODEL,
              baseUrl: config.GIGACHAT_BASE_URL,
              timeoutMs: config.GIGACHAT_TIMEOUT_MS,
            },
            undefined,
            logger,
          );
    const useCase = new DetectActionUseCase(
      ai,
      new DrizzleDetectionRepository(database),
      detectionMessaging,
      new DrizzleDetectionWorkspaceContext(database),
      {
        high: config.AI_HIGH_CONFIDENCE_THRESHOLD,
        medium: config.AI_MEDIUM_CONFIDENCE_THRESHOLD,
      },
      new RedisRecentGroupTaskGuard(connection),
    );
    workers.push(
      new Worker<DetectionJob>(
        'detection',
        async (job) => {
          try {
            return await useCase.execute(job.data);
          } catch (error) {
            if (error instanceof GigaChatDetectionError) {
              throw new UnrecoverableError(error.message);
            }
            throw error;
          }
        },
        {
          connection,
          prefix: 'hod',
          concurrency: 4,
        },
      ),
    );
  }

  if (config.MAX_TRANSPORT !== 'disabled' && config.MAX_BOT_TOKEN) {
    const connection = createRedisConnection(config.REDIS_URL, true);
    connections.push(connection);
    const gateway = new MaxNotificationGateway(
      config.MAX_BOT_TOKEN,
      config.MAX_API_BASE_URL,
      config.MAX_MINIAPP_BOT_NAME,
      new DrizzleAttachmentStore(database),
      new LocalProofStorage(config.PROOF_STORAGE_PATH),
      new RedisMaxScreenStore(connection),
      logger,
    );
    workers.push(
      new Worker<OutboundNotification>('notification', async (job) => gateway.send(job.data), {
        connection,
        prefix: 'hod',
        concurrency: 2,
        limiter: { max: config.MAX_RATE_LIMIT_PER_SECOND, duration: 1_000 },
      }),
    );
  }

  for (const worker of workers) {
    worker.on('error', (error) =>
      logger.error({ err: toSafeErrorLog(error) }, 'Queue worker error'),
    );
    worker.on('failed', (job, error) =>
      logger.warn(
        { err: toSafeErrorLog(error), jobId: job?.id, queue: worker.name },
        'Queue job failed',
      ),
    );
  }

  return {
    async close() {
      closing = true;
      for (const timer of timers) clearInterval(timer);
      await Promise.allSettled([...recurringRuns]);
      await Promise.allSettled(workers.map(async (worker) => worker.close()));
      await Promise.allSettled(connections.map(async (connection) => closeRedis(connection)));
    },
  };
}

function scheduleExclusive(
  name: string,
  intervalMilliseconds: number,
  task: () => Promise<void>,
  timers: NodeJS.Timeout[],
  recurringRuns: Set<Promise<void>>,
  isClosing: () => boolean,
  logger: Logger,
): void {
  let running = false;
  const run = (): void => {
    if (running || isClosing()) return;
    running = true;
    const execution = task()
      .catch((error: unknown) => {
        logger.error({ err: toSafeErrorLog(error), task: name }, 'Recurring worker task failed');
      })
      .finally(() => {
        running = false;
        recurringRuns.delete(execution);
      });
    recurringRuns.add(execution);
  };
  run();
  timers.push(setInterval(run, intervalMilliseconds));
}
