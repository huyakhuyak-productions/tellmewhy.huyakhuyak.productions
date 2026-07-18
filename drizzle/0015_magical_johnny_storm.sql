ALTER TYPE "public"."audit_action" ADD VALUE 'account_deleted';--> statement-breakpoint
ALTER TABLE "user_keys" ALTER COLUMN "wrapped_dek" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "therapist_links" ADD COLUMN "departed_at" timestamp;--> statement-breakpoint
ALTER TABLE "therapist_links" ADD COLUMN "departed_name_ciphertext" text;--> statement-breakpoint
ALTER TABLE "therapist_links" ADD COLUMN "departure_acknowledged_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_keys" ADD COLUMN "shredded_at" timestamp;