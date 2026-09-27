interface MiniAppSessionCookieConfig {
  NODE_ENV: 'development' | 'test' | 'production';
  MINIAPP_SESSION_TTL_SECONDS: number;
}

export function miniAppSessionCookieOptions(config: MiniAppSessionCookieConfig) {
  const production = config.NODE_ENV === 'production';
  return {
    path: '/api',
    httpOnly: true,
    // MAX Desktop/Web opens Mini Apps in an embedded, cross-site context.
    // SameSite=Strict prevents the session cookie from being returned there.
    sameSite: production ? ('none' as const) : ('lax' as const),
    secure: production,
    partitioned: production,
    maxAge: config.MINIAPP_SESSION_TTL_SECONDS,
  };
}
