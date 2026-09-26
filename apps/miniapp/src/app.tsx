import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';

import type {
  ActionDetail,
  ActionSummary,
  CreateActionRequestDto,
  CurrentUser,
  DetectionEdit,
  TransitionActionRequestDto,
} from '@hod/contracts';

import {
  confirmDetection,
  createAction,
  ensureSession,
  getAction,
  getDetection,
  getStartRoute,
  listActions,
  transitionAction,
  updateDetection,
  uploadProof,
} from './api';

const statusLabels: Record<ActionSummary['status'], string> = {
  NEW: 'Новая',
  ACCEPTED: 'Принята',
  IN_PROGRESS: 'В работе',
  BLOCKED: 'Заблокирована',
  DONE: 'На проверке',
  VERIFIED: 'Завершена',
  CANCELLED: 'Удалена',
};
const attentionLabels: Record<ActionSummary['attentionReasons'][number], string> = {
  OVERDUE: 'Просрочено',
  BLOCKED: 'Есть блокер',
  AWAITING_VERIFICATION: 'Нужна проверка',
  DUE_TODAY: 'Срок сегодня',
};

type ActionCategory = 'all' | 'active' | 'today' | 'overdue' | 'completed' | 'review';
type DeadlineFilter = 'all' | 'today' | 'next7' | 'next30' | 'without-date';

const actionCategories: Array<{ value: ActionCategory; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: '🔥 Активные' },
  { value: 'today', label: '📅 Сегодня' },
  { value: 'overdue', label: '⚠️ Просроченные' },
  { value: 'completed', label: '✅ Выполненные' },
  { value: 'review', label: '🔎 На проверке' },
];

export function App() {
  const navigate = useNavigate();
  const session = useQuery({ queryKey: ['me'], queryFn: ensureSession, retry: false });
  useEffect(() => {
    window.WebApp?.ready?.();
    window.WebApp?.expand?.();
    const route = getStartRoute();
    if (route && window.location.pathname === '/') void navigate(route, { replace: true });
  }, [navigate]);
  if (session.isPending) return <StatusScreen title="Открываем ХОД…" />;
  if (session.isError)
    return <StatusScreen title="Не удалось войти" detail={errorMessage(session.error)} />;
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <span className="brand-mark">ХОД</span>
          <span className="muted">Дела из переписки</span>
        </div>
        <span className="avatar" aria-label={session.data.firstName}>
          {session.data.firstName.slice(0, 1).toUpperCase()}
        </span>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/actions" replace />} />
          <Route path="/actions" element={<ActionListPage view="assigned" title="Мои дела" />} />
          <Route path="/created" element={<ActionListPage view="created" title="От меня" />} />
          <Route path="/team" element={<ActionListPage view="team" title="Команда" />} />
          <Route path="/actions/new" element={<CreateActionPage />} />
          <Route path="/actions/:id" element={<ActionDetailPage me={session.data} />} />
          <Route path="/detections/:id" element={<DetectionPage />} />
          <Route path="*" element={<StatusScreen title="Страница не найдена" />} />
        </Routes>
      </main>
      <nav className="bottom-nav" aria-label="Разделы">
        <NavLink to="/actions">Мои дела</NavLink>
        <NavLink to="/created">От меня</NavLink>
        <NavLink to="/team">Команда</NavLink>
      </nav>
    </div>
  );
}

