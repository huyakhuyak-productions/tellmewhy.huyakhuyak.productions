import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";

export const senderEnum = pgEnum("sender", ["client", "ai", "therapist", "system"]);
export const riskLevelEnum = pgEnum("risk_level", ["none", "elevated", "crisis"]);
export const exerciseTypeEnum = pgEnum("exercise_type", ["thought_record"]);
export const exerciseStatusEnum = pgEnum("exercise_status", ["active", "closed"]);

// One wrapped DEK per user. Deleting the row = crypto-shredding all their data.
export const userKeys = pgTable("user_keys", {
  userId: text("user_id").primaryKey(),
  wrappedDek: text("wrapped_dek").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// User-defined conversation folders. Names are topic metadata
// ("relationships", "health") — encrypted like conversation titles.
export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    nameCiphertext: text("name_ciphertext").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("folders_user_id_idx").on(table.userId)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Intentionally no FK to `user.id`: existing rows include orphaned
    // smoke-test user ids not present in the `user` table, so a FK add
    // fails against real data (verified against the dev database — see
    // Task 6 report). Indexed for lookup performance regardless.
    userId: text("user_id").notNull(),
    titleCiphertext: text("title_ciphertext").notNull(),
    // null = unsorted. Deleting a folder unsorts its conversations.
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // True once a human renamed the conversation — auto-titling must never overwrite.
    titleCustomized: boolean("title_customized").notNull().default(false),
  },
  (table) => [index("conversations_user_id_idx").on(table.userId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sender: senderEnum("sender").notNull(),
    ciphertext: text("ciphertext").notNull(),
    riskLevel: riskLevelEnum("risk_level").notNull().default("none"),
    flaggedAt: timestamp("flagged_at"), // "flag for my therapist" — used from phase 2
    // Author of therapist-sent messages (user id); null for client/ai/system.
    authorId: text("author_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("messages_conversation_id_idx").on(table.conversationId)],
);

export const linkStatusEnum = pgEnum("link_status", ["invited", "active", "revoked"]);
export const linkInitiatorEnum = pgEnum("link_initiator", ["client", "therapist"]);
export const noteKindEnum = pgEnum("note_kind", ["private", "public", "ai_instruction"]);
export const auditActionEnum = pgEnum("audit_action", [
  "link_invited", "link_accepted", "link_revoked",
  "grant_created", "grant_revoked",
  "conversation_viewed", "review_marker_advanced",
  "intervention_sent", "note_published",
  "attention_viewed",
  "exercise_assigned", "entry_shared", "entry_viewed", "mood_trend_viewed",
]);

export const therapistLinks = pgTable(
  "therapist_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: text("client_id"),          // null until accepted when therapist-initiated
    therapistId: text("therapist_id"),    // null until accepted when client-initiated
    initiatedBy: linkInitiatorEnum("initiated_by").notNull(),
    inviteTokenHash: text("invite_token_hash").notNull().unique(),
    status: linkStatusEnum("status").notNull().default("invited"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at"),
    revokedAt: timestamp("revoked_at"),
    moodSharedAt: timestamp("mood_shared_at"),
  },
  (t) => [
    // Structural enforcement of the one-therapist-per-client rule: Postgres
    // treats NULLs as non-colliding, so therapist-initiated invites (clientId
    // still NULL) are unaffected until accepted.
    uniqueIndex("therapist_links_one_per_client_idx")
      .on(t.clientId)
      .where(sql`${t.clientId} IS NOT NULL AND ${t.status} IN ('invited', 'active')`),
  ],
);

export const sharingGrants = pgTable("sharing_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  linkId: uuid("link_id").notNull().references(() => therapistLinks.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("sharing_grants_link_conversation_idx").on(t.linkId, t.conversationId)]);

export const reviewMarkers = pgTable("review_markers", {
  linkId: uuid("link_id").notNull().references(() => therapistLinks.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  lastReviewedMessageId: uuid("last_reviewed_message_id").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.linkId, t.conversationId] })]);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    linkId: uuid("link_id").notNull().references(() => therapistLinks.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id"), // null = client-scoped
    kind: noteKindEnum("kind").notNull(),
    bodyCiphertext: text("body_ciphertext").notNull(), // therapist's DEK
    version: integer("version").notNull().default(1),  // meaningful for ai_instruction
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Structural enforcement of one version number per (link, ai_instruction)
    // series: the max-read + insert in createNote is check-then-write and can
    // lose a race to a concurrent create for the same link — this index is
    // what actually stops two rows from landing at the same version. Other
    // kinds are never versioned past 1, so they're unaffected by the filter.
    uniqueIndex("notes_instruction_version_idx")
      .on(t.linkId, t.version)
      .where(sql`${t.kind} = 'ai_instruction'`),
  ],
);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id").notNull(),
  therapistId: text("therapist_id"),
  // Who performed the action — null on rows written before this column
  // existed. audit-copy.ts falls back to a neutral phrasing for those legacy
  // rows rather than guessing which party did it.
  actorId: text("actor_id"),
  conversationId: uuid("conversation_id"),
  action: auditActionEnum("action").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("audit_events_client_idx").on(t.clientId, t.createdAt)]);

// One check-in per user per day; payload = {score: 1-5, note?} under the
// client's DEK. A repeat check-in on the same day updates the row.
export const moodCheckins = pgTable("mood_checkins", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  day: date("day").notNull(),
  payloadCiphertext: text("payload_ciphertext").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("mood_checkins_user_day_idx").on(t.userId, t.day)]);

// Latest-only digest per conversation; body (summary + anchors JSON) under
// the CLIENT's DEK. covers_up_to_message_id/generated_at stay plaintext —
// ids + times only, the audit discipline.
export const digests = pgTable("digests", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().unique()
    .references(() => conversations.id, { onDelete: "cascade" }),
  bodyCiphertext: text("body_ciphertext").notNull(),
  coversUpToMessageId: uuid("covers_up_to_message_id").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

// Therapist-assigned exercise; instruction is therapist-authored but
// client-visible → CLIENT's DEK (the interventions law).
export const exercises = pgTable("exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  linkId: uuid("link_id").notNull().references(() => therapistLinks.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  type: exerciseTypeEnum("type").notNull(),
  instructionCiphertext: text("instruction_ciphertext").notNull(),
  status: exerciseStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("exercises_client_id_idx").on(t.clientId)]);

// A completed thought record. exercise_id null = self-guided. shared_at null
// = private forever unless the client shares this one entry.
export const exerciseEntries = pgTable("exercise_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  exerciseId: uuid("exercise_id").references(() => exercises.id, { onDelete: "set null" }),
  payloadCiphertext: text("payload_ciphertext").notNull(),
  sharedAt: timestamp("shared_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("exercise_entries_user_id_idx").on(t.userId),
  index("exercise_entries_exercise_id_idx").on(t.exerciseId),
]);

export * from "./auth-schema";
