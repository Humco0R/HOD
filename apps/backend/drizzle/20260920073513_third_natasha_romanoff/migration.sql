CREATE TYPE "action_event_type" AS ENUM('ACTION_CREATED', 'ACTION_ACCEPTED', 'ACTION_STARTED', 'ACTION_BLOCKED', 'ACTION_UNBLOCKED', 'RESULT_SUBMITTED', 'RESULT_REJECTED', 'RESULT_ACCEPTED', 'DEADLINE_CHANGED', 'ASSIGNEE_CHANGED');--> statement-breakpoint
CREATE TYPE "action_status" AS ENUM('NEW', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'VERIFIED');--> statement-breakpoint
CREATE TYPE "chat_status" AS ENUM('ACTIVE', 'REMOVED', 'LEFT', 'CLOSED');--> statement-breakpoint
CREATE TYPE "deadline_kind" AS ENUM('EXACT_DATETIME', 'DATE_ONLY', 'RELATIVE', 'DEPENDENCY', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "detection_status" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "expected_result_type" AS ENUM('PHOTO', 'FILE', 'TEXT', 'NONE', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "workspace_member_status" AS ENUM('ACTIVE', 'REMOVED');--> statement-breakpoint
CREATE TYPE "workspace_role" AS ENUM('OWNER', 'MEMBER');--> statement-breakpoint
CREATE TABLE "action_detections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"source_message_id" text NOT NULL,
	"source_sender_id" uuid NOT NULL,
	"title" text NOT NULL,
	"suggested_assignee_id" uuid,
	"deadline_kind" "deadline_kind" DEFAULT 'UNKNOWN'::"deadline_kind" NOT NULL,
	"suggested_deadline_at" timestamp with time zone,
	"suggested_deadline_date" date,
	"suggested_deadline_dependency" text,
	"suggested_deadline_raw" text,
	"expected_result_type" "expected_result_type" DEFAULT 'UNKNOWN'::"expected_result_type" NOT NULL,
	"expected_result_text" text,
	"location" text,
	"confidence" real NOT NULL,
	"status" "detection_status" DEFAULT 'PENDING'::"detection_status" NOT NULL,
	"raw_ai_output" jsonb NOT NULL,
	"source_context_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "action_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"action_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" "action_event_type" NOT NULL,
	"from_status" "action_status",
	"to_status" "action_status" NOT NULL,
	"reason" text,
	"metadata" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"detection_id" uuid,
	"workspace_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"assignee_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "action_status" DEFAULT 'NEW'::"action_status" NOT NULL,
	"blocked_from_status" "action_status",
	"deadline_kind" "deadline_kind" DEFAULT 'UNKNOWN'::"deadline_kind" NOT NULL,
	"deadline_at" timestamp with time zone,
	"deadline_date" date,
	"deadline_dependency" text,
	"deadline_raw" text,
	"location" text,
	"expected_result_type" "expected_result_type" DEFAULT 'UNKNOWN'::"expected_result_type" NOT NULL,
	"expected_result_text" text,
	"source_chat_id" uuid NOT NULL,
	"source_message_id" text NOT NULL,
	"source_context_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"event_id" uuid,
	"uploaded_by_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"max_chat_id" bigint NOT NULL,
	"title" text,
	"bot_has_read_access" boolean DEFAULT false NOT NULL,
	"status" "chat_status" DEFAULT 'ACTIVE'::"chat_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"action_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"max_message_id" text NOT NULL,
	"sender_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"text" text,
	"attachment_metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"max_user_id" bigint NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"username" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid,
	"user_id" uuid,
	"role" "workspace_role" NOT NULL,
	"status" "workspace_member_status" DEFAULT 'ACTIVE'::"workspace_member_status" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_pkey" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "detections_chat_source_unique" ON "action_detections" ("chat_id","source_message_id");--> statement-breakpoint
CREATE INDEX "detections_workspace_status_idx" ON "action_detections" ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "action_events_action_idempotency_unique" ON "action_events" ("action_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "action_events_action_created_idx" ON "action_events" ("action_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "actions_detection_unique" ON "actions" ("detection_id");--> statement-breakpoint
CREATE INDEX "actions_workspace_assignee_idx" ON "actions" ("workspace_id","assignee_id");--> statement-breakpoint
CREATE INDEX "actions_workspace_creator_idx" ON "actions" ("workspace_id","creator_id");--> statement-breakpoint
CREATE INDEX "actions_workspace_status_idx" ON "actions" ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_storage_key_unique" ON "attachments" ("storage_key");--> statement-breakpoint
CREATE INDEX "attachments_action_idx" ON "attachments" ("action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chats_max_chat_id_unique" ON "chats" ("max_chat_id");--> statement-breakpoint
CREATE INDEX "chats_workspace_idx" ON "chats" ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_messages_action_message_unique" ON "source_messages" ("action_id","max_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_max_user_id_unique" ON "users" ("max_user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" ("user_id");--> statement-breakpoint
ALTER TABLE "action_detections" ADD CONSTRAINT "action_detections_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "action_detections" ADD CONSTRAINT "action_detections_chat_id_chats_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "action_detections" ADD CONSTRAINT "action_detections_source_sender_id_users_id_fkey" FOREIGN KEY ("source_sender_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "action_detections" ADD CONSTRAINT "action_detections_suggested_assignee_id_users_id_fkey" FOREIGN KEY ("suggested_assignee_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "action_events" ADD CONSTRAINT "action_events_action_id_actions_id_fkey" FOREIGN KEY ("action_id") REFERENCES "actions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "action_events" ADD CONSTRAINT "action_events_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "action_events" ADD CONSTRAINT "action_events_actor_id_users_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_detection_id_action_detections_id_fkey" FOREIGN KEY ("detection_id") REFERENCES "action_detections"("id");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_creator_id_users_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_assignee_id_users_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_source_chat_id_chats_id_fkey" FOREIGN KEY ("source_chat_id") REFERENCES "chats"("id");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_action_id_actions_id_fkey" FOREIGN KEY ("action_id") REFERENCES "actions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_event_id_action_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "action_events"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_users_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_messages" ADD CONSTRAINT "source_messages_action_id_actions_id_fkey" FOREIGN KEY ("action_id") REFERENCES "actions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_messages" ADD CONSTRAINT "source_messages_chat_id_chats_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id");--> statement-breakpoint
ALTER TABLE "source_messages" ADD CONSTRAINT "source_messages_sender_id_users_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id");