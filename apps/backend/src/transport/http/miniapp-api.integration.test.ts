import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runtimeConfigSchema } from '@hod/config';

import { buildApp } from '../../app';
import { createDatabase } from '../../infrastructure/db/client';
import { createPostgresConnection } from '../../infrastructure/db/postgres';
import { closeApplicationQueues, createApplicationQueues } from '../../infrastructure/queue/queues';
import { closeRedis, connectRedis, createRedisConnection } from '../../infrastructure/redis/redis';
import {
  actions,
  chats,
  users,
  workspaceMembers,
  workspaces,
} from '../../infrastructure/db/schema';
import { registerMiniAppApi } from './miniapp-api.routes';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl) throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');

const botToken = 'miniapp-integration-token';
const postgres = createPostgresConnection(databaseUrl);
const database = createDatabase(postgres.pool);
const redis = createRedisConnection(redisUrl);
const queueRedis = createRedisConnection(redisUrl, true);
const queues = createApplicationQueues(queueRedis);
let proofPath = '';
let app!: ReturnType<typeof buildApp>;

beforeAll(async () => {
  proofPath = await mkdtemp(resolve(tmpdir(), 'hod-proofs-'));
  await migrate(database, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
  await connectRedis(redis);
  const config = runtimeConfigSchema.parse({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    WORKSPACE_DEFAULT_TIMEZONE: 'Asia/Krasnoyarsk',
    MINIAPP_ORIGIN: 'https://miniapp.example.test',
    MAX_BOT_TOKEN: botToken,
    PROOF_STORAGE_PATH: proofPath,
    PROOF_MAX_BYTES: 1_024,
  });
  app = buildApp({
    config,
    readiness: () => Promise.resolve({ postgres: 'up', redis: 'up' }),
    registerRoutes: (instance) => registerMiniAppApi(instance, { config, database, redis, queues }),
  });
  await app.ready();
});

beforeEach(async () => {
  await postgres.pool.query(
    'TRUNCATE outbox_events, attachments, action_events, source_messages, actions, action_detections, chats, workspace_members, workspaces, users RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await app.close();
  await closeApplicationQueues(queues);
  await closeRedis(redis);
  await closeRedis(queueRedis);
  await postgres.close();
  await rm(proofPath, { recursive: true, force: true });
});

describe('Mini App API', () => {
  it('validates MAX identity, isolates workspaces and completes the proof lifecycle', async () => {
    const seed = await seedScenario();

    const tampered = await app.inject({
      method: 'POST',
      url: '/api/auth/max',
      payload: { initData: `${signedInitData(602)}tampered` },
    });
    expect(tampered.statusCode).toBe(401);

    const assigneeCookie = await authenticate(602);
    const assigned = await app.inject({
      method: 'GET',
      url: '/api/actions?view=assigned',
      headers: { cookie: assigneeCookie },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json<{ actions: Array<{ id: string }> }>().actions.map(({ id }) => id)).toEqual(
      expect.arrayContaining([seed.actionId, seed.optionalResultActionId]),
    );

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/actions/${seed.foreignActionId}`,
      headers: { cookie: assigneeCookie },
    });
    expect(foreign.statusCode).toBe(404);

    await transition(seed.optionalResultActionId, assigneeCookie, 'ACCEPT');
    await transition(seed.optionalResultActionId, assigneeCookie, 'START');
    const submitWithoutProof = await transition(
      seed.optionalResultActionId,
      assigneeCookie,
      'SUBMIT_RESULT',
    );
    expect(submitWithoutProof.json()).toMatchObject({ status: 'DONE' });

    await transition(seed.actionId, assigneeCookie, 'ACCEPT');
    await transition(seed.actionId, assigneeCookie, 'START');

    const rejectedOrigin = await app.inject({
      method: 'POST',
      url: `/api/actions/${seed.actionId}/attachments`,
      headers: {
        cookie: assigneeCookie,
        origin: 'https://evil.example',
        'content-type': 'multipart/form-data; boundary=x',
      },
      payload: multipart('x', 'proof.jpg', 'image/jpeg', 'image-data'),
    });
    expect(rejectedOrigin.statusCode).toBe(403);

    const boundary = 'hod-proof-boundary';
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/actions/${seed.actionId}/attachments`,
      headers: {
        cookie: assigneeCookie,
        origin: 'https://miniapp.example.test',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipart(boundary, '../proof.jpg', 'image/jpeg', 'image-data'),
    });
    expect(uploaded.statusCode).toBe(200);
    const attachmentId = uploaded.json<{ id: string }>().id;

    const submitted = await transition(seed.actionId, assigneeCookie, 'SUBMIT_RESULT');
    expect(submitted.json()).toMatchObject({ status: 'DONE' });

    const outsiderCookie = await authenticate(603);
    const privateDownload = await app.inject({
      method: 'GET',
      url: `/api/attachments/${attachmentId}`,
      headers: { cookie: outsiderCookie },
    });
    expect(privateDownload.statusCode).toBe(404);

    const creatorCookie = await authenticate(601);
    const download = await app.inject({
      method: 'GET',
      url: `/api/attachments/${attachmentId}`,
      headers: { cookie: creatorCookie },
    });
    expect(download.statusCode).toBe(200);
    expect(download.body).toBe('image-data');
    expect(download.headers['content-disposition']).toContain('proof.jpg');

    const verified = await transition(seed.actionId, creatorCookie, 'VERIFY');
    expect(verified.json()).toMatchObject({ status: 'VERIFIED' });
    const detail = await app.inject({
      method: 'GET',
      url: `/api/actions/${seed.actionId}`,
      headers: { cookie: creatorCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      status: 'VERIFIED',
      attachments: [{ id: attachmentId }],
    });
  });

  it('invalidates an existing session when the user loses all active memberships', async () => {
    const seed = await seedScenario();
    const cookie = await authenticate(602);
    await database
      .update(workspaceMembers)
      .set({ status: 'REMOVED' })
      .where(eq(workspaceMembers.userId, seed.assigneeId));
    const response = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(response.statusCode).toBe(401);
  });
});

async function authenticate(externalUserId: number): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/max',
    payload: { initData: signedInitData(externalUserId) },
  });
  expect(response.statusCode).toBe(200);
  const header = response.headers['set-cookie'];
  const cookie = (Array.isArray(header) ? header[0] : header)?.split(';')[0];
  if (!cookie) throw new Error('Session cookie was not set');
  return cookie;
}

