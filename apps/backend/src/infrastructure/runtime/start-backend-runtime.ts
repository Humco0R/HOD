import type { MaxRuntime } from '../../integrations/max/max-runtime';
import type { RuntimeResources } from './runtime-resources';

interface StartBackendRuntimeOptions {
  resources: Pick<RuntimeResources, 'start' | 'close'>;
  maxRuntime: Pick<MaxRuntime, 'start' | 'stop'> | null;
  listen(): Promise<void>;
  closeServer(): Promise<void>;
}

export async function startBackendRuntime(options: StartBackendRuntimeOptions): Promise<void> {
  try {
    await options.resources.start();
    await options.maxRuntime?.start();
    await options.listen();
  } catch (error) {
    await Promise.allSettled([
      options.closeServer(),
      options.maxRuntime?.stop() ?? Promise.resolve(),
      options.resources.close(),
    ]);
    throw error;
  }
}
