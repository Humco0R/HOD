import type { FastifyInstance } from 'fastify';

import type { ReadinessResult } from '../../infrastructure/runtime/runtime-resources';

export interface HealthRoutesOptions {
  readiness(): Promise<ReadinessResult>;
}

export function registerHealthRoutes(app: FastifyInstance, options: HealthRoutesOptions): void {
  app.get('/health/live', () => ({ status: 'ok' }));

  app.get('/health/ready', async (_request, reply) => {
    const dependencies = await options.readiness();
    const ready = Object.values(dependencies).every((status) => status === 'up');

    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      dependencies,
    });
  });
}
