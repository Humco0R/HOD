import { loadRuntimeConfig } from '@hod/config';

import { buildApp } from './app';
import { createRuntimeResources } from './infrastructure/runtime/runtime-resources';
import { createMaxRuntime } from './integrations/max/max-runtime';
import { createLogger } from './shared/logger';
import { registerMiniAppApi } from './transport/http/miniapp-api.routes';

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  const logger = createLogger(config);
  const resources = createRuntimeResources(config, logger);
  const maxRuntime = createMaxRuntime(
    config,
    resources.database,
    resources.redis,
    resources.queues,
    logger,
  );
  const app = buildApp({
    config,
    readiness: async () => resources.readiness(),
    registerRoutes(instance) {
      maxRuntime?.registerRoutes(instance);
      registerMiniAppApi(instance, {
        config,
        database: resources.database,
        redis: resources.redis,
        queues: resources.queues,
      });
    },
  });
  let closing = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'Backend shutdown started');
    await app.close();
    await maxRuntime?.stop();
    await resources.close();
    logger.info('Backend shutdown completed');
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await resources.start();
  await app.listen({ host: '0.0.0.0', port: config.PORT });
  await maxRuntime?.start();
}

try {
  await main();
} catch {
  process.stderr.write('Backend startup failed; inspect configuration and dependency health.\n');
  process.exitCode = 1;
}
