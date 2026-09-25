import { describe, expect, it } from 'vitest';

import { localDateInTimeZone, localDateTimeToUtc } from './local-date-time';

describe('localDateTimeToUtc', () => {
  it('interprets entered time in the workspace timezone', () => {
    const result = localDateTimeToUtc(
      {
        year: 2026,
        month: 9,
        day: 25,
        hours: 18,
        minutes: 30,
      },
      'Asia/Krasnoyarsk',
    );

    expect(result?.toISOString()).toBe('2026-09-25T11:30:00.000Z');
  });

  it('rejects a local time that does not exist during a DST transition', () => {
    const result = localDateTimeToUtc(
      {
        year: 2026,
        month: 3,
        day: 8,
        hours: 2,
        minutes: 30,
      },
      'America/New_York',
    );

    expect(result).toBeNull();
  });

  it('returns the calendar date in the workspace timezone', () => {
    expect(localDateInTimeZone(new Date('2026-09-22T18:00:00.000Z'), 'Asia/Krasnoyarsk')).toBe(
      '2026-09-23',
    );
  });
});
