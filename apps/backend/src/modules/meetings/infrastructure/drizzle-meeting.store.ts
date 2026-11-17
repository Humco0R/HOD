import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type {
  CreateMeeting,
  MeetingContext,
  MeetingDetail,
  MeetingSummary,
  SaveAvailability,
} from '@hod/contracts';

import type { Database } from '../../../infrastructure/db/client';
import {
  actions,
  chats,
  meetingParticipants,
  meetings,
  users,
  workspaceMembers,
} from '../../../infrastructure/db/schema';
import {
  enqueueOutboxEvent,
  type ClaimedOutboxEvent,
  type NotificationPublisher,
} from '../../notifications';
import { findMeetingSlots, mergeIntervals, SLOT_MS } from '../domain/find-meeting-slots';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Meeting = typeof meetings.$inferSelect;
type Notice = 'INVITED' | 'SCHEDULED' | 'CANCELLED' | 'REMINDER';

export class MeetingError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class DrizzleMeetingStore {
  constructor(
    private readonly database: Database,
    private readonly origin: string,
    private readonly botName?: string,
  ) {}

  async contexts(userId: string): Promise<MeetingContext> {
    const [profile] = await this.database
      .select({ timezone: users.timezone })
      .from(users)
      .where(eq(users.id, userId));
    const groups = await this.database
      .select({ id: chats.id, title: chats.title })
      .from(chats)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, chats.workspaceId))
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.status, 'ACTIVE'),
          eq(chats.context, 'GROUP'),
          eq(chats.status, 'ACTIVE'),
        ),
      );
    return {
      timezone: profile?.timezone ?? null,
      chats: groups.map((chat) => ({ id: chat.id, title: chat.title ?? 'Беседа' })),
    };
  }

  async create(userId: string, input: CreateMeeting, now = new Date()): Promise<{ id: string }> {
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${'meeting:' + input.idempotencyKey}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(meetings)
        .where(eq(meetings.id, input.idempotencyKey));
      if (existing) {
        if (existing.organizerId !== userId) throw new MeetingError('Эта встреча недоступна', 403);
        return { id: existing.id };
      }
      if (Date.parse(input.windowEnd) <= now.valueOf())
        throw new MeetingError('Период встречи уже прошёл', 400);
      let participantIds = [userId];
      let workspaceId: string | null = null;
      if (input.chatId) {
        const [group] = await tx
          .select({ workspaceId: chats.workspaceId })
          .from(chats)
          .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, chats.workspaceId))
          .where(
            and(
              eq(chats.id, input.chatId),
              eq(chats.context, 'GROUP'),
              eq(chats.status, 'ACTIVE'),
              eq(workspaceMembers.userId, userId),
              eq(workspaceMembers.status, 'ACTIVE'),
            ),
          );
        if (!group) throw new MeetingError('Беседа недоступна', 403);
        workspaceId = group.workspaceId;
        const members = await tx
          .select({ id: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.status, 'ACTIVE'),
            ),
          );
        participantIds = members.map((member) => member.id);
        if (participantIds.length > 100)
          throw new MeetingError('В первой версии поддерживаются встречи до 100 участников', 400);
      }
      if (input.actionId) {
        const [action] = await tx
          .select({ workspaceId: actions.workspaceId })
          .from(actions)
          .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, actions.workspaceId))
          .where(
            and(
              eq(actions.id, input.actionId),
              eq(workspaceMembers.userId, userId),
              eq(workspaceMembers.status, 'ACTIVE'),
            ),
          );
        if (!action || (workspaceId && action.workspaceId !== workspaceId))
          throw new MeetingError('Дело недоступно в выбранной беседе', 403);
      }
      await tx.insert(meetings).values({
        id: input.idempotencyKey,
        organizerId: userId,
        title: input.title,
        description: input.description,
        durationMinutes: input.durationMinutes,
        windowStart: new Date(input.windowStart),
        windowEnd: new Date(input.windowEnd),
        timezone: input.timezone,
        chatId: input.chatId,
        actionId: input.actionId,
      });
      await tx
        .insert(meetingParticipants)
        .values(participantIds.map((id) => ({ meetingId: input.idempotencyKey, userId: id })));
      await tx.update(users).set({ timezone: input.timezone }).where(eq(users.id, userId));
      await enqueueNotice(tx, input.idempotencyKey, 'INVITED', 0);
      return { id: input.idempotencyKey };
    });
  }

  async list(userId: string): Promise<MeetingSummary[]> {
    const rows = await this.database
      .select({ meeting: meetings })
      .from(meetings)
      .innerJoin(meetingParticipants, eq(meetingParticipants.meetingId, meetings.id))
      .where(eq(meetingParticipants.userId, userId))
      .orderBy(desc(meetings.createdAt))
      .limit(100);
    if (!rows.length) return [];
    const participants = await this.database
      .select()
      .from(meetingParticipants)
      .where(
        inArray(
          meetingParticipants.meetingId,
          rows.map(({ meeting }) => meeting.id),
        ),
      );
    return rows.map(({ meeting }) =>
      summary(
        meeting,
        participants.filter((person) => person.meetingId === meeting.id),
      ),
    );
  }

  async detail(userId: string, id: string, now = new Date()): Promise<MeetingDetail> {
    const [row] = await this.database
      .select({ meeting: meetings })
      .from(meetings)
      .innerJoin(meetingParticipants, eq(meetingParticipants.meetingId, meetings.id))
      .where(and(eq(meetings.id, id), eq(meetingParticipants.userId, userId)));
    if (!row) throw new MeetingError('Встреча не найдена или вы не приглашены', 404);
    const meeting = row.meeting;
    const participants = await this.database
      .select({ person: users, availability: meetingParticipants })
      .from(meetingParticipants)
      .innerJoin(users, eq(users.id, meetingParticipants.userId))
      .where(eq(meetingParticipants.meetingId, id));
    let action: MeetingDetail['action'] = null;
    if (meeting.actionId) {
      const [linked] = await this.database
        .select({ id: actions.id, title: actions.title })
        .from(actions)
        .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, actions.workspaceId))
        .where(
          and(
            eq(actions.id, meeting.actionId),
            eq(workspaceMembers.userId, userId),
            eq(workspaceMembers.status, 'ACTIVE'),
          ),
        );
      action = linked ?? null;
    }
    return {
      ...summary(
        meeting,
        participants.map(({ availability }) => availability),
      ),
      description: meeting.description,
      revision: meeting.revision,
      inviteUrl: this.inviteUrl(meeting),
      action,
      participants: participants.map(({ person, availability }) => ({
        id: person.id,
        firstName: person.firstName,
        lastName: person.lastName,
        timezone: person.timezone,
        respondedAt: availability.respondedAt?.toISOString() ?? null,
      })),
      myIntervals:
        participants.find(({ person }) => person.id === userId)?.availability.intervals ?? [],
      slots:
        meeting.status === 'OPEN'
          ? findMeetingSlots({
              windowStart: meeting.windowStart.toISOString(),
              windowEnd: meeting.windowEnd.toISOString(),
              durationMinutes: meeting.durationMinutes,
              now,
              participants: participants.map(({ person, availability }) => ({
                userId: person.id,
                responded: Boolean(availability.respondedAt),
                intervals: availability.intervals,
              })),
            })
          : [],
    };
  }

  async invitation(id: string, token: string) {
    const [row] = await this.database
      .select({
        title: meetings.title,
        status: meetings.status,
        durationMinutes: meetings.durationMinutes,
      })
      .from(meetings)
      .where(and(eq(meetings.id, id), eq(meetings.inviteToken, token)));
    if (!row) throw new MeetingError('Приглашение недействительно', 404);
    return row;
  }

  async join(userId: string, id: string, token: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      const meeting = await lockedMeeting(tx, id);
      if (meeting.inviteToken !== token) throw new MeetingError('Приглашение недействительно', 404);
      const [member] = await tx
        .select()
        .from(meetingParticipants)
        .where(and(eq(meetingParticipants.meetingId, id), eq(meetingParticipants.userId, userId)));
      if (member) return;
      assertOpen(meeting);
      const members = await tx
        .select({ id: meetingParticipants.userId })
        .from(meetingParticipants)
        .where(eq(meetingParticipants.meetingId, id));
      if (members.length >= 100) throw new MeetingError('Встреча уже набрала 100 участников', 409);
      await tx.insert(meetingParticipants).values({ meetingId: id, userId });
      await tx
        .update(meetings)
        .set({ revision: meeting.revision + 1 })
        .where(eq(meetings.id, id));
    });
  }

  async saveAvailability(
    userId: string,
    id: string,
    input: SaveAvailability,
    now = new Date(),
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      const meeting = await lockedMeeting(tx, id);
      assertOpen(meeting);
      if (meeting.windowEnd <= now) throw new MeetingError('Период встречи уже прошёл', 409);
      const [member] = await tx
        .select()
        .from(meetingParticipants)
        .where(and(eq(meetingParticipants.meetingId, id), eq(meetingParticipants.userId, userId)));
      if (!member) throw new MeetingError('Вы не приглашены на встречу', 403);
      for (const interval of input.intervals) {
        const start = Date.parse(interval.start);
        const end = Date.parse(interval.end);
        if (
          start < meeting.windowStart.valueOf() ||
          end > meeting.windowEnd.valueOf() ||
          (start - meeting.windowStart.valueOf()) % SLOT_MS ||
          (end - meeting.windowStart.valueOf()) % SLOT_MS
        )
          throw new MeetingError(
            'Интервалы должны находиться внутри периода встречи с шагом 30 минут',
            400,
          );
      }
      const intervals = mergeIntervals(
        input.intervals.map((interval) => ({
          start: new Date(interval.start).toISOString(),
          end: new Date(interval.end).toISOString(),
        })),
      );
      await tx
        .update(meetingParticipants)
        .set({ intervals, respondedAt: now })
        .where(and(eq(meetingParticipants.meetingId, id), eq(meetingParticipants.userId, userId)));
      await tx.update(users).set({ timezone: input.timezone }).where(eq(users.id, userId));
      await tx
        .update(meetings)
        .set({ revision: meeting.revision + 1 })
        .where(eq(meetings.id, id));
    });
  }

  async confirm(
    userId: string,
    id: string,
    start: string,
    revision: number,
    now = new Date(),
  ): Promise<void> {
    start = new Date(start).toISOString();
    await this.database.transaction(async (tx) => {
      const meeting = await lockedMeeting(tx, id);
      assertOrganizer(meeting, userId);
      if (meeting.status === 'SCHEDULED' && meeting.scheduledStart?.toISOString() === start) return;
      assertOpen(meeting);
      if (meeting.revision !== revision)
        throw new MeetingError(
          'Ответы изменились. Обновите варианты и выберите время ещё раз',
          409,
        );
      if (
        Date.parse(start) <= now.valueOf() ||
        (Date.parse(start) - meeting.windowStart.valueOf()) % SLOT_MS
      )
        throw new MeetingError('Выберите будущее время с шагом 30 минут', 400);
      const participants = await tx
        .select()
        .from(meetingParticipants)
        .where(eq(meetingParticipants.meetingId, id));
      const slots = findMeetingSlots({
        windowStart: meeting.windowStart.toISOString(),
        windowEnd: meeting.windowEnd.toISOString(),
        durationMinutes: meeting.durationMinutes,
        now,
        participants: participants.map((person) => ({
          userId: person.userId,
          responded: Boolean(person.respondedAt),
          intervals: person.intervals,
        })),
        limit: 720,
      });
      const selected = slots.find((slot) => slot.start === start);
      if (!selected)
        throw new MeetingError('Этот вариант больше не подходит. Обновите список времени', 400);
      await tx
        .update(meetings)
        .set({ status: 'SCHEDULED', scheduledStart: new Date(start), revision: revision + 1 })
        .where(eq(meetings.id, id));
      await enqueueNotice(tx, id, 'SCHEDULED', revision + 1);
    });
  }

  async cancel(userId: string, id: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      const meeting = await lockedMeeting(tx, id);
      assertOrganizer(meeting, userId);
      if (meeting.status === 'CANCELLED') return;
      if (meeting.status === 'COMPLETED') throw new MeetingError('Встреча уже завершена', 409);
      await tx
        .update(meetings)
        .set({ status: 'CANCELLED', revision: meeting.revision + 1 })
        .where(eq(meetings.id, id));
      await enqueueNotice(tx, id, 'CANCELLED', meeting.revision + 1);
    });
  }

  async scheduleReminders(now: Date, leadMinutes: number): Promise<void> {
    await this.database.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(meetings)
        .where(eq(meetings.status, 'SCHEDULED'))
        .for('update', { skipLocked: true });
      for (const meeting of rows) {
        if (!meeting.scheduledStart) continue;
        const start = meeting.scheduledStart.valueOf();
        if (start + meeting.durationMinutes * 60_000 <= now.valueOf()) {
          await tx
            .update(meetings)
            .set({ status: 'COMPLETED', revision: meeting.revision + 1 })
            .where(eq(meetings.id, meeting.id));
        } else if (start > now.valueOf() && start - now.valueOf() <= leadMinutes * 60_000) {
          await enqueueNotice(tx, meeting.id, 'REMINDER', meeting.revision);
        }
      }
    });
  }

  async publishNotice(
    event: ClaimedOutboxEvent,
    publisher: NotificationPublisher,
    now = new Date(),
  ): Promise<void> {
    const id = typeof event.payload.meetingId === 'string' ? event.payload.meetingId : '';
    const kind = event.payload.kind as Notice;
    if (!['INVITED', 'SCHEDULED', 'CANCELLED', 'REMINDER'].includes(kind))
      throw new Error('Invalid meeting notice');
    const [meeting] = await this.database.select().from(meetings).where(eq(meetings.id, id));
    if (
      !meeting ||
      (kind === 'INVITED' && meeting.status !== 'OPEN') ||
      (kind === 'CANCELLED' && meeting.status !== 'CANCELLED') ||
      ((kind === 'SCHEDULED' || kind === 'REMINDER') &&
        (meeting.status !== 'SCHEDULED' ||
          !meeting.scheduledStart ||
          meeting.scheduledStart <= now))
    )
      return;
    const participants = await this.database
      .select({ person: users })
      .from(meetingParticipants)
      .innerJoin(users, eq(users.id, meetingParticipants.userId))
      .where(eq(meetingParticipants.meetingId, id));
    const labels = {
      INVITED: 'Отметьте свободное время',
      SCHEDULED: 'Встреча назначена',
      CANCELLED: 'Встреча отменена',
      REMINDER: 'Скоро встреча',
    };
    const text = (zone: string) => {
      const when = meeting.scheduledStart
        ? `\n${new Intl.DateTimeFormat('ru', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(meeting.scheduledStart)} (${zone})`
        : '';
      return `${labels[kind]}: ${meeting.title}${when}\nДлительность: ${meeting.durationMinutes} мин.`;
    };
    const buttons = [
      {
        text: kind === 'INVITED' ? 'Отметить время' : 'Открыть встречу',
        startParam: `meeting_${id}_${meeting.inviteToken}`,
      },
    ];
    // Link buttons open Mini App directly; shared cards never use one-person callback handling.
    if (meeting.chatId) {
      const [chat] = await this.database
        .select()
        .from(chats)
        .where(and(eq(chats.id, meeting.chatId), eq(chats.status, 'ACTIVE')));
      if (chat?.maxChatId)
        await publisher.publish(
          {
            target: { type: 'CHAT', externalId: String(chat.maxChatId) },
            text: text(meeting.timezone),
            buttons,
          },
          `${event.dedupeKey}-chat`,
        );
    }
    for (const { person } of participants)
      await publisher.publish(
        {
          target: { type: 'USER', externalId: String(person.maxUserId) },
          text: text(person.timezone ?? meeting.timezone),
          buttons,
        },
        `${event.dedupeKey}-${person.id}`,
      );
  }

  private inviteUrl(meeting: Meeting): string {
    const start = `meeting_${meeting.id}_${meeting.inviteToken}`;
    return this.botName
      ? `https://max.ru/${encodeURIComponent(this.botName.replace(/^@/, ''))}?startapp=${start}`
      : `${this.origin}/meetings/${meeting.id}?invite=${meeting.inviteToken}`;
  }
}

