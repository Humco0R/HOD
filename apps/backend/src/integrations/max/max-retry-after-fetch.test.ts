import { describe, expect, it, vi } from 'vitest';

import { createMaxRetryAfterFetch, retryAfterMilliseconds } from './max-retry-after-fetch';

describe('MAX Retry-After fetch', () => {
  it('waits for Retry-After and retries a rate-limited request', async () => {
    const response = new Response('{}', { status: 200 });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(response);
    const wait = vi.fn(() => Promise.resolve());

    await expect(
      createMaxRetryAfterFetch(request, wait)('https://example.test/messages'),
    ).resolves.toBe(response);
    expect(wait).toHaveBeenCalledExactlyOnceWith(2_000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('stops after bounded attempts and falls back when the header is invalid', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(new Response('{}', { status: 429, headers: { 'retry-after': 'invalid' } })),
      );
    const wait = vi.fn(() => Promise.resolve());

    const response = await createMaxRetryAfterFetch(request, wait)('https://example.test/messages');
    expect(response.status).toBe(429);
    expect(request).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[1_000], [2_000]]);
  });

  it('supports an HTTP-date Retry-After value', () => {
    expect(retryAfterMilliseconds('invalid')).toBeNull();
    const now = Date.parse('Tue, 29 Sep 2026 15:00:00 GMT');
    expect(retryAfterMilliseconds('Tue, 29 Sep 2026 15:00:02 GMT', now)).toBe(2_000);
  });
});
