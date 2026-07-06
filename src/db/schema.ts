import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const senderEnum = pgEnum("sender", ["client", "ai", "therapist", "system"]);
export const riskLevelEnum = pgEnum("risk_level", ["none", "elevated", "crisis"]);

// One wrapped DEK per user. Deleting the row = crypto-shredding all their data.
export const userKeys = pgTable("user_keys", {
  userId: text("user_id").primaryKey(),
  wrappedDek: text("wrapped_dek").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  titleCiphertext: text("title_ciphertext").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  sender: senderEnum("sender").notNull(),
  ciphertext: text("ciphertext").notNull(),
  riskLevel: riskLevelEnum("risk_level").notNull().default("none"),
  flaggedAt: timestamp("flagged_at"), // "flag for my therapist" — used from phase 2
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export * from "./auth-schema";
