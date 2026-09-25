CREATE TYPE "chat_context" AS ENUM('GROUP', 'DIALOG');--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "context" "chat_context" DEFAULT 'GROUP'::"chat_context" NOT NULL;