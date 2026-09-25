import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { UpdateType } from '@maxhub/max-bot-api/types';

import type { RuntimeConfig } from '@hod/config';

import type { Database } from '../../infrastructure/db/client';
import type { ApplicationQueues } from '../../infrastructure/queue/queues';
import type { RedisConnection } from '../../infrastructure/redis/redis';
import { toSafeErrorLog } from '../../shared/logger';
import {
  DrizzleActionContextStore,
  DrizzleActionCreateRepository,
  DrizzleActionEditRepository,
  DrizzleActionLifecycleStore,
  DrizzleActionReadRepository,
  HandleActionCallbackUseCase,
  HandleActionReasonUseCase,
  QueueActionLifecycleNotifications,
  RedisActionReasonSessionStore,
  TransitionActionUseCase,
  TransitionActionWithNotificationUseCase,
} from '../../modules/actions';

import {
  BullMqDetectionMessaging,
  BullMqDetectionQueue,
  CompositeInboundChatEventHandler,
  DrizzleDetectionRepository,
  DrizzleDetectionManagementStore,
  HandleDetectionAssigneeUseCase,
  HandleDetectionCallbackUseCase,
  QueueMessageForDetectionUseCase,
  RedisConversationContext,
} from '../../modules/detections';
import { BullMqNotificationPublisher } from '../../modules/notifications';
import { DrizzleAttachmentStore, LocalProofStorage } from '../../modules/attachments';

import {
  DrizzlePersonalWorkspaceStore,
  HandlePersonalActionListUseCase,
  HandlePersonalActionMaterialsUseCase,
  HandlePersonalActionResultUseCase,
  HandlePersonalCreateUseCase,
  HandlePersonalActionsCallbackUseCase,
  HandlePersonalInboxUseCase,
  RedisPersonalActionEditSessionStore,
  RedisPersonalActionCreateSessionStore,
  RedisPersonalActionResultSessionStore,
} from '../../modules/personal';

import {
  DrizzleChatDirectoryStore,
  SynchronizeChatDirectoryUseCase,
  type InboundChatEvent,
  type InboundChatEventHandler,
} from '../../modules/workspaces';
import { MaxUpdateRouter } from '../../transport/max/max-update.router';
import { registerMaxWebhookRoute } from '../../transport/max/max-webhook.routes';
import { RedisUpdateDeduplicator } from '../../transport/max/update-deduplicator';
import { MaxChatDirectoryGateway } from './max-chat-directory.gateway';
import { ensureStartCommand } from './max-bot-commands';
import { MaxPersonalResultMaterialGateway } from './max-personal-result-material.gateway';

const allowedUpdates: UpdateType[] = [
  'bot_added',
  'bot_started',
  'bot_removed',
  'chat_title_changed',
  'user_added',
  'user_removed',
  'message_created',
  'message_callback',
];

