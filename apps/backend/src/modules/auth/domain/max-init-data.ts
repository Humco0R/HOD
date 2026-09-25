import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

const maxUserSchema = z.object({
  id: z.number().int(),
  first_name: z.string(),
  last_name: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
});

export interface ValidatedMaxIdentity {
  externalUserId: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  authDate: number;
  queryId: string;
}

export class InvalidMaxInitDataError extends Error {}

export function validateMaxInitData(
  initData: string,
  botToken: string,
  options: { now: Date; maxAgeSeconds: number },
): ValidatedMaxIdentity {
  if (!initData || initData.length > 16_384) {
    throw new InvalidMaxInitDataError('MAX init data has an invalid size');
  }
  const entries = parseUniqueEntries(initData);
  const originalHash = entries.get('hash');
  if (!originalHash || !/^[0-9a-f]{64}$/i.test(originalHash)) {
    throw new InvalidMaxInitDataError('MAX init data hash is missing or invalid');
  }
  entries.delete('hash');
  const launchParams = [...entries.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = createHmac('sha256', secretKey).update(launchParams).digest();
  const receivedHash = Buffer.from(originalHash, 'hex');
  if (
    calculatedHash.length !== receivedHash.length ||
    !timingSafeEqual(calculatedHash, receivedHash)
  ) {
    throw new InvalidMaxInitDataError('MAX init data signature is invalid');
  }

  const authDate = Number(entries.get('auth_date'));
  const nowSeconds = Math.floor(options.now.valueOf() / 1_000);
  if (
    !Number.isSafeInteger(authDate) ||
    authDate > nowSeconds + 30 ||
    nowSeconds - authDate > options.maxAgeSeconds
  ) {
    throw new InvalidMaxInitDataError('MAX init data is expired');
  }
  const userRaw = entries.get('user');
  const queryId = entries.get('query_id');
  if (!userRaw || !queryId) throw new InvalidMaxInitDataError('MAX user or query is missing');
  let user: z.infer<typeof maxUserSchema>;
  try {
    user = maxUserSchema.parse(JSON.parse(userRaw));
  } catch {
    throw new InvalidMaxInitDataError('MAX user payload is invalid');
  }

  return {
    externalUserId: String(user.id),
    firstName: user.first_name,
    lastName: user.last_name ?? null,
    username: user.username ?? null,
    authDate,
    queryId,
  };
}

function parseUniqueEntries(value: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const segment of value.split('&')) {
    const separator = segment.indexOf('=');
    if (separator <= 0) throw new InvalidMaxInitDataError('MAX init data is malformed');
    const key = segment.slice(0, separator);
    if (entries.has(key)) throw new InvalidMaxInitDataError('MAX init data contains duplicates');
    try {
      entries.set(key, decodeURIComponent(segment.slice(separator + 1)));
    } catch {
      throw new InvalidMaxInitDataError('MAX init data encoding is invalid');
    }
  }
  return entries;
}
