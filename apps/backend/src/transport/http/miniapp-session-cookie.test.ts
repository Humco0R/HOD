import { describe, expect, it } from 'vitest';

import { miniAppSessionCookieOptions } from './miniapp-session-cookie';

describe('Mini App session cookie', () => {
  it('supports the embedded MAX production context', () => {
    expect(
      miniAppSessionCookieOptions({
        NODE_ENV: 'production',
        MINIAPP_SESSION_TTL_SECONDS: 28_800,
      }),
    ).toMatchObject({
      sameSite: 'none',
      secure: true,
      partitioned: true,
    });
  });

  it('remains usable over HTTP in local development', () => {
    expect(
      miniAppSessionCookieOptions({
        NODE_ENV: 'development',
        MINIAPP_SESSION_TTL_SECONDS: 28_800,
      }),
    ).toMatchObject({
      sameSite: 'lax',
      secure: false,
      partitioned: false,
    });
  });
});
