CREATE TYPE "meeting_status" AS ENUM('OPEN', 'SCHEDULED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "meeting_participants" (
	"meeting_id" uuid,
	"user_id" uuid,
	"responded_at" timestamp with time zone,
	"intervals" jsonb DEFAULT '[]' NOT NULL,
	CONSTRAINT "meeting_participants_pkey" PRIMARY KEY("meeting_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organizer_id" uuid NOT NULL,
	"chat_id" uuid,
	"action_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"duration_minutes" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"invite_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" "meeting_status" DEFAULT 'OPEN'::"meeting_status" NOT NULL,
	"scheduled_start" timestamp with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" text;--> statement-breakpoint
CREATE INDEX "meeting_participants_user_idx" ON "meeting_participants" ("user_id");--> statement-breakpoint
CREATE INDEX "meetings_organizer_idx" ON "meetings" ("organizer_id");--> statement-breakpoint
CREATE INDEX "meetings_status_idx" ON "meetings" ("status");--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_meetings_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizer_id_users_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_chat_id_chats_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_action_id_actions_id_fkey" FOREIGN KEY ("action_id") REFERENCES "actions"("id") ON DELETE SET NULL;