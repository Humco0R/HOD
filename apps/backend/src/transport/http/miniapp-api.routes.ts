import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { RuntimeConfig } from '@hod/config';
import {
  actionDetailSchema,
  actionListResponseSchema,
  createActionRequestSchema,
  createActionResponseSchema,
  currentUserSchema,
  detectionDetailSchema,
  detectionEditSchema,
  transitionActionRequestSchema,
} from '@hod/contracts';

import type { Database } from '../../infrastructure/db/client';
import type { ApplicationQueues } from '../../infrastructure/queue/queues';
import type { RedisConnection } from '../../infrastructure/redis/redis';
import { users } from '../../infrastructure/db/schema';
import {
  DrizzleActionContextStore,
  DrizzleActionCreateRepository,
  DrizzleActionLifecycleStore,
  DrizzleActionReadRepository,
  QueueActionLifecycleNotifications,
  TransitionActionUseCase,
  TransitionActionWithNotificationUseCase,
} from '../../modules/actions';
import { DrizzleAttachmentStore, LocalProofStorage } from '../../modules/attachments';
import {
  InvalidMaxInitDataError,
  MiniAppSessionService,
  type MiniAppSession,
  validateMaxInitData,
} from '../../modules/auth';
import { BullMqNotificationPublisher } from '../../modules/notifications';
import { DrizzlePersonalWorkspaceStore } from '../../modules/personal';
import {
  BullMqDetectionMessaging,
  DrizzleDetectionManagementStore,
  DrizzleDetectionRepository,
} from '../../modules/detections';

const SESSION_COOKIE = 'hod_session';
const authBodySchema = z.object({ initData: z.string().min(1).max(16_384) });
const listQuerySchema = z.object({
  view: z.enum(['assigned', 'created', 'team']).default('assigned'),
});
const idParamsSchema = z.object({ id: z.uuid() });
const idempotencyBodySchema = z.object({ idempotencyKey: z.string().min(1).max(200) });
const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