async function transition(actionId: string, cookie: string, command: string) {
  return app.inject({
    method: 'POST',
    url: `/api/actions/${actionId}/transitions`,
    headers: { cookie, origin: 'https://miniapp.example.test' },
    payload: { command, idempotencyKey: `${command}-${randomUUID()}` },
  });
}

function signedInitData(externalUserId: number): string {
  const entries = new Map([
    ['auth_date', String(Math.floor(Date.now() / 1_000))],
    ['query_id', `query-${String(externalUserId)}`],
    ['user', JSON.stringify({ id: externalUserId, first_name: `User ${String(externalUserId)}` })],
  ]);
  const data = [...entries]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  entries.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
  return [...entries].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
}

function multipart(boundary: string, filename: string, mimeType: string, content: string): Buffer {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="proof"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--\r\n`,
  );
}

async function seedScenario() {
  const [creator, assignee, outsider] = await database
    .insert(users)
    .values([
      { maxUserId: 601n, firstName: 'Creator' },
      { maxUserId: 602n, firstName: 'Assignee' },
      { maxUserId: 603n, firstName: 'Outsider' },
    ])
    .returning();
  const [workspace, foreignWorkspace] = await database
    .insert(workspaces)
    .values([
      { name: 'Main', ownerId: creator!.id, settings: { timezone: 'Asia/Krasnoyarsk' } },
      { name: 'Foreign', ownerId: outsider!.id, settings: { timezone: 'UTC' } },
    ])
    .returning();
  await database.insert(workspaceMembers).values([
    { workspaceId: workspace!.id, userId: creator!.id, role: 'OWNER' },
    { workspaceId: workspace!.id, userId: assignee!.id, role: 'MEMBER' },
    { workspaceId: foreignWorkspace!.id, userId: outsider!.id, role: 'OWNER' },
  ]);
  const [chat, foreignChat] = await database
    .insert(chats)
    .values([
      { workspaceId: workspace!.id, maxChatId: 7001n },
      { workspaceId: foreignWorkspace!.id, maxChatId: 7002n },
    ])
    .returning();
  const [action, optionalResultAction, foreignAction] = await database
    .insert(actions)
    .values([
      {
        workspaceId: workspace!.id,
        creatorId: creator!.id,
        assigneeId: assignee!.id,
        title: 'Attach proof',
        expectedResultType: 'PHOTO',
        sourceChatId: chat!.id,
        sourceMessageId: 'source-1',
        sourceContextSnapshot: [],
      },
      {
        workspaceId: workspace!.id,
        creatorId: creator!.id,
        assigneeId: assignee!.id,
        title: 'Complete without proof',
        expectedResultType: 'PHOTO',
        sourceChatId: chat!.id,
        sourceMessageId: 'source-optional',
        sourceContextSnapshot: [],
      },
      {
        workspaceId: foreignWorkspace!.id,
        creatorId: outsider!.id,
        assigneeId: outsider!.id,
        title: 'Private',
        sourceChatId: foreignChat!.id,
        sourceMessageId: 'source-2',
        sourceContextSnapshot: [],
      },
    ])
    .returning();
  return {
    actionId: action!.id,
    optionalResultActionId: optionalResultAction!.id,
    foreignActionId: foreignAction!.id,
    assigneeId: assignee!.id,
  };
}
