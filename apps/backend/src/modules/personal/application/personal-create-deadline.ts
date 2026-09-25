import { localDateInTimeZone, localDateTimeToUtc } from './local-date-time';
import type { PersonalActionCreateSession } from './personal-action-create-session.port';

export function setPersonalCreateDeadline(
  session: PersonalActionCreateSession,
  value: string,
  timezone: string,
  now: Date,
): string | undefined {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$/.exec(value);
  if (!match) return 'Укажи срок в формате ДД.ММ.ГГГГ или ДД.ММ.ГГГГ ЧЧ:ММ.';
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    return 'Такой даты нет в календаре.';
  }
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  if (session.step === 'DEADLINE_DATE') {
    if (match[4]) return 'Для даты без времени отправь только ДД.ММ.ГГГГ.';
    if (date < localDateInTimeZone(now, timezone)) return 'Дата раньше сегодняшнего дня.';
    session.deadlineKind = 'DATE_ONLY';
    session.deadlineDate = date;
    session.deadlineAt = null;
  } else {
    if (!match[4] || !match[5]) return 'Добавь время в формате ЧЧ:ММ.';
    const deadline = localDateTimeToUtc(
      { year, month, day, hours: Number(match[4]), minutes: Number(match[5]) },
      timezone,
    );
    if (!deadline) return 'Дата или время указаны неверно.';
    if (deadline <= now) return 'Этот срок уже прошёл.';
    session.deadlineKind = 'EXACT_DATETIME';
    session.deadlineDate = null;
    session.deadlineAt = deadline.toISOString();
  }
  session.deadlineRaw = value;
  return undefined;
}
