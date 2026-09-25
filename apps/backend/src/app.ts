import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { projectName, projectVersion, type RuntimeConfig } from '@hod/config';
import { serviceInfoSchema } from '@hod/contracts';

import type { ReadinessResult } from './infrastructure/runtime/runtime-resources';
import { createLoggerOptions, toSafeErrorLog } from './shared/logger';
import { ActionTransitionError } from './modules/actions';
import { registerHealthRoutes } from './transport/http/health.routes';

export interface BuildAppOptions {
  config: RuntimeConfig;
  readiness(): Promise<ReadinessResult>;
  registerRoutes?(app: FastifyInstance): void;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: createLoggerOptions(options.config), trustProxy: false });

  void app.register(cors, { origin: options.config.MINIAPP_ORIGIN ?? false, credentials: true });
  void app.register(cookie);
  void app.register(helmet);
  void app.register(multipart, {
    limits: { files: 1, fileSize: options.config.PROOF_MAX_BYTES, fields: 4 },
  });
  void app.register(sensible);

  app.get('/', () =>
    serviceInfoSchema.parse({
      name: projectName,
      status: 'bootstrap',
      version: projectVersion,
    }),
  );

  registerHealthRoutes(app, { readiness: () => options.readiness() });
  if (options.registerRoutes) {
    void app.register((instance) => {
      options.registerRoutes?.(instance);
      return Promise.resolve();
    });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Invalid request', issues: error.issues });
    }
    if (error instanceof ActionTransitionError) {
      const statusCode = error.code === 'FORBIDDEN' ? 403 : 409;
      return reply.code(statusCode).send({ error: error.message, code: error.code });
    }
    if (error instanceof Error && 'statusCode' in error) {
      const statusCode = (error as Error & { statusCode?: unknown }).statusCode;
      if (typeof statusCode === 'number') {
        return reply.code(statusCode).send({ error: error.message });
      }
    }
    request.log.error({ err: toSafeErrorLog(error) }, 'Unhandled request error');
    return reply.code(500).send({ error: 'Internal server error' });
  });

  return app;
}