function ActionListPage({ view, title }: { view: 'assigned' | 'created' | 'team'; title: string }) {
  const query = useQuery({ queryKey: ['actions', view], queryFn: () => listActions(view) });
  const [category, setCategory] = useState<ActionCategory>('all');
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>('all');
  const actions = query.data?.actions ?? [];
  const categoryCounts = useMemo(
    () =>
      Object.fromEntries(
        actionCategories.map(({ value }) => [
          value,
          actions.filter((action) => matchesCategory(action, value)).length,
        ]),
      ) as Record<ActionCategory, number>,
    [actions],
  );
  const visibleActions = useMemo(
    () =>
      sortActions(
        actions.filter(
          (action) => matchesCategory(action, category) && matchesDeadline(action, deadlineFilter),
        ),
        category,
      ),
    [actions, category, deadlineFilter],
  );

  useEffect(() => {
    setCategory('all');
    setDeadlineFilter('all');
  }, [view]);

  return (
    <section>
      <div className="page-title-row">
        <div className="page-title">
          <p className="eyebrow">Рабочее пространство</p>
          <h1>{title}</h1>
        </div>
        <Link className="create-link" to="/actions/new">
          <span aria-hidden="true">＋</span> Создать
        </Link>
      </div>
      {query.isPending && <EmptyState text="Загружаем дела…" />}
      {query.isError && <EmptyState text={errorMessage(query.error)} tone="error" />}
      {query.isSuccess && actions.length > 0 && (
        <div className="action-filters">
          <div className="category-scroller" role="group" aria-label="Категории дел">
            {actionCategories.map((item) => (
              <button
                key={item.value}
                type="button"
                className="filter-chip"
                aria-pressed={category === item.value}
                onClick={() => setCategory(item.value)}
              >
                {item.label} · {categoryCounts[item.value]}
              </button>
            ))}
          </div>
          <div className="filter-toolbar">
            <label>
              <span>Срок</span>
              <select
                aria-label="Фильтр по сроку"
                value={deadlineFilter}
                onChange={(event) => setDeadlineFilter(event.target.value as DeadlineFilter)}
              >
                <option value="all">Любой</option>
                <option value="today">Сегодня</option>
                <option value="next7">Ближайшие 7 дней</option>
                <option value="next30">Ближайшие 30 дней</option>
                <option value="without-date">Без календарной даты</option>
              </select>
            </label>
            <span className="filter-result">
              {visibleActions.length} из {actions.length}
            </span>
          </div>
        </div>
      )}
      {query.isSuccess && actions.length === 0 && <EmptyState text="Здесь пока нет дел." />}
      {query.isSuccess && actions.length > 0 && visibleActions.length === 0 && (
        <EmptyState text="По выбранным фильтрам дел нет." />
      )}
      <div className="card-list">
        {visibleActions.map((action) => (
          <ActionCard key={action.id} action={action} />
        ))}
      </div>
    </section>
  );
}

function CreateActionPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadlineKind, setDeadlineKind] =
    useState<CreateActionRequestDto['deadlineKind']>('UNKNOWN');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineDateTime, setDeadlineDateTime] = useState('');
  const create = useMutation({
    mutationFn: (body: CreateActionRequestDto) => createAction(body),
    onSuccess: async ({ id }) => {
      await client.invalidateQueries({ queryKey: ['actions'] });
      void navigate(`/actions/${id}`, { replace: true });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({
      title: title.trim(),
      description: description.trim() || null,
      deadlineKind,
      deadlineDate: deadlineKind === 'DATE_ONLY' ? deadlineDate : null,
      deadlineAt:
        deadlineKind === 'EXACT_DATETIME' && deadlineDateTime
          ? new Date(deadlineDateTime).toISOString()
          : null,
      idempotencyKey,
    });
  };

  return (
    <section className="detail create-page">
      <Link className="back-link" to="/actions">
        ← К моим делам
      </Link>
      <p className="eyebrow">Личное дело</p>
      <h1>Создать дело</h1>
      <form className="editor stack" onSubmit={submit}>
        <label>
          Название
          <input
            autoFocus
            required
            maxLength={200}
            placeholder="Например, подготовить презентацию"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Описание
          <textarea
            maxLength={2_000}
            rows={4}
            placeholder="Необязательно"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <p className="muted">Дело будет создано для вас.</p>
        <label>
          Срок
          <select
            value={deadlineKind}
            onChange={(event) => {
              setDeadlineKind(event.target.value as CreateActionRequestDto['deadlineKind']);
            }}
          >
            <option value="UNKNOWN">Без срока</option>
            <option value="DATE_ONLY">Дата</option>
            <option value="EXACT_DATETIME">Дата и время</option>
          </select>
        </label>
        {deadlineKind === 'DATE_ONLY' && (
          <label>
            Дата выполнения
            <input
              type="date"
              required
              min={todayInputValue()}
              value={deadlineDate}
              onChange={(event) => setDeadlineDate(event.target.value)}
            />
          </label>
        )}
        {deadlineKind === 'EXACT_DATETIME' && (
          <label>
            Дата и время выполнения
            <input
              type="datetime-local"
              required
              min={dateTimeInputValue(new Date())}
              value={deadlineDateTime}
              onChange={(event) => setDeadlineDateTime(event.target.value)}
            />
          </label>
        )}
        <button disabled={create.isPending || !title.trim()}>
          {create.isPending ? 'Создаём…' : 'Создать дело'}
        </button>
        {create.isError && <p className="form-error">{errorMessage(create.error)}</p>}
      </form>
    </section>
  );
}

export function ActionCard({ action }: { action: ActionSummary }) {
  return (
    <Link className="action-card" to={`/actions/${action.id}`}>
      <div className="card-topline">
        <span className={`status status-${action.status.toLowerCase()}`}>
          {statusLabels[action.status]}
        </span>
        <span className="muted">{formatDeadline(action)}</span>
      </div>
      <h2>{action.title}</h2>
      <p className="muted">Исполнитель: {personName(action.assignee)}</p>
      {action.attentionReasons.length > 0 && (
        <div className="attention-row">
          {action.attentionReasons.map((reason) => (
            <span key={reason}>{attentionLabels[reason]}</span>
          ))}
        </div>
      )}
    </Link>
  );
}

function ActionDetailPage({ me }: { me: CurrentUser }) {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['action', id],
    queryFn: () => getAction(id),
    enabled: Boolean(id),
  });
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const transition = useMutation({
    mutationFn: (command: TransitionActionRequestDto['command']) =>
      transitionAction(id, {
        command,
        idempotencyKey: crypto.randomUUID(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: async () => {
      setReason('');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['action', id] }),
        client.invalidateQueries({ queryKey: ['actions'] }),
      ]);
    },
  });
  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Выберите файл');
      return uploadProof(id, file);
    },
    onSuccess: async () => {
      setFile(null);
      await client.invalidateQueries({ queryKey: ['action', id] });
    },
  });
  if (query.isPending) return <EmptyState text="Загружаем дело…" />;
  if (query.isError) return <EmptyState text={errorMessage(query.error)} tone="error" />;
  const action = query.data;
  const isAssignee = action.assignee.id === me.id;
  const isCreator = action.creator.id === me.id;
  return (
    <article className="detail">
      <Link className="back-link" to="/actions">
        ← К списку
      </Link>
      <div className="card-topline">
        <span className={`status status-${action.status.toLowerCase()}`}>
          {statusLabels[action.status]}
        </span>
        <span className="muted">{formatDeadline(action)}</span>
      </div>
      <h1>{action.title}</h1>
      {action.description && <p>{action.description}</p>}
      <dl className="facts">
        <div>
          <dt>Исполнитель</dt>
          <dd>{personName(action.assignee)}</dd>
        </div>
        <div>
          <dt>Постановщик</dt>
          <dd>{personName(action.creator)}</dd>
        </div>
        {action.location && (
          <div>
            <dt>Место</dt>
            <dd>{action.location}</dd>
          </div>
        )}
        <div>
          <dt>Результат</dt>
          <dd>{resultLabel(action)}</dd>
        </div>
      </dl>
      {action.sourceContext.length > 0 && (
        <DetailSection title="Исходный контекст">
          {action.sourceContext.map((message) => (
            <p className="source-message" key={message.messageId}>
              {message.text}
            </p>
          ))}
        </DetailSection>
      )}
      {action.attachments.length > 0 && (
        <DetailSection title="Доказательства">
          <div className="attachment-list">
            {action.attachments.map((item) => (
              <a key={item.id} href={item.downloadUrl}>
                {item.originalName}
              </a>
            ))}
          </div>
        </DetailSection>
      )}
      {isAssignee && ['IN_PROGRESS', 'BLOCKED'].includes(action.status) && (
        <DetailSection title="Добавить результат">
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              upload.mutate();
            }}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <button className="secondary" disabled={!file || upload.isPending}>
              Загрузить файл
            </button>
          </form>
          {upload.isError && <p className="form-error">{errorMessage(upload.error)}</p>}
        </DetailSection>
      )}
      <ActionControls
        action={action}
        isAssignee={isAssignee}
        isCreator={isCreator}
        reason={reason}
        setReason={setReason}
        run={(command) => transition.mutate(command)}
        pending={transition.isPending}
      />
      {transition.isError && <p className="form-error">{errorMessage(transition.error)}</p>}
    </article>
  );
}

