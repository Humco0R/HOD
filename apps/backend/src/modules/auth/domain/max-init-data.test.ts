import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { validateMaxInitData } from './max-init-data';

function sign(params: Record<string, string>, token: string): string {
  const launchParams = Object.entries(params)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(launchParams).digest('hex');
  return `${Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')}&hash=${hash}`;
}

describe('validateMaxInitData', () => {
  const token = 'max-bot-token';
  const now = new Date('2026-09-20T12:00:00.000Z');
  const params = {
    auth_date: String(Math.floor(now.valueOf() / 1_000) - 30),
    query_id: 'query-1',
    user: JSON.stringify({
      id: 42,
      first_name: 'Антон',
      last_name: 'Иванов',
      username: 'anton',
    }),
  };

  it('validates an official two-step HMAC signature', () => {
    expect(validateMaxInitData(sign(params, token), token, { now, maxAgeSeconds: 300 })).toEqual({
      externalUserId: '42',
      firstName: 'Антон',
      lastName: 'Иванов',
      username: 'anton',
      authDate: Number(params.auth_date),
      queryId: 'query-1',
    });
  });

  it('rejects tampering, duplicate hash and expired data', () => {
    const valid = sign(params, token);
    expect(() =>
      validateMaxInitData(valid.replace('query-1', 'query-2'), token, {
        now,
        maxAgeSeconds: 300,
      }),
    ).toThrow('signature');
    expect(() =>
      validateMaxInitData(`${valid}&hash=${'0'.repeat(64)}`, token, {
        now,
        maxAgeSeconds: 300,
      }),
    ).toThrow('duplicates');
    expect(() =>
      validateMaxInitData(valid, token, {
        now: new Date(now.valueOf() + 301_000),
        maxAgeSeconds: 300,
      }),
    ).toThrow('expired');
  });
});
