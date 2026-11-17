import { createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runtimeConfigSchema } from '@hod/config';
import type { MeetingDetail } from '@hod/contracts';
import { buildApp } from '../../app';
import { createDatabase } from '../../infrastructure/db/client';
import { createPostgresConnection } from '../../infrastructure/db/postgres';
import {
  chats,
  meetings,
  outboxEvents,
  users,
  workspaceMembers,
  workspaces,
} from '../../infrastructure/db/schema';
import { closeApplicationQueues, createApplicationQueues } from '../../infrastructure/queue/queues';
import { closeRedis, connectRedis, createRedisConnection } from '../../infrastructure/redis/redis';
import { DrizzleMeetingStore } from '../../modules/meetings/infrastructure/drizzle-meeting.store';
import { registerMiniAppApi } from './miniapp-api.routes';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('Dedicated test database and Redis are required');
const postgres = createPostgresConnection(process.env.TEST_DATABASE_URL);
const database = createDatabase(postgres.pool);
const redis = createRedisConnection(process.env.TEST_REDIS_URL);
const queueRedis = createRedisConnection(process.env.TEST_REDIS_URL, true);
const queues = createApplicationQueues(queueRedis);
const origin = 'https://meeting.example.test';
const token = 'test-meetings-bot';
const config = runtimeConfigSchema.parse({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  REDIS_URL: process.env.TEST_REDIS_URL,
  MINIAPP_ORIGIN: origin,
  MAX_BOT_TOKEN: token,
  WORKSPACE_DEFAULT_TIMEZONE: 'UTC',
});
const app = buildApp({
  config,
  readiness: () => Promise.resolve({ postgres: 'up', redis: 'up' }),
  registerRoutes: (instance) => registerMiniAppApi(instance, { config, database, redis, queues }),
});
const store = new DrizzleMeetingStore(database, origin);
let owner: string;
let member: string;
let outsider: string;
let chatId: string;

beforeAll(async () => {
  await migrate(database, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
  await connectRedis(redis);
  await app.ready();
});
beforeEach(async () => {
  await postgres.pool.query('TRUNCATE users, workspaces, outbox_events CASCADE');
  const profiles = await database
    .insert(users)
    .values([
      { maxUserId: 8101n, firstName: 'Организатор' },
      { maxUserId: 8102n, firstName: 'Участник' },
      { maxUserId: 8103n, firstName: 'Друг' },
    ])
    .returning();
  [owner, member, outsider] = profiles.map((person) => person.id) as [string, string, string];
  const [workspace] = await database
    .insert(workspaces)
    .values({ name: 'Тест встреч', ownerId: owner, settings: { timezone: 'UTC' } })
    .returning();
  const [chat] = await database
    .insert(chats)
    .values({ workspaceId: workspace!.id, title: 'Команда', context: 'GROUP', maxChatId: 8999n })
    .returning();
  chatId = chat!.id;
  await database.insert(workspaceMembers).values([
    { workspaceId: workspace!.id, userId: owner, role: 'OWNER' },
    { workspaceId: workspace!.id, userId: member, role: 'MEMBER' },
  ]);
});
afterAll(async () => {
  await app.close();
  await closeApplicationQueues(queues);
  await closeRedis(redis);
  await closeRedis(queueRedis);
  await postgres.close();
});

function at(hour: number): string {
  const date = new Date(Date.now() + 3 * 86400_000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}
async function auth(id: number): Promise<string> {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: randomUUID(),
    user: JSON.stringify({ id, first_name: 'MAX' }),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/max',
    payload: { initData: params.toString() },
  });
  expect(response.statusCode).toBe(200);
  return String(response.headers['set-cookie']).split(';')[0]!;
}
async function create(cookie: string, group = true) {
  const body = {
    idempotencyKey: randomUUID(),
    title: 'Обсудить проект',
    description: '',
    durationMinutes: 60,
    windowStart: at(8),
    windowEnd: at(20),
    timezone: 'Asia/Krasnoyarsk',
    chatId: group ? chatId : null,
    actionId: null,
  };
  const response = await app.inject({
    method: 'POST',
    url: '/api/meetings',
    headers: { cookie, origin },
    payload: body,
  });
  expect(response.statusCode).toBe(200);
  return body;
}
async function availability(
  cookie: string,
  id: string,
  intervals = [{ start: at(10), end: at(12) }],
) {
  return app.inject({
    method: 'PUT',
    url: `/api/meetings/${id}/availability`,
    headers: { cookie, origin },
    payload: { timezone: 'Europe/Moscow', intervals },
  });
}

