import { loadRuntimeConfig, projectName } from '@hod/config';

import { createApplicationWorkers } from './infrastructure/queue/application-workers';
import { createRuntimeResources } from './infrastructure/runtime/runtime-resources';
import { createLogger } from './shared/logger';

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  const logger = createLogger(config);
  const resources = createRuntimeResources(config, logger);

  await resources.start();
  const workers = createApplicationWorkers(config, resources.database, resources.queues, logger);
  logger.info({ service: `${projectName} worker` }, 'Worker runtime ready');

  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });

  logger.info('Worker shutdown started');
  await workers.close();
  await resources.close();
  logger.info('Worker shutdown completed');
}

try {
  await main();
} catch {
  process.stderr.write('Worker startup failed; inspect configuration and dependency health.\n');
  process.exitCode = 1;
}
