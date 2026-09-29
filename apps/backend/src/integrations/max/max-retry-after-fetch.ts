import { setTimeout as delay } from 'node:timers/promises';

type Wait = (milliseconds: number) => Promise<unknown>;

export function createMaxRetryAfterFetch(
  fetchRequest: typeof fetch = globalThis.fetch,
  wait: Wait = delay,
): typeof fetch {
  return async (input, init) => {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetchRequest(input, init);
      if (response.status !== 429 || attempt >= 2) return response;

      const retryAfter = retryAfterMilliseconds(response.headers.get('retry-after'));
      await wait(retryAfter ?? 1_000 * 2 ** attempt);
    }
  };
}

export function retryAfterMilliseconds(value: string | null, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}