export function registerMiniAppApi(
  app: FastifyInstance,
  dependencies: {
    config: RuntimeConfig;
    database: Database;
    redis: RedisConnection;
    queues: ApplicationQueues;
  },
): void {
  const { config, database, redis, queues } = dependencies;
  const sessions = new MiniAppSessionService(database, redis, config.MINIAPP_SESSION_TTL_SECONDS);
  const personalWorkspaces = new DrizzlePersonalWorkspaceStore(database);
  const reads = new DrizzleActionReadRepository(database);
  const actionCreator = new DrizzleActionCreateRepository(database);
  const contexts = new DrizzleActionContextStore(database);
  const transitions = new TransitionActionWithNotificationUseCase(
    new TransitionActionUseCase(new DrizzleActionLifecycleStore(database)),
    contexts,
    new QueueActionLifecycleNotifications(new BullMqNotificationPublisher(queues.notification)),
  );
  const attachmentStore = new DrizzleAttachmentStore(database);
  const proofStorage = new LocalProofStorage(config.PROOF_STORAGE_PATH);
  const detectionManagement = new DrizzleDetectionManagementStore(database);
  const detectionRepository = new DrizzleDetectionRepository(database);
  const detectionMessaging = new BullMqDetectionMessaging(
    new BullMqNotificationPublisher(queues.notification),
  );

  const requireSession = async (request: FastifyRequest): Promise<MiniAppSession> => {
    const session = await sessions.get(request.cookies[SESSION_COOKIE]);
    if (!session) throw app.httpErrors.unauthorized('Mini App session is invalid or expired');
    return session;
  };

  const setSessionCookie = (reply: FastifyReply, token: string): void => {
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/api',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.NODE_ENV === 'production',
      maxAge: config.MINIAPP_SESSION_TTL_SECONDS,
    });
  };

  app.post('/api/auth/max', async (request, reply) => {
    if (!config.MAX_BOT_TOKEN) {
      throw app.httpErrors.serviceUnavailable('MAX authentication is not configured');
    }
    const body = authBodySchema.parse(request.body);
    try {
      const identity = validateMaxInitData(body.initData, config.MAX_BOT_TOKEN, {
        now: new Date(),
        maxAgeSeconds: config.MAX_INIT_DATA_MAX_AGE_SECONDS,
      });
      const result = await sessions.create(identity);
      setSessionCookie(reply, result.token);
      return currentUserSchema.parse(
        await reads.getCurrentUser(result.session.userId, result.session.externalUserId),
      );
    } catch (error) {
      if (error instanceof InvalidMaxInitDataError) {
        throw app.httpErrors.unauthorized('MAX init data is invalid or expired');
      }
      if (error instanceof Error && error.message.includes('workspace member')) {
        throw app.httpErrors.forbidden('User is not an active workspace member');
      }
      throw error;
    }
  });

  app.post('/api/auth/dev', async (_request, reply) => {
    if (config.NODE_ENV !== 'development' || !config.MINIAPP_DEV_AUTH) {
      throw app.httpErrors.notFound('Development authentication is disabled');
    }

    const preferredExternalUserId = config.MINIAPP_DEV_EXTERNAL_USER_ID;
    let externalUserId = await sessions.findActiveExternalUserId(preferredExternalUserId);
    if (!externalUserId) {
      externalUserId = preferredExternalUserId ?? '900000001';
      await personalWorkspaces.bootstrap({
        externalDialogId: null,
        user: {
          externalUserId,
          firstName: 'Локальный пользователь',
          lastName: null,
          username: 'local_hod',
        },
        timezone: config.WORKSPACE_DEFAULT_TIMEZONE,
      });
    }

    const result = await sessions.create({
      externalUserId,
      firstName: 'Локальный пользователь',
      lastName: null,
      username: 'local_hod',
      authDate: Math.floor(Date.now() / 1_000),
      queryId: 'development',
    });
    setSessionCookie(reply, result.token);
    return currentUserSchema.parse(
      await reads.getCurrentUser(result.session.userId, result.session.externalUserId),
    );
  });

  app.delete('/api/auth/session', async (request, reply) => {
    await sessions.delete(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/api' });
    return reply.code(204).send();
  });

  app.get('/api/me', async (request) => {
    const session = await requireSession(request);
    return currentUserSchema.parse(
      await reads.getCurrentUser(session.userId, session.externalUserId),
    );
  });

  app.post('/api/actions', async (request) => {
    const session = await requireSession(request);
    assertMutationOrigin(request, config, app);
    const body = createActionRequestSchema.parse(request.body);
    const ensurePersonalActionContext = async () => {
      let personal = await personalWorkspaces.findByExternalUserId(session.externalUserId);
      if (!personal) {
        const currentUser = await reads.getCurrentUser(session.userId, session.externalUserId);
        const [profile] = await database
          .select({ username: users.username })
          .from(users)
          .where(eq(users.id, session.userId))
          .limit(1);
        personal = await personalWorkspaces.bootstrap({
          externalDialogId: null,
          user: {
            externalUserId: session.externalUserId,
            firstName: currentUser.firstName,
            lastName: currentUser.lastName,
            username: profile?.username ?? null,
          },
          timezone: config.WORKSPACE_DEFAULT_TIMEZONE,
        });
      }
      if (personal.userId !== session.userId) {
        throw app.httpErrors.forbidden('Personal workspace identity mismatch');
      }
      return personal;
    };
    const target = await ensurePersonalActionContext();
    const now = new Date();
    if (
      body.deadlineKind === 'DATE_ONLY' &&
      body.deadlineDate! < formatDateInTimeZone(now, target.timezone)
    ) {
      throw app.httpErrors.badRequest('Deadline cannot be in the past');
    }
    if (body.deadlineKind === 'EXACT_DATETIME' && new Date(body.deadlineAt!) < now) {
      throw app.httpErrors.badRequest('Deadline cannot be in the past');
    }
    const result = await actionCreator.create({
      id: body.idempotencyKey,
      workspaceId: target.workspaceId,
      chatId: target.chatId,
      actorUserId: session.userId,
      assigneeUserId: session.userId,
      title: body.title,
      description: body.description,
      deadlineKind: body.deadlineKind,
      deadlineDate: body.deadlineKind === 'DATE_ONLY' ? body.deadlineDate : null,
      deadlineAt: body.deadlineKind === 'EXACT_DATETIME' ? new Date(body.deadlineAt!) : null,
      deadlineRaw:
        body.deadlineKind === 'DATE_ONLY'
          ? body.deadlineDate
          : body.deadlineKind === 'EXACT_DATETIME'
            ? body.deadlineAt
            : null,
      source: 'MINIAPP',
    });
    return createActionResponseSchema.parse({ id: result.actionId, created: result.created });
  });

  app.get('/api/actions', async (request) => {
    const session = await requireSession(request);
    const query = listQuerySchema.parse(request.query);
    const listed = await reads.list(session.userId, query.view, new Date());
    return actionListResponseSchema.parse({
      actions:
        query.view === 'created'
          ? listed.filter((action) => action.assignee.id !== session.userId)
          : listed,
    });
  });

  app.get('/api/actions/:id', async (request) => {
    const session = await requireSession(request);
    const { id } = idParamsSchema.parse(request.params);
    const detail = await reads.getDetail(session.userId, id, new Date());
    if (!detail) throw app.httpErrors.notFound('Action not found');
    return actionDetailSchema.parse(detail);
  });

  app.get('/api/detections/:id', async (request) => {
    const session = await requireSession(request);
    const { id } = idParamsSchema.parse(request.params);
    const detection = await detectionManagement.get(id, session.userId);
    if (!detection) throw app.httpErrors.notFound('Detection not found');
    return detectionDetailSchema.parse(detection);
  });

  app.patch('/api/detections/:id', async (request) => {
    const session = await requireSession(request);
    assertMutationOrigin(request, config, app);
    const { id } = idParamsSchema.parse(request.params);
    const edit = detectionEditSchema.parse(request.body);
    try {
      await detectionManagement.update(id, session.userId, edit);
    } catch (error) {
      if (error instanceof Error && error.message.includes('forbidden')) {
        throw app.httpErrors.forbidden('Detection edit is forbidden');
      }
      if (error instanceof Error && error.message.includes('no longer pending')) {
        throw app.httpErrors.conflict('Detection is no longer pending');
      }
      if (error instanceof Error && error.message.includes('Assignee is not')) {
        throw app.httpErrors.badRequest('Assignee is not an active workspace member');
      }
      throw error;
    }
    const updated = await detectionManagement.get(id, session.userId);
    if (!updated) throw app.httpErrors.notFound('Detection not found');
    return detectionDetailSchema.parse(updated);
  });

  app.post('/api/detections/:id/confirm', async (request) => {
    const session = await requireSession(request);
    assertMutationOrigin(request, config, app);
    const { id } = idParamsSchema.parse(request.params);
    if (!(await detectionManagement.get(id, session.userId))) {
      throw app.httpErrors.notFound('Detection not found');
    }
    const body = idempotencyBodySchema.parse(request.body);
    const result = await detectionRepository.confirm({
      detectionId: id,
      actorExternalUserId: session.externalUserId,
      idempotencyKey: body.idempotencyKey,
    });
    if (!result.idempotent) {
      await detectionMessaging.publish({
        actionId: result.actionId,
        assigneeExternalUserId: result.assigneeExternalUserId,
        title: result.title,
      });
    }
    return result;
  });

  app.post('/api/detections/:id/reject', async (request) => {
    const session = await requireSession(request);
    assertMutationOrigin(request, config, app);
    const { id } = idParamsSchema.parse(request.params);
    if (!(await detectionManagement.get(id, session.userId))) {
      throw app.httpErrors.notFound('Detection not found');
    }
    return detectionRepository.reject({
      detectionId: id,
      actorExternalUserId: session.externalUserId,
    });
  });

  app.post('/api/actions/:id/transitions', async (request) => {
    const session = await requireSession(request);
    assertMutationOrigin(request, config, app);
    const { id } = idParamsSchema.parse(request.params);
    const body = transitionActionRequestSchema.parse(request.body);
    const actor = await contexts.resolveActor(id, session.externalUserId);
    if (!actor || actor.actorId !== session.userId) {
      throw app.httpErrors.notFound('Action not found');
    }
    const result = await transitions.execute({
      actionId: id,
      workspaceId: actor.workspaceId,
      actorId: actor.actorId,
      idempotencyKey: body.idempotencyKey,
      command: body.command,
      ...(body.reason === undefined ? {} : { reason: body.reason }),
    });
    return { status: result.action.status, idempotent: result.idempotent };
  });

  app.post('/api/actions/:id/attachments', async (request) => {
    const session = await requireSession(request);
    assertMutationOrigin(request, config, app);
    const { id } = idParamsSchema.parse(request.params);
    const context = await attachmentStore.getUploadContext(id, session.userId);
    if (!context) throw app.httpErrors.forbidden('Proof upload is not allowed for this action');
    const part = await request.file();
    if (!part) throw app.httpErrors.badRequest('Proof file is required');
    if (!allowedMimeTypes.has(part.mimetype)) {
      throw app.httpErrors.unsupportedMediaType('Unsupported proof file type');
    }
    const content = await part.toBuffer();
    if (!content.length || content.length > config.PROOF_MAX_BYTES) {
      throw app.httpErrors.payloadTooLarge('Proof file is empty or too large');
    }
    const stored = await proofStorage.write({
      workspaceId: context.workspaceId,
      actionId: context.actionId,
      content,
    });
    try {
      const attachment = await attachmentStore.create({
        context,
        ...stored,
        originalName: sanitizeFilename(part.filename),
        mimeType: part.mimetype,
      });
      return replyCreated(attachment.id);
    } catch (error) {
      await proofStorage.delete(stored.storageKey);
      throw error;
    }
  });

  app.get('/api/attachments/:id', async (request, reply) => {
    const session = await requireSession(request);
    const { id } = idParamsSchema.parse(request.params);
    const attachment = await attachmentStore.getForDownload(id, session.userId);
    if (!attachment) throw app.httpErrors.notFound('Attachment not found');
    const content = await proofStorage.read(attachment.storageKey);
    return reply
      .type(attachment.mimeType)
      .header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
      )
      .send(content);
  });
}

function assertMutationOrigin(
  request: FastifyRequest,
  config: RuntimeConfig,
  app: FastifyInstance,
): void {
  const origin = request.headers.origin;
  if (origin && config.MINIAPP_ORIGIN && origin !== config.MINIAPP_ORIGIN) {
    throw app.httpErrors.forbidden('Request origin is not allowed');
  }
}

function sanitizeFilename(value: string): string {
  const filename = [...value.replace(/^.*[\\/]/, '')]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim();
  return filename.slice(0, 255) || 'proof';
}

function replyCreated(id: string): { id: string } {
  return { id };
}

function formatDateInTimeZone(value: Date, timeZone: string): string {
  const parts = new Map(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.get('year')!}-${parts.get('month')!}-${parts.get('day')!}`;
}
