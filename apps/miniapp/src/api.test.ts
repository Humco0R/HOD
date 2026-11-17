import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  firstName: 'Test',
  lastName: null,
  externalUserId: '123',
};
const token = 'x'.repeat(43);
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.resetModules();
  window.WebApp = { initData: 'signed-max-data' };
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete window.WebApp;
});

describe('Mini App session without cookies', () => {
  it('uses the signed login session for API requests and protected files without persisting the token', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ error: 'Mini App session is invalid or expired' }, 401))
      .mockResolvedValueOnce(response({ ...user, sessionToken: token }))
      .mockResolvedValueOnce(response({ actions: [] }))
      .mockResolvedValueOnce(new Response('photo-data'));
    vi.stubGlobal('fetch', fetch);
    const api = await import('./api');
    expect(await api.ensureSession()).toEqual(user);
    await api.listActions('assigned');
    await api.fetchAttachment('/api/attachments/11111111-1111-4111-8111-111111111111');
    for (const index of [2, 3]) {
      const init = fetch.mock.calls[index]![1] as RequestInit;
      expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${token}`);
    }
    expect(localStorage.getItem('sessionToken')).toBeNull();
    expect(sessionStorage.getItem('sessionToken')).toBeNull();
    await expect(api.fetchAttachment('https://foreign.test/file')).rejects.toThrow(
      'Недопустимый адрес API',
    );
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('retains cookie-only sessions and never accepts an unsuccessful login', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(user))
      .mockResolvedValueOnce(response({ actions: [] }));
    vi.stubGlobal('fetch', fetch);
    const api = await import('./api');
    expect(await api.ensureSession()).toEqual(user);
    await api.listActions('assigned');
    expect(new Headers((fetch.mock.calls[1]![1] as RequestInit).headers).has('Authorization')).toBe(
      false,
    );
    fetch
      .mockResolvedValueOnce(response({ error: 'expired' }, 401))
      .mockResolvedValueOnce(response({ error: 'MAX init data is invalid or expired' }, 401));
    await expect(api.ensureSession()).rejects.toThrow('MAX init data is invalid or expired');
  });
});
