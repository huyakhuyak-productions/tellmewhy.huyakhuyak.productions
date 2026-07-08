CREATE TYPE "public"."audit_action" AS ENUM('link_invited', 'link_accepted', 'link_revoked', 'grant_created', 'grant_revoked', 'conversation_viewed', 'review_marker_advanced', 'intervention_sent', 'note_published');--> statement-breakpoint
CREATE TYPE "public"."link_initiator" AS ENUM('client', 'therapist');--> statement-breakpoint
CREATE TYPE "public"."link_status" AS ENUM('invited', 'active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."note_kind" AS ENUM('private', 'public', 'ai_instruction');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"therapist_id" text,
	"conversation_id" uuid,
	"action" "audit_action" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"conversation_id" uuid,
	"kind" "note_kind" NOT NULL,
	"body_ciphertext" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_markers" (
	"link_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"last_reviewed_message_id" uuid NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_markers_link_id_conversation_id_pk" PRIMARY KEY("link_id","conversation_id")
);
--> statement-breakpoint
CREATE TABLE "sharing_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "therapist_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text,
	"therapist_id" text,
	"initiated_by" "link_initiator" NOT NULL,
	"invite_token_hash" text NOT NULL,
	"status" "link_status" DEFAULT 'invited' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "therapist_links_invite_token_hash_unique" UNIQUE("invite_token_hash")
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_link_id_therapist_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."therapist_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_markers" ADD CONSTRAINT "review_markers_link_id_therapist_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."therapist_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_markers" ADD CONSTRAINT "review_markers_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sharing_grants" ADD CONSTRAINT "sharing_grants_link_id_therapist_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."therapist_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sharing_grants" ADD CONSTRAINT "sharing_grants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_client_idx" ON "audit_events" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sharing_grants_link_conversation_idx" ON "sharing_grants" USING btree ("link_id","conversation_id");