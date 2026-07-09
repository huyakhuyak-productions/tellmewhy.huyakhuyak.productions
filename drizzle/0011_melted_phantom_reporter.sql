CREATE TYPE "public"."exercise_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."exercise_type" AS ENUM('thought_record');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'exercise_assigned';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'entry_shared';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'entry_viewed';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'mood_trend_viewed';--> statement-breakpoint
CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"body_ciphertext" text NOT NULL,
	"covers_up_to_message_id" uuid NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "digests_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
CREATE TABLE "exercise_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"exercise_id" uuid,
	"payload_ciphertext" text NOT NULL,
	"shared_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"type" "exercise_type" NOT NULL,
	"instruction_ciphertext" text NOT NULL,
	"status" "exercise_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mood_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "therapist_links" ADD COLUMN "mood_shared_at" timestamp;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_entries" ADD CONSTRAINT "exercise_entries_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_link_id_therapist_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."therapist_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_entries_user_id_idx" ON "exercise_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "exercise_entries_exercise_id_idx" ON "exercise_entries" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "exercises_client_id_idx" ON "exercises" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mood_checkins_user_day_idx" ON "mood_checkins" USING btree ("user_id","day");