export interface MaxRuntime {
  registerRoutes(app: FastifyInstance): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createMaxRuntime(
  config: RuntimeConfig,
  database: Database,
  redis: RedisConnection,
  queues: ApplicationQueues,
  logger: Logger,
): MaxRuntime | null {
  if (config.MAX_TRANSPORT === 'disabled') return null;
  if (!config.MAX_BOT_TOKEN) throw new Error('MAX bot token is required');
  const token = config.MAX_BOT_TOKEN;
  const webhookConfig =
    config.MAX_TRANSPORT === 'webhook'
      ? {
          publicUrl: config.MAX_WEBHOOK_PUBLIC_URL!,
          secret: config.MAX_WEBHOOK_SECRET!,
        }
      : null;
  const handlerReference: { current: InboundChatEventHandler | null } = { current: null };
  const delegatingHandler: InboundChatEventHandler = {
    handle(event: InboundChatEvent) {
      if (!handlerReference.current)
        return Promise.reject(new Error('MAX handler is not composed'));
      return handlerReference.current.handle(event);
    },
  };
  const notificationPublisher = new BullMqNotificationPublisher(queues.notification);
  const router = new MaxUpdateRouter(
    token,
    config.MAX_API_BASE_URL,
    delegatingHandler,
    new RedisUpdateDeduplicator(redis),
    logger,
  );
  const directory = new DrizzleChatDirectoryStore(database);
  const detectionRepository = new DrizzleDetectionRepository(database);
  const messaging = new BullMqDetectionMessaging(notificationPublisher);
  const actionContexts = new DrizzleActionContextStore(database);
  const actionReads = new DrizzleActionReadRepository(database);
  const actionEditor = new DrizzleActionEditRepository(database);
  const actionTransitions = new TransitionActionWithNotificationUseCase(
    new TransitionActionUseCase(new DrizzleActionLifecycleStore(database)),
    actionContexts,
    new QueueActionLifecycleNotifications(notificationPublisher),
  );
  const detectionQueue =
    config.AI_PROVIDER === 'disabled' ? null : new BullMqDetectionQueue(queues.detection);

  const personalStore = new DrizzlePersonalWorkspaceStore(database);

  const editSessions = new RedisPersonalActionEditSessionStore(redis);
  const createSessions = new RedisPersonalActionCreateSessionStore(redis);
  const resultSessions = new RedisPersonalActionResultSessionStore(redis);
  const reasonSessions = new RedisActionReasonSessionStore(redis);
  const resultMaterials = new MaxPersonalResultMaterialGateway(
    new DrizzleAttachmentStore(database),
    new LocalProofStorage(config.PROOF_STORAGE_PATH),
    config.PROOF_MAX_BYTES,
  );

  const downstreamHandlers: InboundChatEventHandler[] = [
    new HandleActionReasonUseCase(
      actionContexts,
      actionReads,
      actionTransitions,
      reasonSessions,
      notificationPublisher,
    ),
    new HandlePersonalActionResultUseCase(
      actionReads,
      actionContexts,
      actionTransitions,
      resultSessions,
      resultMaterials,
      notificationPublisher,
      createSessions,
      editSessions,
    ),
    new HandlePersonalCreateUseCase(
      personalStore,
      createSessions,
      editSessions,
      new DrizzleActionCreateRepository(database),
      notificationPublisher,
    ),
    new HandlePersonalInboxUseCase(
      personalStore,
      detectionQueue,
      notificationPublisher,
      config.WORKSPACE_DEFAULT_TIMEZONE,
      editSessions,
      actionEditor,
      createSessions,
      resultSessions,
      reasonSessions,
    ),

    new HandlePersonalActionListUseCase(personalStore, actionReads, notificationPublisher),

    new HandlePersonalActionMaterialsUseCase(actionContexts, actionReads, notificationPublisher),

    new HandlePersonalActionsCallbackUseCase(
      personalStore,
      actionReads,
      actionEditor,
      notificationPublisher,
      editSessions,
      actionContexts,
      config.WORKSPACE_DEFAULT_TIMEZONE,
    ),

    new HandleActionCallbackUseCase(actionContexts, actionTransitions),

    new HandleDetectionAssigneeUseCase(
      new DrizzleDetectionManagementStore(database),
      notificationPublisher,
    ),

    new HandleDetectionCallbackUseCase(detectionRepository, messaging, notificationPublisher),
  ];

  if (config.AI_PROVIDER !== 'disabled') {
    downstreamHandlers.unshift(
      new QueueMessageForDetectionUseCase(
        directory,
        new RedisConversationContext(redis),
        detectionQueue!,
      ),
    );
  }
  handlerReference.current = new SynchronizeChatDirectoryUseCase(
    directory,
    new MaxChatDirectoryGateway(router.bot.api),
    config.WORKSPACE_DEFAULT_TIMEZONE,
    new CompositeInboundChatEventHandler(downstreamHandlers),
  );

  let pollingTask: Promise<void> | null = null;

  return {
    registerRoutes(app) {
      if (config.MAX_TRANSPORT !== 'webhook') return;
      const publicUrl = new URL(webhookConfig!.publicUrl);
      registerMaxWebhookRoute(app, {
        path: publicUrl.pathname,
        secret: webhookConfig!.secret,
        router,
      });
    },
    async start() {
      router.bot.botInfo = await router.bot.api.getMyInfo();
      try {
        if (await ensureStartCommand(router.bot.api, router.bot.botInfo.commands)) {
          logger.info('MAX /start command registered');
        }
      } catch (error) {
        logger.warn({ err: toSafeErrorLog(error) }, 'Failed to register MAX /start command');
      }
      if (config.MAX_TRANSPORT === 'polling') {
        pollingTask = router.bot.startPolling({ allowedUpdates, retry: true });
        void pollingTask.catch((error: unknown) =>
          logger.error({ err: toSafeErrorLog(error) }, 'MAX polling stopped'),
        );
        return;
      }

      const { publicUrl, secret } = webhookConfig!;
      const subscriptions = await router.bot.api.getSubscriptions();
      if (subscriptions.some((subscription) => subscription.url === publicUrl)) {
        await router.bot.api.unsubscribe(publicUrl);
      }
      const result = await router.bot.api.subscribe(publicUrl, secret, allowedUpdates);
      if (!result.success) throw new Error(result.message ?? 'MAX webhook subscription failed');
    },
    async stop() {
      if (pollingTask) {
        router.bot.stopPolling();
        await pollingTask;
      }
    },
  };
}
