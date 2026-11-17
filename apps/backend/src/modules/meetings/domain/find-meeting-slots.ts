export interface Interval {
  start: string;
  end: string;
}
export interface ParticipantAvailability {
  userId: string;
  responded: boolean;
  intervals: Interval[];
}

export const SLOT_MS = 30 * 60_000;

/** Normalize overlapping and adjoining intervals before testing the entire meeting duration. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .map((interval) => ({ ...interval }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const result: Interval[] = [];
  for (const interval of sorted) {
    const previous = result.at(-1);
    if (previous && interval.start <= previous.end) {
      if (interval.end > previous.end) previous.end = interval.end;
    } else result.push(interval);
  }
  return result;
}

export function findMeetingSlots(input: {
  windowStart: string;
  windowEnd: string;
  durationMinutes: number;
  participants: ParticipantAvailability[];
  now: Date;
  limit?: number;
}) {
  const duration = input.durationMinutes * 60_000;
  const anchor = Date.parse(input.windowStart);
  const first = anchor + Math.max(0, Math.ceil((input.now.valueOf() - anchor) / SLOT_MS)) * SLOT_MS;
  const participants = input.participants
    .filter((person) => person.responded)
    .map((person) => ({
      ...person,
      intervals: mergeIntervals(person.intervals),
    }));
  const slots: Array<{ start: string; end: string; availableUserIds: string[] }> = [];
  for (let time = first; time + duration <= Date.parse(input.windowEnd); time += SLOT_MS) {
    const start = new Date(time).toISOString();
    const end = new Date(time + duration).toISOString();
    const availableUserIds = participants
      .filter((person) =>
        person.intervals.some((interval) => interval.start <= start && interval.end >= end),
      )
      .map((person) => person.userId);
    if (availableUserIds.length) slots.push({ start, end, availableUserIds });
  }
  return slots
    .sort(
      (a, b) =>
        b.availableUserIds.length - a.availableUserIds.length || a.start.localeCompare(b.start),
    )
    .slice(0, input.limit ?? 12);
}
