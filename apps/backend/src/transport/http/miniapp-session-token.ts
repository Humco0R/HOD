import type { FastifyRequest } from 'fastify';

export function miniAppSessionToken(request: FastifyRequest): string | undefined {
  // An explicit bearer credential takes precedence over a possibly stale cookie.
  if (request.headers.authorization !== undefined) {
    return /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization)?.[1];
  }
  return request.cookies.hod_session;
}
