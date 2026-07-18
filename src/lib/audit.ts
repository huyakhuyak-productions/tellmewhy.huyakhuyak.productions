// Centralized audit recording. Every therapist-layer module that writes an
// audit_events row goes through `recordAudit` (or its deduped variant) here —
// no module keeps its own inline insert. Rows carry ids, an action enum, and
// timestamps only: never content, never a title, never decrypted text.
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db, type DbExecutor } from "@/db";
import { auditActionEnum, auditEvents, user } from "@/db/schema";

export type AuditAction = (typeof auditActionEnum.enumValues)[number];

export type AuditEvent = {
  clientId: string;
  therapistId: string | null;
  // Who actually performed the action — required on every call so a call
  // site states it explicitly rather than letting audit-copy.ts guess later.
  // Typed nullable only to match the column (nullable so legacy pre-actorId
  // rows remain valid); every call site here always passes a real user id.
  actorId: string | null;
  conversationId?: string | null;
  // The specific record the action was about (e.g. the exercise entry read),
  // when the action is per-subject rather than client-wide. Nullable to match
  // the column; omitted (null) for client-wide actions like conversation_viewed.
  subjectId?: string | null;
  action: AuditAction;
  createdAt?: Date;
};

export async function recordAudit(event: AuditEvent, executor: DbExecutor = db): Promise<void> {
  await executor.insert(auditEvents).values(event);
}

const CONVERSATION_VIEWED_DEDUPE_WINDOW_MS = 15 * 60 * 1000;

// `conversation_viewed` and `attention_viewed` are written on every load —
// without this, a therapist re-opening a conversation (or the attention
// queue) to re-read the same items would flood the client's audit feed with
// one row per page view. Dedupe key is (clientId, therapistId, conversationId,
// action); a matching row younger than the window means this has already been
// recorded recently enough, so the insert is skipped. `conversationId` is null
// for client-wide actions like `attention_viewed` — matched with IS NULL, not
// `=`, since SQL NULL never equals NULL. Other actions (e.g.
// review_marker_advanced) are never deduped — each call is a distinct,
// meaningful event. `subjectId` extends the key so per-subject actions like
// `entry_viewed` record one honest row per distinct record read (three shared
// entries → three rows), while a rapid re-read of the SAME subject still
// dedupes. Omitted (null) subjects match with IS NULL, preserving the legacy
// client-wide behavior for actions that carry no subject.
export async function recordAuditDeduped(
  event: {
    clientId: string;
    therapistId: string;
    conversationId: string | null;
    action: AuditAction;
    actorId: string | null;
    subjectId?: string | null;
  },
  windowMs: number = CONVERSATION_VIEWED_DEDUPE_WINDOW_MS,
): Promise<void> {
  const subjectId = event.subjectId ?? null;
  const since = new Date(Date.now() - windowMs);
  const [existing] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.clientId, event.clientId),
        eq(auditEvents.therapistId, event.therapistId),
        event.conversationId === null
          ? isNull(auditEvents.conversationId)
          : eq(auditEvents.conversationId, event.conversationId),
        subjectId === null ? isNull(auditEvents.subjectId) : eq(auditEvents.subjectId, subjectId),
        eq(auditEvents.action, event.action),
        gte(auditEvents.createdAt, since),
      ),
    );
  if (existing) return;
  await recordAudit({ ...event, subjectId });
}

export type AuditEventForClient = {
  id: string;
  therapistId: string | null;
  therapistName: string | null;
  actorId: string | null;
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
      actorId: auditEvents.actorId,
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
