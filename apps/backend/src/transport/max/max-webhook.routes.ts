import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { toSafeErrorLog } from '../../shared/logger';
import { InvalidMaxUpdateError, type MaxUpdateRouter } from './max-update.router';

export const MAX_SECRET_HEADER = 'x-max-bot-api-secret';

export function registerMaxWebhookRoute(
  app: FastifyInstance,
  options: { path: string; secret: string; router: MaxUpdateRouter },
): void {
  app.post(options.path, async (request, reply) => {
    if (!isWebhookSecretValid(request.headers[MAX_SECRET_HEADER], options.secret)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    try {
      const result = await options.router.dispatch(request.body);
      return reply.code(200).send({ ok: true, result });
    } catch (error) {
      if (error instanceof InvalidMaxUpdateError) {
        return reply.code(400).send({ error: 'Invalid MAX update' });
      }
      request.log.warn({ err: toSafeErrorLog(error) }, 'MAX update processing failed');
      return reply.code(503).send({ error: 'Update processing unavailable' });
    }
  });
}

export function isWebhookSecretValid(
  received: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof received !== 'string') return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}