function ActionControls({
  action,
  isAssignee,
  isCreator,
  reason,
  setReason,
  run,
  pending,
}: {
  action: ActionDetail;
  isAssignee: boolean;
  isCreator: boolean;
  reason: string;
  setReason: (value: string) => void;
  run: (command: TransitionActionRequestDto['command']) => void;
  pending: boolean;
}) {
  const needsReason = action.status === 'IN_PROGRESS' || action.status === 'DONE';
  return (
    <section className="action-panel">
      {needsReason && (
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={
            action.status === 'DONE' ? 'Что нужно исправить' : 'Комментарий или результат'
          }
          rows={3}
        />
      )}
      <div className="button-row">
        {isAssignee && action.status === 'NEW' && (
          <button disabled={pending} onClick={() => run('ACCEPT')}>
            Принять
          </button>
        )}
        {isAssignee && action.status === 'ACCEPTED' && (
          <button disabled={pending} onClick={() => run('START')}>
            Начать
          </button>
        )}
        {isAssignee && action.status === 'IN_PROGRESS' && (
          <button disabled={pending} onClick={() => run('SUBMIT_RESULT')}>
            Готово
          </button>
        )}
        {isAssignee && action.status === 'BLOCKED' && (
          <button disabled={pending} onClick={() => run('UNBLOCK')}>
            Продолжить
          </button>
        )}
        {isCreator && action.status === 'DONE' && (
          <>
            <button
              className="secondary"
              disabled={pending || !reason.trim()}
              onClick={() => run('RETURN')}
            >
              Вернуть
            </button>
            <button disabled={pending} onClick={() => run('VERIFY')}>
              Подтвердить
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function DetectionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['detection', id],
    queryFn: () => getDetection(id),
    enabled: Boolean(id),
  });
  const [form, setForm] = useState<DetectionEdit | null>(null);
  useEffect(() => {
    if (query.data && !form) {
      const {
        title,
        assigneeId,
        deadlineKind,
        deadlineAt,
        deadlineDate,
        deadlineDependency,
        deadlineRaw,
        expectedResultType,
        expectedResultText,
        location,
      } = query.data;
      setForm({
        title,
        assigneeId: assigneeId ?? '',
        deadlineKind,
        deadlineAt,
        deadlineDate,
        deadlineDependency,
        deadlineRaw,
        expectedResultType,
        expectedResultText,
        location,
      });
    }
  }, [query.data, form]);
  const save = useMutation({
    mutationFn: (value: DetectionEdit) => updateDetection(id, value),
    onSuccess: (detection) => {
      if (!detection.assigneeId) return;
      const {
        title,
        assigneeId,
        deadlineKind,
        deadlineAt,
        deadlineDate,
        deadlineDependency,
        deadlineRaw,
        expectedResultType,
        expectedResultText,
        location,
      } = detection;
      setForm({
        title,
        assigneeId,
        deadlineKind,
        deadlineAt,
        deadlineDate,
        deadlineDependency,
        deadlineRaw,
        expectedResultType,
        expectedResultText,
        location,
      });
    },
  });
  const confirm = useMutation({
    mutationFn: async (value: DetectionEdit) => {
      await updateDetection(id, value);
      return confirmDetection(id);
    },
    onSuccess: ({ actionId }) => void navigate(`/actions/${actionId}`),
  });
  if (query.isPending || !form)
    return (
      <EmptyState
        text={query.isError ? errorMessage(query.error) : 'Загружаем предложение…'}
        {...(query.isError ? { tone: 'error' as const } : {})}
      />
    );
  const detection = query.data;
  if (!detection) return <EmptyState text="Предложение не найдено" tone="error" />;
  const update = <K extends keyof DetectionEdit>(key: K, value: DetectionEdit[K]) =>
    setForm({ ...form, [key]: value });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(form);
  };
  return (
    <section className="detail">
      <p className="eyebrow">Проверьте перед созданием</p>
      <h1>Новое дело</h1>
      <form className="editor stack" onSubmit={submit}>
        <label>
          Что сделать
          <input
            required
            maxLength={500}
            value={form.title}
            onChange={(event) => update('title', event.target.value)}
          />
        </label>
        <label>
          Исполнитель
          <select
            value={form.assigneeId}
            onChange={(event) => update('assigneeId', event.target.value)}
          >
            <option value="" disabled>
              Выберите исполнителя
            </option>
            {detection.members.map((member) => (
              <option key={member.id} value={member.id}>
                {personName(member)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Тип срока
          <select
            value={form.deadlineKind}
            onChange={(event) =>
              update('deadlineKind', event.target.value as DetectionEdit['deadlineKind'])
            }
          >
            <option value="UNKNOWN">Не указан</option>
            <option value="DATE_ONLY">Дата</option>
            <option value="EXACT_DATETIME">Дата и время</option>
            <option value="RELATIVE">Относительный</option>
            <option value="DEPENDENCY">После события</option>
          </select>
        </label>
        {form.deadlineKind === 'DATE_ONLY' && (
          <label>
            Дата
            <input
              type="date"
              required
              value={form.deadlineDate ?? ''}
              onChange={(event) => update('deadlineDate', event.target.value || null)}
            />
          </label>
        )}
        {form.deadlineKind === 'EXACT_DATETIME' && (
          <label>
            Дата и время
            <input
              type="datetime-local"
              required
              value={form.deadlineAt?.slice(0, 16) ?? ''}
              onChange={(event) =>
                update(
                  'deadlineAt',
                  event.target.value ? new Date(event.target.value).toISOString() : null,
                )
              }
            />
          </label>
        )}
        {form.deadlineKind === 'DEPENDENCY' && (
          <label>
            Зависимость
            <input
              required
              value={form.deadlineDependency ?? ''}
              onChange={(event) => update('deadlineDependency', event.target.value || null)}
            />
          </label>
        )}
        {form.deadlineKind === 'RELATIVE' && (
          <label>
            Срок как в сообщении
            <input
              value={form.deadlineRaw ?? ''}
              onChange={(event) => update('deadlineRaw', event.target.value || null)}
            />
          </label>
        )}
        <label>
          Ожидаемый результат
          <select
            value={form.expectedResultType}
            onChange={(event) =>
              update(
                'expectedResultType',
                event.target.value as DetectionEdit['expectedResultType'],
              )
            }
          >
            <option value="NONE">Не требуется</option>
            <option value="PHOTO">Фото</option>
            <option value="FILE">Файл</option>
            <option value="TEXT">Текст</option>
            <option value="UNKNOWN">Неясно</option>
          </select>
        </label>
        {form.expectedResultType === 'TEXT' && (
          <label>
            Описание результата
            <input
              value={form.expectedResultText ?? ''}
              onChange={(event) => update('expectedResultText', event.target.value || null)}
            />
          </label>
        )}
        <label>
          Место
          <input
            value={form.location ?? ''}
            onChange={(event) => update('location', event.target.value || null)}
          />
        </label>
        <button className="secondary" disabled={save.isPending}>
          Сохранить изменения
        </button>
        <button
          type="button"
          disabled={!form.assigneeId || save.isPending || confirm.isPending}
          onClick={() => confirm.mutate(form)}
        >
          Создать дело
        </button>
        {(save.isError || confirm.isError) && (
          <p className="form-error">{errorMessage(save.error ?? confirm.error)}</p>
        )}
      </form>
    </section>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function StatusScreen({ title, detail }: { title: string; detail?: string }) {
  return (
    <main className="status-screen">
      <span className="brand-mark large">ХОД</span>
      <h1>{title}</h1>
      {detail && <p>{detail}</p>}
    </main>
  );
}
function EmptyState({ text, tone }: { text: string; tone?: 'error' }) {
  return <div className={`empty-state ${tone ?? ''}`}>{text}</div>;
}
function personName(person: { firstName: string; lastName: string | null }): string {
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}
function formatDeadline(action: ActionSummary): string {
  if (action.deadlineAt)
    return new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(action.deadlineAt),
    );
  if (action.deadlineDate)
    return new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${action.deadlineDate}T00:00:00Z`),
    );
  return action.deadlineDependency ?? action.deadlineRaw ?? 'Без срока';
}

function matchesCategory(action: ActionSummary, category: ActionCategory): boolean {
  if (action.status === 'CANCELLED') return false;
  switch (category) {
    case 'all':
      return true;
    case 'active':
      return action.status !== 'DONE' && action.status !== 'VERIFIED';
    case 'today':
      return action.attentionReasons.includes('DUE_TODAY');
    case 'overdue':
      return action.attentionReasons.includes('OVERDUE');
    case 'completed':
      return action.status === 'DONE' || action.status === 'VERIFIED';
    case 'review':
      return action.status === 'DONE';
  }
}

function matchesDeadline(action: ActionSummary, filter: DeadlineFilter): boolean {
  if (filter === 'all') return true;
  const deadline = calendarDeadline(action);
  if (filter === 'without-date') return deadline === null;
  if (!deadline) return false;
  const today = startOfDay(new Date());
  if (filter === 'today') return deadline.getTime() === today.getTime();
  const days = filter === 'next7' ? 7 : 30;
  const end = new Date(today);
  end.setDate(end.getDate() + days);
  return deadline >= today && deadline < end;
}

function calendarDeadline(action: ActionSummary): Date | null {
  if (action.deadlineAt) return startOfDay(new Date(action.deadlineAt));
  if (action.deadlineDate) return new Date(`${action.deadlineDate}T00:00:00`);
  return null;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function todayInputValue(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateTimeInputValue(value: Date): string {
  const year = String(value.getFullYear());
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function sortActions(actions: ActionSummary[], category: ActionCategory): ActionSummary[] {
  return [...actions].sort((left, right) => {
    if (category === 'completed' || category === 'review') {
      return right.updatedAt.localeCompare(left.updatedAt);
    }
    const leftDeadline = calendarDeadline(left)?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightDeadline = calendarDeadline(right)?.getTime() ?? Number.POSITIVE_INFINITY;
    return leftDeadline - rightDeadline || right.updatedAt.localeCompare(left.updatedAt);
  });
}
function resultLabel(action: ActionDetail): string {
  return (
    action.expectedResultText ??
    (
      {
        PHOTO: 'Фото',
        FILE: 'Файл',
        TEXT: 'Текст',
        NONE: 'Не требуется',
        UNKNOWN: 'Не указан',
      } as const
    )[action.expectedResultType]
  );
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка';
}
