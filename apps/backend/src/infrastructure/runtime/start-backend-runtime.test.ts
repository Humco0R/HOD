import { describe, expect, it, vi } from 'vitest';

import { startBackendRuntime } from './start-backend-runtime';

describe('startBackendRuntime', () => {
  it('does not listen and releases resources when required MAX startup fails', async () => {
    const resources = { start: vi.fn(), close: vi.fn() };
    const maxRuntime = {
      start: vi.fn().mockRejectedValue(new Error('MAX startup failed')),
      stop: vi.fn(),
    };
    const listen = vi.fn();
    const closeServer = vi.fn();

    await expect(
      startBackendRuntime({ resources, maxRuntime, listen, closeServer }),
    ).rejects.toThrow('MAX startup failed');

    expect(listen).not.toHaveBeenCalled();
    expect(closeServer).toHaveBeenCalledOnce();
    expect(maxRuntime.stop).toHaveBeenCalledOnce();
    expect(resources.close).toHaveBeenCalledOnce();
  });

  it('starts normally when MAX is intentionally disabled', async () => {
    const resources = { start: vi.fn(), close: vi.fn() };
    const listen = vi.fn();

    await startBackendRuntime({
      resources,
      maxRuntime: null,
      listen,
      closeServer: vi.fn(),
    });

    expect(resources.start).toHaveBeenCalledOnce();
    expect(listen).toHaveBeenCalledOnce();
    expect(resources.close).not.toHaveBeenCalled();
  });
});
