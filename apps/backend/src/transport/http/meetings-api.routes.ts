import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  confirmMeetingSchema,
  createMeetingSchema,
  meetingDetailSchema,
  saveAvailabilitySchema,
} from '@hod/contracts';
import type { Database } from '../../infrastructure/db/client';
import type { MiniAppSession } from '../../modules/auth';
import { DrizzleMeetingStore } from '../../modules/meetings/infrastructure/drizzle-meeting.store';

const paramsSchema = z.object({ id: z.uuid() });
const inviteSchema = z.object({ token: z.uuid() }).strict();

export function registerMeetingsApi(
  app: FastifyInstance,
  dependencies: {
    database: Database;
    origin: string;
    botName?: string;
    requireSession(request: FastifyRequest): Promise<MiniAppSession>;
    assertOrigin(request: FastifyRequest): void;
  },
): void {
  const store = new DrizzleMeetingStore(
    dependencies.database,
    dependencies.origin,
    dependencies.botName,
  );
  app.get('/api/meetings/context', async (request) => {
    const session = await dependencies.requireSession(request);
    return store.contexts(session.userId);
  });
  app.get('/api/meetings', async (request) => {
    const session = await dependencies.requireSession(request);
    return { meetings: await store.list(session.userId) };
  });
  app.post('/api/meetings', async (request) => {
    const session = await dependencies.requireSession(request);
    dependencies.assertOrigin(request);
    return store.create(session.userId, createMeetingSchema.parse(request.body));
  });
  app.get('/api/meetings/:id', async (request) => {
    const session = await dependencies.requireSession(request);
    const { id } = paramsSchema.parse(request.params);
    return meetingDetailSchema.parse(await store.detail(session.userId, id));
  });
  app.get('/api/meetings/:id/invitation', async (request) => {
    await dependencies.requireSession(request);
    const { id } = paramsSchema.parse(request.params);
    const { token } = inviteSchema.parse(request.query);
    return store.invitation(id, token);
  });
  app.post('/api/meetings/:id/join', async (request) => {
    const session = await dependencies.requireSession(request);
    dependencies.assertOrigin(request);
    const { id } = paramsSchema.parse(request.params);
    const { token } = inviteSchema.parse(request.body);
    await store.join(session.userId, id, token);
    return { joined: true };
  });
  app.put('/api/meetings/:id/availability', async (request) => {
    const session = await dependencies.requireSession(request);
    dependencies.assertOrigin(request);
    const { id } = paramsSchema.parse(request.params);
    await store.saveAvailability(session.userId, id, saveAvailabilitySchema.parse(request.body));
    return { saved: true };
  });
  app.post('/api/meetings/:id/confirm', async (request) => {
    const session = await dependencies.requireSession(request);
    dependencies.assertOrigin(request);
    const { id } = paramsSchema.parse(request.params);
    const { start, revision } = confirmMeetingSchema.parse(request.body);
    await store.confirm(session.userId, id, start, revision);
    return { scheduled: true };
  });
  app.post('/api/meetings/:id/cancel', async (request) => {
    const session = await dependencies.requireSession(request);
    dependencies.assertOrigin(request);
    const { id } = paramsSchema.parse(request.params);
    await store.cancel(session.userId, id);
    return { cancelled: true };
  });
}
