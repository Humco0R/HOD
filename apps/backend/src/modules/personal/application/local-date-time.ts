export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
}

export function localDateTimeToUtc(value: LocalDateTime, timeZone: string): Date | null {
  const expectedUtcValue = Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hours,
    value.minutes,
  );
  const calendarCheck = new Date(expectedUtcValue);

  if (
    calendarCheck.getUTCFullYear() !== value.year ||
    calendarCheck.getUTCMonth() !== value.month - 1 ||
    calendarCheck.getUTCDate() !== value.day ||
    calendarCheck.getUTCHours() !== value.hours ||
    calendarCheck.getUTCMinutes() !== value.minutes
  ) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  let candidate = expectedUtcValue;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rendered = partsInTimeZone(new Date(candidate), formatter);
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hours,
      rendered.minutes,
    );
    const correction = expectedUtcValue - renderedAsUtc;

    if (correction === 0) {
      return new Date(candidate);
    }

    candidate += correction;
  }

  return null;
}

export function localDateInTimeZone(value: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = new Map(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return `${parts.get('year')!}-${parts.get('month')!}-${parts.get('day')!}`;
}

function partsInTimeZone(value: Date, formatter: Intl.DateTimeFormat): LocalDateTime {
  const parts = new Map(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: parts.get('year')!,
    month: parts.get('month')!,
    day: parts.get('day')!,
    hours: parts.get('hour')!,
    minutes: parts.get('minute')!,
  };
}
