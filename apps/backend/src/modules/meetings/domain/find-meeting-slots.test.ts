import { describe, expect, it } from 'vitest';
import { findMeetingSlots } from './find-meeting-slots';

const at = (time: string) => `2030-01-10T${time}:00.000Z`;
const base = {
  windowStart: at('08:00'),
  windowEnd: at('12:00'),
  durationMinutes: 60,
  now: new Date(at('07:00')),
};

describe('meeting slot selection', () => {
  it('anchors the grid to the meeting window for quarter-hour time zones', () => {
    expect(
      findMeetingSlots({
        windowStart: '2030-01-10T00:15:00.000Z',
        windowEnd: '2030-01-10T02:15:00.000Z',
        durationMinutes: 60,
        now: new Date('2030-01-09T00:00:00Z'),
        participants: [
          {
            userId: 'one',
            responded: true,
            intervals: [{ start: '2030-01-10T00:15:00.000Z', end: '2030-01-10T01:15:00.000Z' }],
          },
        ],
      })[0]?.start,
    ).toBe('2030-01-10T00:15:00.000Z');
  });
  it('requires the entire duration and merges adjacent intervals', () => {
    const slots = findMeetingSlots({
      ...base,
      participants: [
        {
          userId: 'one',
          responded: true,
          intervals: [
            { start: at('09:00'), end: at('09:30') },
            { start: at('09:30'), end: at('10:00') },
          ],
        },
        { userId: 'two', responded: true, intervals: [{ start: at('09:30'), end: at('10:00') }] },
      ],
    });
    expect(slots).toEqual([{ start: at('09:00'), end: at('10:00'), availableUserIds: ['one'] }]);
  });
  it('ranks by attendance, leaves unanswered users unknown and respects explicit unavailability', () => {
    const slots = findMeetingSlots({
      ...base,
      participants: [
        { userId: 'one', responded: true, intervals: [{ start: at('08:00'), end: at('12:00') }] },
        { userId: 'two', responded: true, intervals: [{ start: at('10:00'), end: at('11:00') }] },
        {
          userId: 'unknown',
          responded: false,
          intervals: [{ start: at('08:00'), end: at('12:00') }],
        },
        { userId: 'busy', responded: true, intervals: [] },
      ],
    });
    expect(slots[0]).toEqual({
      start: at('10:00'),
      end: at('11:00'),
      availableUserIds: ['one', 'two'],
    });
    expect(
      slots.every(
        (slot) =>
          !slot.availableUserIds.includes('unknown') && !slot.availableUserIds.includes('busy'),
      ),
    ).toBe(true);
  });
  it('does not bridge gaps, duplicate overlapping intervals or suggest past slots', () => {
    const slots = findMeetingSlots({
      ...base,
      now: new Date(at('09:45')),
      participants: [
        {
          userId: 'one',
          responded: true,
          intervals: [
            { start: at('08:00'), end: at('09:00') },
            { start: at('09:30'), end: at('11:00') },
            { start: at('10:00'), end: at('10:30') },
          ],
        },
      ],
    });
    expect(slots).toEqual([{ start: at('10:00'), end: at('11:00'), availableUserIds: ['one'] }]);
  });
});
