// Centralized audit recording. Every therapist-layer module that writes an
// audit_events row goes through `recordAudit` (or its deduped variant) here —
// no module keeps its own inline insert. Rows carry ids, an action enum, and
// timestamps only: never content, never a title, never decrypted text.
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { auditActionEnum, auditEvents, user } from "@/db/schema";

export type AuditAction = (typeof auditActionEnum.enumValues)[number];

export type AuditEvent = {
  clientId: string;
  therapistId: string | null;
  conversationId?: string | null;
  action: AuditAction;
  createdAt?: Date;
};

export async function recordAudit(event: AuditEvent): Promise<void> {
  await db.insert(auditEvents).values(event);
}

const CONVERSATION_VIEWED_DEDUPE_WINDOW_MS = 15 * 60 * 1000;

// `conversation_viewed` is written on every load — without this, a therapist
// re-opening a conversation to re-read a message would flood the client's
// audit feed with one row per page view. Dedupe key is the exact triple
// (therapistId, conversationId, action); a matching row younger than the
// window means this view has already been recorded recently enough, so the
// insert is skipped. Other actions (e.g. review_marker_advanced) are never
// deduped — each call is a distinct, meaningful event.
export async function recordAuditDeduped(
  event: { clientId: string; therapistId: string; conversationId: string; action: AuditAction },
  windowMs: number = CONVERSATION_VIEWED_DEDUPE_WINDOW_MS,
): Promise<void> {
  const since = new Date(Date.now() - windowMs);
  const [existing] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.therapistId, event.therapistId),
        eq(auditEvents.conversationId, event.conversationId),
        eq(auditEvents.action, event.action),
        gte(auditEvents.createdAt, since),
      ),
    );
  if (existing) return;
  await recordAudit(event);
}

export type AuditEventForClient = {
  id: string;
  therapistId: string | null;
  therapistName: string | null;
  conversationId: string | null;
  action: AuditAction;
  createdAt: Date;
};

// The client's own trust/audit feed — never another client's events, never
// content. The therapist's display name is joined in for readability; a
// therapist-initiated invite not yet accepted has no therapistId yet, so the
// left join (and the name) is null rather than a failed lookup.
export async function listAuditEventsForClient(clientId: string, limit = 50): Promise<AuditEventForClient[]> {
  const rows = await db
    .select({
      id: auditEvents.id,
      therapistId: auditEvents.therapistId,
      therapistName: user.name,
      conversationId: auditEvents.conversationId,
      action: auditEvents.action,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .leftJoin(user, eq(user.id, auditEvents.therapistId))
    .where(eq(auditEvents.clientId, clientId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, therapistName: r.therapistName ?? null }));
}