describe('Meetings API', () => {
  it('collects independent responses, marks an empty response and confirms a full-duration intersection', async () => {
    const a = await auth(8101);
    const b = await auth(8102);
    const body = await create(a);
    const id = body.idempotencyKey;
    const retry = await app.inject({
      method: 'POST',
      url: '/api/meetings',
      headers: { cookie: a, origin },
      payload: body,
    });
    expect(retry.json()).toEqual({ id });
    expect((await availability(a, id)).statusCode).toBe(200);
    expect((await availability(b, id, [])).statusCode).toBe(200);
    const empty = await store.detail(owner, id);
    expect(empty.respondedCount).toBe(2);
    expect(empty.slots[0]?.availableUserIds).toEqual([owner]);
    expect((await availability(b, id, [{ start: at(11), end: at(12) }])).statusCode).toBe(200);
    const detail = await store.detail(owner, id);
    expect(detail.slots[0]?.availableUserIds).toHaveLength(2);
    const result = await app.inject({
      method: 'POST',
      url: `/api/meetings/${id}/confirm`,
      headers: { cookie: a, origin },
      payload: { start: detail.slots[0]!.start, revision: detail.revision },
    });
    expect(result.statusCode).toBe(200);
    expect((await store.detail(owner, id)).status).toBe('SCHEDULED');
    expect((await availability(b, id)).statusCode).toBe(409);
  });
  it('rejects unauthorized access, foreign origins and invalid interval boundaries', async () => {
    const a = await auth(8101);
    const b = await auth(8102);
    const c = await auth(8103);
    const id = (await create(a)).idempotencyKey;
    expect(
      (await app.inject({ method: 'GET', url: `/api/meetings/${id}`, headers: { cookie: c } }))
        .statusCode,
    ).toBe(404);
    expect((await availability(c, id)).statusCode).toBe(403);
    expect((await availability(b, id, [{ start: at(7), end: at(10) }])).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/meetings/${id}/cancel`,
          headers: { cookie: b, origin },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/meetings/${id}/cancel`,
          headers: { cookie: a, origin: 'https://foreign.test' },
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/meetings' })).statusCode).toBe(401);
  });
  it('joins by invitation, bootstraps new users and rejects confirmation after responses change', async () => {
    const a = await auth(8101);
    const c = await auth(8103);
    const id = (await create(a, false)).idempotencyKey;
    await availability(a, id);
    const old = await store.detail(owner, id);
    const [meeting] = await database.select().from(meetings).where(eq(meetings.id, id));
    const denied = await app.inject({
      method: 'POST',
      url: `/api/meetings/${id}/join`,
      headers: { cookie: c, origin },
      payload: { token: randomUUID() },
    });
    expect(denied.statusCode).toBe(404);
    await Promise.all([
      store.join(outsider, id, meeting!.inviteToken),
      store.join(outsider, id, meeting!.inviteToken),
    ]);
    expect((await store.detail(outsider, id)).participantCount).toBe(2);
    const stale = await app.inject({
      method: 'POST',
      url: `/api/meetings/${id}/confirm`,
      headers: { cookie: a, origin },
      payload: { start: old.slots[0]!.start, revision: old.revision },
    });
    expect(stale.statusCode).toBe(409);
    const d = await auth(8199);
    const joined = await app.inject({
      method: 'POST',
      url: `/api/meetings/${id}/join`,
      headers: { cookie: d, origin },
      payload: { token: meeting!.inviteToken },
    });
    expect(joined.statusCode).toBe(200);
    const response = await app.inject({
      method: 'GET',
      url: `/api/meetings/${id}`,
      headers: { cookie: d },
    });
    expect(response.json<MeetingDetail>().participantCount).toBe(3);
  });
  it('deduplicates reminders, suppresses stale reminders after cancellation and uses link buttons', async () => {
    const a = await auth(8101);
    const id = (await create(a)).idempotencyKey;
    await availability(a, id);
    const detail = await store.detail(owner, id);
    await store.confirm(owner, id, detail.slots[0]!.start, detail.revision);
    const now = new Date(Date.parse(detail.slots[0]!.start) - 30 * 60_000);
    await store.scheduleReminders(now, 60);
    await store.scheduleReminders(now, 60);
    const events = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.topic, 'MEETING_NOTIFICATION_REQUESTED'));
    const reminders = events.filter((event) => event.payload.kind === 'REMINDER');
    expect(reminders).toHaveLength(1);
    const publish = vi.fn().mockResolvedValue(undefined);
    await store.publishNotice(reminders[0]!, { publish }, now);
    expect(publish.mock.calls).toHaveLength(3);
    const notification = publish.mock.calls[0]![0] as { buttons: Array<{ startParam: string }> };
    expect(notification.buttons[0]?.startParam).toMatch(/^meeting_/);
    publish.mockClear();
    await store.cancel(owner, id);
    await store.publishNotice(reminders[0]!, { publish }, now);
    expect(publish).not.toHaveBeenCalled();
  });
});
