ALTER TABLE "conversations" ADD COLUMN "active_leaf_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "hidden_at" timestamp;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_parent_id_messages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_parent_id_idx" ON "messages" USING btree ("parent_id");