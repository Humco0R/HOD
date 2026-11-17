import { z } from 'zod';

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Неизвестный часовой пояс');

export const meetingStatusSchema = z.enum(['OPEN', 'SCHEDULED', 'COMPLETED', 'CANCELLED']);
export const availabilityIntervalSchema = z
  .object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
  })
  .strict()
  .refine(
    (value) => Date.parse(value.start) < Date.parse(value.end),
    'Начало должно быть раньше окончания',
  );

export const createMeetingSchema = z
  .object({
    idempotencyKey: z.uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).default(''),
    durationMinutes: z.number().int().min(30).max(480).multipleOf(30),
    windowStart: z.iso.datetime(),
    windowEnd: z.iso.datetime(),
    timezone: timeZoneSchema,
    chatId: z.uuid().nullable().default(null),
    actionId: z.uuid().nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    const length = Date.parse(value.windowEnd) - Date.parse(value.windowStart);
    if (!Number.isFinite(length) || !timeZoneSchema.safeParse(value.timezone).success) return;
    const dayNumber = (iso: string) => {
      const parts = new Map(
        new Intl.DateTimeFormat('en-CA', {
          timeZone: value.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
          .formatToParts(new Date(iso))
          .map((part) => [part.type, part.value]),
      );
      return Date.parse(`${parts.get('year')}-${parts.get('month')}-${parts.get('day')}T00:00:00Z`);
    };
    // Validate calendar days in the selected zone: a DST day may have 23 or 25 hours.
    const days =
      (dayNumber(new Date(Date.parse(value.windowEnd) - 1).toISOString()) -
        dayNumber(value.windowStart)) /
        86400_000 +
      1;
    if (length < value.durationMinutes * 60_000 || days > 14) {
      context.addIssue({
        code: 'custom',
        path: ['windowEnd'],
        message: 'Выберите период до 14 дней, не короче встречи',
      });
    }
    for (const key of ['windowStart', 'windowEnd'] as const) {
      if (Date.parse(value[key]) % 900_000 !== 0 || length % 1800_000 !== 0) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Границы периода должны соответствовать получасовой сетке',
        });
      }
    }
  });

export const saveAvailabilitySchema = z
  .object({
    timezone: timeZoneSchema,
    intervals: z.array(availabilityIntervalSchema).max(672),
  })
  .strict();
export const confirmMeetingSchema = z
  .object({
    start: z.iso.datetime(),
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const meetingParticipantSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  timezone: z.string().nullable(),
  respondedAt: z.iso.datetime().nullable(),
});
export const meetingSlotSchema = z.object({
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  availableUserIds: z.array(z.uuid()),
});
export const meetingSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: meetingStatusSchema,
  durationMinutes: z.number(),
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  timezone: z.string(),
  organizerId: z.uuid(),
  scheduledStart: z.iso.datetime().nullable(),
  participantCount: z.number(),
  respondedCount: z.number(),
});
export const meetingDetailSchema = meetingSummarySchema.extend({
  description: z.string(),
  revision: z.number(),
  inviteUrl: z.string(),
  participants: z.array(meetingParticipantSchema),
  myIntervals: z.array(availabilityIntervalSchema),
  slots: z.array(meetingSlotSchema),
  action: z.object({ id: z.uuid(), title: z.string() }).nullable(),
});
export type CreateMeeting = z.infer<typeof createMeetingSchema>;
export type AvailabilityInterval = z.infer<typeof availabilityIntervalSchema>;
export type SaveAvailability = z.infer<typeof saveAvailabilitySchema>;
export type MeetingSummary = z.infer<typeof meetingSummarySchema>;
export type MeetingDetail = z.infer<typeof meetingDetailSchema>;
export type MeetingSlot = z.infer<typeof meetingSlotSchema>;
export interface MeetingContext {
  timezone: string | null;
  chats: Array<{ id: string; title: string }>;
}