function summary(
  meeting: Meeting,
  participants: Array<{ respondedAt: Date | null }>,
): MeetingSummary {
  return {
    id: meeting.id,
    title: meeting.title,
    status: meeting.status,
    durationMinutes: meeting.durationMinutes,
    windowStart: meeting.windowStart.toISOString(),
    windowEnd: meeting.windowEnd.toISOString(),
    timezone: meeting.timezone,
    organizerId: meeting.organizerId,
    scheduledStart: meeting.scheduledStart?.toISOString() ?? null,
    participantCount: participants.length,
    respondedCount: participants.filter((person) => person.respondedAt).length,
  };
}
async function lockedMeeting(tx: Transaction, id: string): Promise<Meeting> {
  const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, id)).for('update');
  if (!meeting) throw new MeetingError('Встреча не найдена', 404);
  return meeting;
}
function assertOpen(meeting: Meeting): void {
  if (meeting.status !== 'OPEN') throw new MeetingError('Сбор времени уже закрыт', 409);
}
function assertOrganizer(meeting: Meeting, userId: string): void {
  if (meeting.organizerId !== userId)
    throw new MeetingError('Только организатор может управлять встречей', 403);
}
function enqueueNotice(
  tx: Transaction,
  meetingId: string,
  kind: Notice,
  revision: number,
): Promise<void> {
  return enqueueOutboxEvent(tx, {
    topic: 'MEETING_NOTIFICATION_REQUESTED',
    dedupeKey: `meeting-${meetingId}-${kind}-${revision}`,
    payload: { meetingId, kind },
  });
}
