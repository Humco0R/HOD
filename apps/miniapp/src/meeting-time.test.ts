import { describe, expect, it } from 'vitest';
import { cellsToIntervals, dateInZone, intervalCells, localToIso } from './meeting-time';

describe('meeting time zones', () => {
  it('compares Krasnoyarsk and Moscow availability on the same UTC timeline', () => {
    expect(localToIso('2030-01-10', '18:00', 'Asia/Krasnoyarsk')).toBe(
      localToIso('2030-01-10', '14:00', 'Europe/Moscow'),
    );
    expect(dateInZone(new Date('2030-01-10T22:00:00Z'), 'Asia/Krasnoyarsk')).toBe('2030-01-11');
  });
  it('handles winter and summer offsets and rejects missing DST wall-clock times', () => {
    expect(localToIso('2030-01-10', '12:00', 'Europe/Berlin')).toBe('2030-01-10T11:00:00.000Z');
    expect(localToIso('2030-07-10', '12:00', 'Europe/Berlin')).toBe('2030-07-10T10:00:00.000Z');
    expect(() => localToIso('2030-03-31', '02:30', 'Europe/Berlin')).toThrow('не существует');
  });
  it('preserves gaps when converting selected UTC cells into saved intervals', () => {
    const selected = new Set([
      '2030-01-10T08:00:00.000Z',
      '2030-01-10T08:30:00.000Z',
      '2030-01-10T10:00:00.000Z',
    ]);
    const intervals = cellsToIntervals(selected);
    expect(intervals).toHaveLength(2);
    expect(intervalCells(intervals)).toEqual(selected);
  });
});
