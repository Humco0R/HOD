\set ON_ERROR_STOP on

BEGIN;

DELETE FROM outbox_events
WHERE payload::text LIKE '%00000000-0000-4000-8000-000000000301%'
   OR payload::text LIKE '%00000000-0000-4000-8000-000000000302%';
DELETE FROM workspaces
WHERE id IN (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102'
);
DELETE FROM users
WHERE id IN (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003'
);

INSERT INTO users (id, max_user_id, first_name, last_name, username)
VALUES
  ('00000000-0000-4000-8000-000000000001', 990000001, 'API', 'Creator', 'api_creator'),
  ('00000000-0000-4000-8000-000000000002', 990000002, 'API', 'Assignee', 'api_assignee'),
  ('00000000-0000-4000-8000-000000000003', 990000003, 'API', 'Outsider', 'api_outsider');

INSERT INTO workspaces (id, name, owner_id, settings)
VALUES
  (
    '00000000-0000-4000-8000-000000000101',
    'API verification workspace',
    '00000000-0000-4000-8000-000000000001',
    '{"timezone":"Asia/Krasnoyarsk"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    'API isolated workspace',
    '00000000-0000-4000-8000-000000000003',
    '{"timezone":"UTC"}'::jsonb
  );

INSERT INTO workspace_members (workspace_id, user_id, role, status)
VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'OWNER', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 'MEMBER', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000003', 'OWNER', 'ACTIVE');

INSERT INTO chats (id, workspace_id, max_chat_id, context, title, bot_has_read_access)
VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 990001001, 'GROUP', 'API verification chat', true),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000102', 990001002, 'GROUP', 'API isolated chat', true);

INSERT INTO actions (
  id, workspace_id, creator_id, assignee_id, title, description, status,
  expected_result_type, source_chat_id, source_message_id, source_context_snapshot
)
VALUES
  (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    'API proof lifecycle check',
    'Deterministic local verification action',
    'NEW',
    'PHOTO',
    '00000000-0000-4000-8000-000000000201',
    'api-seed-main',
    '[]'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000003',
    'API cross-workspace isolation check',
    'Must not be visible from the main workspace',
    'NEW',
    'NONE',
    '00000000-0000-4000-8000-000000000202',
    'api-seed-foreign',
    '[]'::jsonb
  );

COMMIT;
