import type { AvailabilityInterval } from '@hod/contracts';

export const HALF_HOUR = 1800_000;
export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export function dateInZone(value: Date, timezone: string): string {
  const parts = new Map(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(value)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
}
export function addDays(date: string, days: number): string {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp)
    ? new Date(timestamp + days * 86400_000).toISOString().slice(0, 10)
    : '';
}

/** Convert wall-clock input with the selected IANA zone, independently of the device zone. */
export function localToIso(date: string, time: string, timezone: string): string {
  const expected = Date.parse(`${date}T${time}:00Z`);
  let candidate = expected;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 5; i++) {
    const parts = new Map(
      formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]),
    );
    const rendered = Date.parse(
      `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}T${parts.get('hour')}:${parts.get('minute')}:00Z`,
    );
    if (rendered === expected) return new Date(candidate).toISOString();
    candidate += expected - rendered;
  }
  throw new Error('Это местное время не существует из-за перевода часов. Выберите другую дату.');
}

export function intervalCells(intervals: AvailabilityInterval[]): Set<string> {
  const result = new Set<string>();
  for (const interval of intervals)
    for (let time = Date.parse(interval.start); time < Date.parse(interval.end); time += HALF_HOUR)
      result.add(new Date(time).toISOString());
  return result;
}
export function cellsToIntervals(cells: Set<string>): AvailabilityInterval[] {
  const result: AvailabilityInterval[] = [];
  for (const start of [...cells].sort()) {
    const end = new Date(Date.parse(start) + HALF_HOUR).toISOString();
    const previous = result.at(-1);
    if (previous?.end === start) previous.end = end;
    else result.push({ start, end });
  }
  return result;
}
export function meetingDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('ru', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
