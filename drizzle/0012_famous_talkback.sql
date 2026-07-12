CREATE TABLE "self_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"body_ciphertext" text NOT NULL,
	"source_message_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "self_notes" ADD CONSTRAINT "self_notes_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "self_notes_user_id_idx" ON "self_notes" USING btree ("user_id");