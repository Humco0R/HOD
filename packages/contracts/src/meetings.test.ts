import { describe, expect, it } from 'vitest';
import { createMeetingSchema, saveAvailabilitySchema } from './meetings';

const body = {
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  title: 'Встреча',
  durationMinutes: 60,
  windowStart: '2030-10-19T22:00:00.000Z',
  windowEnd: '2030-11-02T23:00:00.000Z',
  timezone: 'Europe/Berlin',
};

describe('meeting requests', () => {
  it('accepts 14 calendar days across the autumn DST transition and rejects a fifteenth day', () => {
    expect(createMeetingSchema.safeParse(body).success).toBe(true);
    expect(
      createMeetingSchema.safeParse({ ...body, windowEnd: '2030-11-03T23:00:00.000Z' }).success,
    ).toBe(false);
  });
  it('returns validation errors for invalid dates and time zones without throwing', () => {
    expect(createMeetingSchema.safeParse({ ...body, timezone: 'Invalid/Timezone' }).success).toBe(
      false,
    );
    expect(createMeetingSchema.safeParse({ ...body, windowStart: 'not-a-date' }).success).toBe(
      false,
    );
  });
  it('compares interval instants regardless of fractional-second formatting', () => {
    expect(
      saveAvailabilitySchema.safeParse({
        timezone: 'UTC',
        intervals: [{ start: '2030-01-10T10:00:00Z', end: '2030-01-10T10:00:00.000Z' }],
      }).success,
    ).toBe(false);
  });
});
