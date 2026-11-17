import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  createMeetingSchema,
  type CreateMeeting,
  type MeetingDetail,
  type MeetingSummary,
  type SaveAvailability,
} from '@hod/contracts';
import {
  cancelMeeting,
  confirmMeeting,
  createMeeting,
  getAction,
  getMeeting,
  getMeetingContext,
  getMeetingInvitation,
  joinMeeting,
  listMeetings,
  saveMeetingAvailability,
} from './api';
import {
  addDays,
  cellsToIntervals,
  dateInZone,
  deviceTimezone,
  HALF_HOUR,
  intervalCells,
  localToIso,
  meetingDate,
} from './meeting-time';

const labels: Record<MeetingSummary['status'], string> = {
  OPEN: 'Собираем ответы',
  SCHEDULED: 'Назначена',
  COMPLETED: 'Завершена',
  CANCELLED: 'Отменена',
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось выполнить действие';

function Feedback({ error }: { error: unknown }) {
  return (
    <p className="form-error" role="alert">
      {message(error)}
    </p>
  );
}

export function TimezoneSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const zones = useMemo(
    () => [
      ...new Set([
        value,
        deviceTimezone(),
        'UTC',
        'Europe/Kaliningrad',
        'Europe/Moscow',
        'Europe/Samara',
        'Asia/Yekaterinburg',
        'Asia/Omsk',
        'Asia/Krasnoyarsk',
        'Asia/Irkutsk',
        'Asia/Yakutsk',
        'Asia/Vladivostok',
        'Asia/Magadan',
        'Asia/Kamchatka',
        ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []),
      ]),
    ],
    [value],
  );
  return (
    <label className="timezone-label">
      Ваш часовой пояс
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MeetingListPage() {
  const query = useQuery({ queryKey: ['meetings'], queryFn: listMeetings });
  const [showArchive, setShowArchive] = useState(false);
  const meetings =
    query.data?.meetings.filter(
      (meeting) => showArchive || meeting.status === 'OPEN' || meeting.status === 'SCHEDULED',
    ) ?? [];
  return (
    <section>
      <div className="page-title page-title-row">
        <div>
          <p className="eyebrow">Общее время</p>
          <h1>Встречи</h1>
        </div>
        <Link className="create-link" to="/meetings/new">
          + Собрать встречу
        </Link>
      </div>
      <p className="muted">Отметьте свободное время — ХОД найдёт варианты для всей команды.</p>
      <button
        className="filter-chip"
        aria-pressed={showArchive}
        onClick={() => setShowArchive(!showArchive)}
      >
        Показывать завершённые и отменённые
      </button>
      {query.isPending && <p role="status">Загружаем встречи…</p>}
      {query.isError && <Feedback error={query.error} />}
      {query.isSuccess && meetings.length === 0 && (
        <div className="empty-state">
          <h2>Пока нет встреч</h2>
          <p>Создайте встречу и пригласите участников по ссылке или через беседу.</p>
          <Link className="create-link" to="/meetings/new">
            Собрать первую встречу
          </Link>
        </div>
      )}
      <div className="card-list meeting-list">
        {meetings.map((meeting) => (
          <Link
            className="action-card meeting-card"
            key={meeting.id}
            to={`/meetings/${meeting.id}`}
          >
            <div className="card-topline">
              <span className={`status meeting-status-${meeting.status.toLowerCase()}`}>
                {labels[meeting.status]}
              </span>
              <span className="muted">{meeting.durationMinutes} мин</span>
            </div>
            <h2>{meeting.title}</h2>
            <p className="muted">
              {meeting.scheduledStart
                ? meetingDate(meeting.scheduledStart, deviceTimezone())
                : `${dateInZone(new Date(meeting.windowStart), meeting.timezone)} — ${dateInZone(new Date(Date.parse(meeting.windowEnd) - 1), meeting.timezone)}`}
            </p>
            <p className="meeting-response-count">
              Ответили {meeting.respondedCount} из {meeting.participantCount}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function CreateMeetingPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const actionId = params.get('action');
  const context = useQuery({ queryKey: ['meeting-context'], queryFn: getMeetingContext });
  const action = useQuery({
    queryKey: ['action', actionId],
    queryFn: () => getAction(actionId!),
    enabled: Boolean(actionId),
  });
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(60);
  const [timezoneChoice, setTimezone] = useState<string | null>(null);
  const timezone = timezoneChoice ?? context.data?.timezone ?? deviceTimezone();
  const [firstDay, setFirstDay] = useState(() =>
    addDays(dateInZone(new Date(), deviceTimezone()), 1),
  );
  const [lastDay, setLastDay] = useState(() =>
    addDays(dateInZone(new Date(), deviceTimezone()), 3),
  );
  const [chatId, setChatId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (body: CreateMeeting) => createMeeting(body),
    onSuccess: async ({ id }) => {
      await client.invalidateQueries({ queryKey: ['meetings'] });
      void navigate(`/meetings/${id}`, { replace: true });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    try {
      const body = createMeetingSchema.safeParse({
        idempotencyKey,
        title: title ?? (action.data ? `Обсудить: ${action.data.title}` : ''),
        description,
        durationMinutes: duration,
        timezone,
        chatId: chatId || null,
        actionId,
        windowStart: localToIso(firstDay, '00:00', timezone),
        windowEnd: localToIso(addDays(lastDay, 1), '00:00', timezone),
      });
      if (!body.success) {
        setFormError(body.error.issues[0]?.message ?? 'Проверьте поля встречи');
        return;
      }
      create.mutate(body.data);
    } catch (error) {
      setFormError(message(error));
    }
  };
  return (
    <section className="detail create-page">
      <Link className="back-link" to="/meetings">
        ← К встречам
      </Link>
      <p className="eyebrow">Время для команды</p>
      <h1>Собрать встречу</h1>
      <form className="editor stack" onSubmit={submit}>
        <label>
          Название
          <input
            required
            maxLength={200}
            value={title ?? (action.data ? `Обсудить: ${action.data.title}` : '')}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Например, обсудить презентацию"
          />
        </label>
        {action.data && (
          <p className="muted">
            По делу: <Link to={`/actions/${action.data.id}`}>{action.data.title}</Link>
          </p>
        )}
        {action.isError && <Feedback error={action.error} />}
        <label>
          Описание
          <textarea
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Повестка, место или ссылка на созвон"
          />
        </label>
        <label>
          Длительность
          <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
            {[30, 60, 90, 120, 180, 240].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} мин
              </option>
            ))}
          </select>
        </label>
        <TimezoneSelect value={timezone} onChange={setTimezone} />
        <div className="date-range">
          <label>
            С какого дня
            <input
              required
              type="date"
              value={firstDay}
              min={dateInZone(new Date(), timezone)}
              onChange={(event) => {
                setFirstDay(event.target.value);
                if (event.target.value > lastDay) setLastDay(event.target.value);
              }}
            />
          </label>
          <label>
            По какой день
            <input
              required
              type="date"
              min={firstDay}
              max={addDays(firstDay, 13)}
              value={lastDay}
              onChange={(event) => setLastDay(event.target.value)}
            />
          </label>
        </div>
        <p className="muted">
          Выберите до 14 дней. Участники отметят удобные часы внутри этого периода.
        </p>
        <label>
          Куда пригласить
          <select value={chatId} onChange={(event) => setChatId(event.target.value)}>
            <option value="">По ссылке — отправлю сам</option>
            {context.data?.chats.map((chat) => (
              <option value={chat.id} key={chat.id}>
                {chat.title}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          {chatId
            ? 'Участники беседы будут добавлены в список, а бот отправит приглашение в чат.'
            : 'После создания появится ссылка. Каждый участник присоединится со своего аккаунта MAX.'}
        </p>
        {context.isError && <Feedback error={context.error} />}
        <button
          disabled={create.isPending || context.isPending || Boolean(actionId && !action.data)}
        >
          {create.isPending ? 'Создаём…' : 'Создать встречу'}
        </button>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        {create.isError && <Feedback error={create.error} />}
      </form>
    </section>
  );
}

export function MeetingDetailPage({ userId }: { userId: string }) {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const invite = params.get('invite');
  return invite ? (
    <InvitationPage id={id} token={invite} />
  ) : (
    <MeetingBody key={id} id={id} userId={userId} />
  );
}

function InvitationPage({ id, token }: { id: string; token: string }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['meeting-invite', id, token],
    queryFn: () => getMeetingInvitation(id, token),
    retry: false,
  });
  const join = useMutation({
    mutationFn: () => joinMeeting(id, token),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['meetings'] });
      await client.invalidateQueries({ queryKey: ['meeting', id] });
      void navigate(`/meetings/${id}`, { replace: true });
    },
  });
  return (
    <section className="editor stack invitation-card">
      <p className="eyebrow">Вас пригласили</p>
      {query.isPending && <p role="status">Открываем приглашение…</p>}
      {query.isError && <Feedback error={query.error} />}
      {query.data && (
        <>
          <h1>{query.data.title}</h1>
          <p>
            {query.data.durationMinutes} мин · {labels[query.data.status]}
          </p>
          <p className="muted">
            Присоединитесь, чтобы отметить свободное время и увидеть варианты команды.
          </p>
          <button disabled={join.isPending} onClick={() => join.mutate()}>
            {join.isPending ? 'Открываем…' : 'Присоединиться / открыть'}
          </button>
        </>
      )}
      {join.isError && <Feedback error={join.error} />}
      <Link to="/meetings">К моим встречам</Link>
    </section>
  );
}

function MeetingBody({ id, userId }: { id: string; userId: string }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['meeting', id],
    queryFn: () => getMeeting(id),
    refetchInterval: 20_000,
  });
  const [timezoneChoice, setTimezone] = useState<string | null>(null);
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [copied, setCopied] = useState(false);
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['meeting', id] }),
      client.invalidateQueries({ queryKey: ['meetings'] }),
    ]);
  };
  const confirm = useMutation({
    mutationFn: ({ start, revision }: { start: string; revision: number }) =>
      confirmMeeting(id, start, revision),
    onSuccess: refresh,
    onError: refresh,
  });
  const cancel = useMutation({ mutationFn: () => cancelMeeting(id), onSuccess: refresh });
  if (query.isPending) return <p role="status">Загружаем встречу…</p>;
  if (!query.data)
    return (
      <>
        <Link to="/meetings">← К встречам</Link>
        <Feedback error={query.error} />
      </>
    );
  const meeting = query.data;
  const timezone =
    timezoneChoice ??
    meeting.participants.find((person) => person.id === userId)?.timezone ??
    deviceTimezone();
  const organizer = meeting.organizerId === userId;
  const unanswered = meeting.participants.filter((person) => !person.respondedAt);
  const selected = meeting.slots.find((slot) => slot.start === selectedStart);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(meeting.inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <article className="detail meeting-detail">
      <Link className="back-link" to="/meetings">
        ← К встречам
      </Link>
      <div className="card-topline">
        <span className={`status meeting-status-${meeting.status.toLowerCase()}`}>
          {labels[meeting.status]}
        </span>
        <span className="muted">{meeting.durationMinutes} мин</span>
      </div>
      <h1>{meeting.title}</h1>
      {meeting.description && <p className="meeting-description">{meeting.description}</p>}
      {meeting.action && (
        <p className="muted">
          По делу: <Link to={`/actions/${meeting.action.id}`}>{meeting.action.title}</Link>
        </p>
      )}
      <TimezoneSelect value={timezone} onChange={setTimezone} />
      {meeting.scheduledStart && (
        <div className="meeting-scheduled">
          <p className="eyebrow">
            {meeting.status === 'CANCELLED' ? 'Ранее выбранное время' : 'Время встречи'}
          </p>
          <h2>
            {meetingDate(meeting.scheduledStart, timezone)} —{' '}
            {meetingDate(
              new Date(
                Date.parse(meeting.scheduledStart) + meeting.durationMinutes * 60_000,
              ).toISOString(),
              timezone,
            )}
          </h2>
          <p className="muted">{timezone}</p>
        </div>
      )}
      {meeting.status === 'OPEN' && (
        <>
          <section className="detail-section">
            <h2>Пригласить участников</h2>
            <p className="muted">
              Отправьте ссылку тем, кто должен участвовать. Список обновится после присоединения.
            </p>
            <div className="invite-copy">
              <input
                aria-label="Ссылка на встречу"
                readOnly
                value={meeting.inviteUrl}
                onFocus={(event) => event.target.select()}
              />
              <button
                className="secondary"
                onClick={() => {
                  void copy();
                }}
              >
                {copied ? 'Скопировано' : 'Копировать'}
              </button>
            </div>
          </section>
          <AvailabilityEditor key={id} meeting={meeting} timezone={timezone} onSaved={refresh} />
          <section className="detail-section">
            <div className="card-topline">
              <h2>Подходящее время</h2>
              <button
                className="secondary compact-button"
                onClick={() => {
                  void refresh();
                }}
              >
                Обновить
              </button>
            </div>
            <p className="muted">
              Ответили {meeting.respondedCount} из {meeting.participantCount}.{' '}
              {unanswered.length > 0
                ? 'У неответивших доступность пока неизвестна.'
                : 'Все участники ответили.'}
            </p>
            {meeting.slots.length === 0 ? (
              <p className="empty-hint">
                {meeting.respondedCount
                  ? 'Подходящих интервалов нет. Попробуйте отметить другие часы.'
                  : 'Отметьте время и сохраните ответ — здесь появятся варианты.'}
              </p>
            ) : (
              <div className="meeting-slots">
                {meeting.slots.map((slot) => (
                  <button
                    className="meeting-slot"
                    type="button"
                    key={slot.start}
                    aria-pressed={selectedStart === slot.start}
                    disabled={!organizer || confirm.isPending}
                    onClick={() => setSelectedStart(slot.start)}
                  >
                    <span>
                      {meetingDate(slot.start, timezone)} —{' '}
                      {new Intl.DateTimeFormat('ru', {
                        timeZone: timezone,
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(slot.end))}
                    </span>
                    <strong>
                      {slot.availableUserIds.length === meeting.participantCount
                        ? `Могут все ${meeting.participantCount}`
                        : `Могут ${slot.availableUserIds.length} из ${meeting.participantCount}`}
                    </strong>
                    <small>
                      {meeting.participants
                        .filter((person) => slot.availableUserIds.includes(person.id))
                        .map((person) => person.firstName)
                        .join(', ')}
                    </small>
                  </button>
                ))}
              </div>
            )}
            {organizer && (
              <>
                <p className="muted">
                  Выберите подходящий вариант. Подтверждение назначит встречу и отправит
                  уведомления.
                </p>
                {selected && (
                  <p>
                    {unanswered.length > 0 && `Ещё не ответили: ${unanswered.length}. `}
                    {selected.availableUserIds.length < meeting.participantCount &&
                      `Этот вариант подходит ${selected.availableUserIds.length} из ${meeting.participantCount} участников.`}
                  </p>
                )}
                <button
                  disabled={!selected || confirm.isPending}
                  onClick={() => {
                    if (selected)
                      confirm.mutate({ start: selected.start, revision: meeting.revision });
                  }}
                >
                  {confirm.isPending ? 'Назначаем…' : 'Подтвердить время'}
                </button>
              </>
            )}
            {!organizer && <p className="muted">Время подтвердит организатор.</p>}
            {confirm.isError && <Feedback error={confirm.error} />}
          </section>
        </>
      )}
      <section className="detail-section">
        <h2>Участники · {meeting.participantCount}</h2>
        <ul className="meeting-participants">
          {meeting.participants.map((person) => (
            <li key={person.id}>
              <span>
                {person.firstName} {person.lastName}
                {person.id === meeting.organizerId ? ' · организатор' : ''}
              </span>
              <span className={person.respondedAt ? 'response-saved' : 'muted'}>
                {person.respondedAt ? 'Ответ сохранён' : 'Нет ответа'}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {(meeting.status === 'SCHEDULED' || meeting.status === 'COMPLETED') && (
        <section className="editor stack">
          <h2>Договорённости → дела</h2>
          <p className="muted">Зафиксируйте своё поручение по итогам встречи.</p>
          <Link
            className="create-link"
            to={`/actions/new?meeting=${meeting.id}&title=${encodeURIComponent(`По встрече: ${meeting.title}`)}`}
          >
            + Создать дело
          </Link>
        </section>
      )}
      {organizer && (meeting.status === 'OPEN' || meeting.status === 'SCHEDULED') && (
        <section className="detail-section">
          {cancelRequested ? (
            <div className="stack">
              <p>Отменить встречу? Участники получат уведомление.</p>
              <div className="button-row">
                <button
                  className="danger-button"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate()}
                >
                  Да, отменить встречу
                </button>
                <button className="secondary" onClick={() => setCancelRequested(false)}>
                  Оставить
                </button>
              </div>
            </div>
          ) : (
            <button className="secondary" onClick={() => setCancelRequested(true)}>
              Отменить встречу
            </button>
          )}
          {cancel.isError && <Feedback error={cancel.error} />}
        </section>
      )}
    </article>
  );
}

export function AvailabilityEditor({
  meeting,
  timezone,
  onSaved,
}: {
  meeting: MeetingDetail;
  timezone: string;
  onSaved: () => Promise<void>;
}) {
  const [selected, setSelected] = useState(() => intervalCells(meeting.myIntervals));
  const [allHours, setAllHours] = useState(false);
  const [dirty, setDirty] = useState(false);
  const save = useMutation({
    mutationFn: (body: SaveAvailability) => saveMeetingAvailability(meeting.id, body),
    onSuccess: async () => {
      setDirty(false);
      await onSaved();
    },
  });
  const days = useMemo(() => {
    const groups = new Map<string, Array<{ start: string; label: string }>>();
    const formatter = new Intl.DateTimeFormat('ru', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    for (
      let time = Date.parse(meeting.windowStart);
      time + HALF_HOUR <= Date.parse(meeting.windowEnd);
      time += HALF_HOUR
    ) {
      const date = new Date(time);
      const day = dateInZone(date, timezone);
      const label = formatter.format(date);
      const hour = Number(label.slice(0, 2));
      if (!allHours && (hour < 8 || hour >= 23)) continue;
      const cells = groups.get(day) ?? [];
      cells.push({ start: date.toISOString(), label });
      groups.set(day, cells);
    }
    return [...groups.entries()];
  }, [meeting.windowStart, meeting.windowEnd, timezone, allHours]);
  const change = (starts: string[]) => {
    setSelected((previous) => {
      const next = new Set(previous);
      const remove = starts.every((start) => next.has(start));
      for (const start of starts) {
        if (remove) next.delete(start);
        else next.add(start);
      }
      return next;
    });
    setDirty(true);
  };
  return (
    <section className="detail-section availability-editor">
      <h2>Когда вы свободны?</h2>
      <p className="muted">
        Каждая ячейка — 30 минут. Отметьте несколько подряд для встречи на {meeting.durationMinutes}{' '}
        мин. Время указано в {timezone}.
      </p>
      <div className="card-topline">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={allHours}
            onChange={(event) => setAllHours(event.target.checked)}
          />
          Все часы суток
        </label>
        <button
          className="secondary compact-button"
          disabled={save.isPending}
          onClick={() => {
            setSelected(new Set());
            setDirty(true);
          }}
        >
          Очистить
        </button>
      </div>
      <div className="availability-scroll" aria-label="Сетка свободного времени">
        <div className="availability-days">
          {days.map(([day, cells]) => (
            <div className="availability-day" key={day}>
              <div className="availability-day-heading">
                <strong>
                  {new Intl.DateTimeFormat('ru', {
                    timeZone: 'UTC',
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  }).format(new Date(`${day}T12:00:00Z`))}
                </strong>
                <button
                  className="secondary compact-button"
                  disabled={save.isPending}
                  aria-label={`Выбрать видимые часы ${day}`}
                  onClick={() =>
                    change(
                      cells
                        .filter((cell) => Date.parse(cell.start) > Date.now())
                        .map((cell) => cell.start),
                    )
                  }
                >
                  Выбрать часы
                </button>
              </div>
              {cells.map((cell) => (
                <button
                  key={cell.start}
                  type="button"
                  className="availability-cell"
                  aria-label={`${day} ${cell.label} (${timezone}, ${cell.start})`}
                  title={new Date(cell.start).toLocaleString('ru', {
                    timeZone: timezone,
                    timeZoneName: 'short',
                  })}
                  aria-pressed={selected.has(cell.start)}
                  disabled={save.isPending || Date.parse(cell.start) <= Date.now()}
                  onClick={() => change([cell.start])}
                >
                  {cell.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="muted">
        Выбрано {selected.size} получасовых интервалов.
        {!selected.size && ' Пустой ответ означает, что в этот период вы не можете.'}
      </p>
      <button
        disabled={save.isPending}
        onClick={() => save.mutate({ timezone, intervals: cellsToIntervals(selected) })}
      >
        {save.isPending ? 'Сохраняем…' : 'Сохранить мой ответ'}
      </button>
      {dirty && (
        <p className="muted" role="status">
          Есть несохранённые изменения
        </p>
      )}
      {save.isSuccess && !dirty && (
        <p className="response-saved" role="status">
          Ваш ответ сохранён
        </p>
      )}
      {save.isError && <Feedback error={save.error} />}
    </section>
  );
}
