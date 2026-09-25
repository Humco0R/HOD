import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const workspaceRoleEnum = pgEnum('workspace_role', ['OWNER', 'MEMBER']);
export const workspaceMemberStatusEnum = pgEnum('workspace_member_status', ['ACTIVE', 'REMOVED']);
export const chatStatusEnum = pgEnum('chat_status', ['ACTIVE', 'REMOVED', 'LEFT', 'CLOSED']);
export const chatContextEnum = pgEnum('chat_context', ['GROUP', 'DIALOG']);
export const detectionStatusEnum = pgEnum('detection_status', [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
]);
export const actionStatusEnum = pgEnum('action_status', [
  'NEW',
  'ACCEPTED',
  'IN_PROGRESS',
  'BLOCKED',
  'DONE',
  'VERIFIED',
  'CANCELLED',
]);
export const deadlineKindEnum = pgEnum('deadline_kind', [
  'EXACT_DATETIME',
  'DATE_ONLY',
  'RELATIVE',
  'DEPENDENCY',
  'UNKNOWN',
]);
export const expectedResultTypeEnum = pgEnum('expected_result_type', [
  'PHOTO',
  'FILE',
  'TEXT',
  'NONE',
  'UNKNOWN',
]);
export const outboxStatusEnum = pgEnum('outbox_status', [
  'PENDING',
  'PROCESSING',
  'PUBLISHED',
  'FAILED',
]);
export const actionEventTypeEnum = pgEnum('action_event_type', [
  'ACTION_CREATED',
  'ACTION_ACCEPTED',
  'ACTION_STARTED',
  'ACTION_BLOCKED',
  'ACTION_UNBLOCKED',
  'RESULT_SUBMITTED',
  'RESULT_REJECTED',
  'RESULT_ACCEPTED',
  'ACTION_CANCELLED',
  'DEADLINE_CHANGED',
  'ASSIGNEE_CHANGED',
]);

export interface WorkspaceSettings {
  timezone: string;
}

export interface SourceContextMessage {
  messageId: string;
  senderMaxUserId: string;
  timestamp: string;
  text: string | null;
}

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    maxUserId: bigint('max_user_id', { mode: 'bigint' }).notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    username: text('username'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('users_max_user_id_unique').on(table.maxUserId)],
);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  settings: jsonb('settings').$type<WorkspaceSettings>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRoleEnum('role').notNull(),
    status: workspaceMemberStatusEnum('status').default('ACTIVE').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index('workspace_members_user_idx').on(table.userId),
  ],
);

export const chats = pgTable(
  'chats',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    maxChatId: bigint('max_chat_id', { mode: 'bigint' }),
    context: chatContextEnum('context').default('GROUP').notNull(),
    title: text('title'),
    botHasReadAccess: boolean('bot_has_read_access').default(false).notNull(),
    status: chatStatusEnum('status').default('ACTIVE').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('chats_max_chat_id_unique').on(table.maxChatId),
    index('chats_workspace_idx').on(table.workspaceId),
  ],
);

export const actionDetections = pgTable(
  'action_detections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    sourceMessageId: text('source_message_id').notNull(),
    sourceSenderId: uuid('source_sender_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    suggestedAssigneeId: uuid('suggested_assignee_id').references(() => users.id),
    deadlineKind: deadlineKindEnum('deadline_kind').default('UNKNOWN').notNull(),
    suggestedDeadlineAt: timestamp('suggested_deadline_at', { withTimezone: true }),
    suggestedDeadlineDate: date('suggested_deadline_date'),
    suggestedDeadlineDependency: text('suggested_deadline_dependency'),
    suggestedDeadlineRaw: text('suggested_deadline_raw'),
    expectedResultType: expectedResultTypeEnum('expected_result_type').default('UNKNOWN').notNull(),
    expectedResultText: text('expected_result_text'),
    location: text('location'),
    confidence: real('confidence').notNull(),
    status: detectionStatusEnum('status').default('PENDING').notNull(),
    rawAiOutput: jsonb('raw_ai_output').$type<Record<string, unknown>>().notNull(),
    sourceContextSnapshot: jsonb('source_context_snapshot')
      .$type<SourceContextMessage[]>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('detections_chat_source_unique').on(table.chatId, table.sourceMessageId),
    index('detections_workspace_status_idx').on(table.workspaceId, table.status),
  ],
);

export const actions = pgTable(
  'actions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    detectionId: uuid('detection_id').references(() => actionDetections.id),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => users.id),
    assigneeId: uuid('assignee_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    status: actionStatusEnum('status').default('NEW').notNull(),
    blockedFromStatus: actionStatusEnum('blocked_from_status'),
    deadlineKind: deadlineKindEnum('deadline_kind').default('UNKNOWN').notNull(),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    deadlineDate: date('deadline_date'),
    deadlineDependency: text('deadline_dependency'),
    deadlineRaw: text('deadline_raw'),
    location: text('location'),
    expectedResultType: expectedResultTypeEnum('expected_result_type').default('UNKNOWN').notNull(),
    expectedResultText: text('expected_result_text'),
    sourceChatId: uuid('source_chat_id')
      .notNull()
      .references(() => chats.id),
    sourceMessageId: text('source_message_id').notNull(),
    sourceContextSnapshot: jsonb('source_context_snapshot')
      .$type<SourceContextMessage[]>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('actions_detection_unique').on(table.detectionId),
    index('actions_workspace_assignee_idx').on(table.workspaceId, table.assigneeId),
    index('actions_workspace_creator_idx').on(table.workspaceId, table.creatorId),
    index('actions_workspace_status_idx').on(table.workspaceId, table.status),
  ],
);

export const sourceMessages = pgTable(
  'source_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actionId: uuid('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id),
    maxMessageId: text('max_message_id').notNull(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    text: text('text'),
    attachmentMetadata: jsonb('attachment_metadata').$type<Record<string, unknown>[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('source_messages_action_message_unique').on(table.actionId, table.maxMessageId),
  ],
);

export const actionEvents = pgTable(
  'action_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actionId: uuid('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    type: actionEventTypeEnum('type').notNull(),
    fromStatus: actionStatusEnum('from_status'),
    toStatus: actionStatusEnum('to_status').notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('action_events_action_idempotency_unique').on(table.actionId, table.idempotencyKey),
    index('action_events_action_created_idx').on(table.actionId, table.createdAt),
  ],
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actionId: uuid('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => actionEvents.id, { onDelete: 'set null' }),
    uploadedById: uuid('uploaded_by_id')
      .notNull()
      .references(() => users.id),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('attachments_storage_key_unique').on(table.storageKey),
    index('attachments_action_idx').on(table.actionId),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    topic: text('topic').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: outboxStatusEnum('status').default('PENDING').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('outbox_events_dedupe_unique').on(table.dedupeKey),
    index('outbox_events_dispatch_idx').on(table.status, table.availableAt),
  ],
);
