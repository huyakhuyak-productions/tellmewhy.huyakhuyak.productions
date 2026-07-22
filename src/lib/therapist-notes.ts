// Therapist notes: author-owned (encrypted with the THERAPIST's DEK — a
// deleted therapist account crypto-shreds their notes, not the client's
// conversations) and client-boundaried (every write and every client-facing
// read is scoped to a specific therapist/client pair, never leaking across
// clients or exposing private/instruction content to a client surface).
import { and, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { db } from "@/db";
import { notes, therapistLinks, user } from "@/db/schema";
import { recordAudit } from "./audit";
import { decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek, KeyShreddedError } from "./crypto/user-keys";
import { errorCause, NotFoundError } from "./errors";
import { requireGrantedConversation } from "./sharing";

export type NoteKind = "private" | "public" | "ai_instruction";

const INSTRUCTION_VERSION_INDEX = "notes_instruction_version_idx";
const MAX_VERSION_RETRIES = 3;

// Mirrors isOnePerClientIndexError in therapist-links.ts: drizzle-orm wraps
// driver errors in DrizzleQueryError with the original postgres.js error on
// `.cause`, so both layers are checked.
function isInstructionVersionIndexError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  const constraintName = (error as { constraint_name?: unknown }).constraint_name;
  return code === "23505" && constraintName === INSTRUCTION_VERSION_INDEX;
}

function isInstructionVersionViolation(error: unknown): boolean {
  return (
    isInstructionVersionIndexError(error) ||
    isInstructionVersionIndexError((error as { cause?: unknown } | null)?.cause)
  );
}

// Client-scoped notes (no conversationId) need the client identified some
// way other than the gate — SIGNATURE DECISION: createNote takes clientId
// explicitly rather than inferring it, so the conversation-scoped and
// client-scoped paths share one signature. When conversationId is present,
// the gate's own clientId must match the passed clientId (a caller passing
// a conversation gated to a DIFFERENT client is treated exactly like an
// ungranted conversation: NotFoundError, no hint which check failed).
// Implicit dependency: this select assumes at most one active link can exist
// for a given (therapistId, clientId) pair, which it never disambiguates
// itself — that invariant is enforced structurally by
// therapist_links_one_per_client_idx (schema.ts), not by anything in this
// function. If that partial unique index is ever relaxed or scoped
// differently, this select needs explicit disambiguation (e.g. picking the
// most recent link) or it can silently return an arbitrary row among several
// matches.
async function requireActiveLinkForClientScoped(therapistId: string, clientId: string): Promise<string> {
  const [row] = await db
    .select({ id: therapistLinks.id })
    .from(therapistLinks)
    .where(
      and(
        eq(therapistLinks.therapistId, therapistId),
        eq(therapistLinks.clientId, clientId),
        eq(therapistLinks.status, "active"),
      ),
    );
  if (!row) throw new NotFoundError("No active link with this client");
  return row.id;
}

export async function createNote(
  therapistId: string,
  clientId: string,
  input: { conversationId?: string; kind: NoteKind; body: string },
): Promise<{ id: string; version: number }> {
  let linkId: string;
  if (input.conversationId) {
    const gate = await requireGrantedConversation(therapistId, input.conversationId);
    // The gate proves the conversation is granted to THIS therapist — but not
    // that its client is the clientId the caller claims. A mismatch here
    // (wrong clientId passed alongside a real conversationId) must fail
    // exactly like any other adversarial path: NotFoundError.
    if (gate.clientId !== clientId) throw new NotFoundError("Conversation not found");
    linkId = gate.linkId;
  } else {
    linkId = await requireActiveLinkForClientScoped(therapistId, clientId);
  }

  const dek = await getOrCreateUserDek(therapistId);
  const bodyCiphertext = encryptText(dek, input.body);

  // ai_instruction is versioned per link — each new instruction supersedes
  // the last without deleting it, so listNotesForTherapist can still show
  // the full history. Other kinds are never versioned past 1.
  let row: { id: string; version: number };
  if (input.kind === "ai_instruction") {
    // The max-read + insert below is check-then-write: two concurrent
    // createNote calls for the same link can both read the same max and
    // race to insert the same next version. notes_instruction_version_idx
    // (schema.ts) is the real guarantee — on a collision, recompute the max
    // (now including the row that just won the race) and retry, same
    // pattern as isOnePerClientIndexError in therapist-links.ts.
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const [existing] = await db
        .select({ maxVersion: max(notes.version) })
        .from(notes)
        .where(and(eq(notes.linkId, linkId), eq(notes.kind, "ai_instruction")));
      const version = (existing?.maxVersion ?? 0) + 1;
      try {
        [row] = await db
          .insert(notes)
          .values({
            linkId,
            conversationId: input.conversationId ?? null,
            kind: input.kind,
            bodyCiphertext,
            version,
          })
          .returning({ id: notes.id, version: notes.version });
        break;
      } catch (error) {
        if (!isInstructionVersionViolation(error) || attempt >= MAX_VERSION_RETRIES) throw error;
      }
    }
  } else {
    [row] = await db
      .insert(notes)
      .values({
        linkId,
        conversationId: input.conversationId ?? null,
        kind: input.kind,
        bodyCiphertext,
        version: 1,
      })
      .returning({ id: notes.id, version: notes.version });
  }

  // Spec decision: only a published (public) note leaves an audit trail —
  // private notes and AI instructions are the therapist's own working
  // material, never surfaced to the client, so there's nothing for the
  // client's audit feed to say about them.
  if (input.kind === "public") {
    await recordAudit({
      clientId,
      therapistId,
      conversationId: input.conversationId ?? null,
      action: "note_published",
      actorId: therapistId,
    });
  }

  return row;
}

export type TherapistNote = {
  id: string;
  conversationId: string | null;
  kind: NoteKind;
  body: string;
  version: number;
  createdAt: Date;
};

// The therapist's own view of everything they've written about this client
// — all three kinds, every ai_instruction version, newest first. Not routed
// through requireGrantedConversation: these are notes the therapist
// authored, not client data reached through the sharing gate, so they stay
// visible to their author across this therapist's link history with this
// client (including a since-revoked link) — same reasoning as
// listPublicNotesForClient below, mirrored for the author's side. Decrypted
// with the THERAPIST's own DEK, never the client's.
export async function listNotesForTherapist(therapistId: string, clientId: string): Promise<TherapistNote[]> {
  const linkRows = await db
    .select({ id: therapistLinks.id })
    .from(therapistLinks)
    .where(and(eq(therapistLinks.therapistId, therapistId), eq(therapistLinks.clientId, clientId)));
  if (linkRows.length === 0) return [];
  const linkIds = linkRows.map((l) => l.id);

  const rows = await db.select().from(notes).where(inArray(notes.linkId, linkIds)).orderBy(desc(notes.createdAt));

  const dek = await getOrCreateUserDek(therapistId);
  // Same corrupt-row isolation as every other decrypt-on-read path in this
  // codebase: one bad ciphertext must never take the rest of the list down.
  return rows.flatMap((r) => {
    try {
      return [
        {
          id: r.id,
          conversationId: r.conversationId,
          kind: r.kind,
          body: decryptText(dek, r.bodyCiphertext),
          version: r.version,
          createdAt: r.createdAt,
        },
      ];
    } catch (error) {
      console.error(`Failed to decrypt note ${r.id} (${errorCause(error)})`);
      return [];
    }
  });
}

// Deliberately narrower than TherapistNote: no `kind` field at all, because
// this function only ever returns public notes. That's not just a runtime
// filter — the shape itself makes it structurally impossible for a
// private/ai_instruction note to be mistaken for one that leaked through.
export type PublicNoteForClient = {
  id: string;
  conversationId: string | null;
  body: string;
  therapistName: string;
  createdAt: Date;
};

// DECISION: public notes stay visible to the client even after the
// underlying grant or link is revoked. A public note is something the
// therapist already said TO the client — it was published, not merely
// shared-and-revocable like a conversation. Revocation protects the
// client's ONGOING data from being read by a therapist who no longer has
// standing to see it; it was never meant to retroactively un-say a note
// that already reached the client. So this reads by clientId directly
// against therapistLinks (any status), not through requireGrantedConversation.
// Filtered structurally to kind = "public" — the one place a private or
// ai_instruction note could otherwise leak to a client-facing surface.
export async function listPublicNotesForClient(
  clientId: string,
  conversationId: string | null,
): Promise<PublicNoteForClient[]> {
  const rows = await db
    .select({
      id: notes.id,
      conversationId: notes.conversationId,
      bodyCiphertext: notes.bodyCiphertext,
      therapistId: therapistLinks.therapistId,
      therapistName: user.name,
      createdAt: notes.createdAt,
    })
    .from(notes)
    .innerJoin(therapistLinks, eq(notes.linkId, therapistLinks.id))
    .innerJoin(user, eq(user.id, therapistLinks.therapistId))
    .where(
      and(
        eq(therapistLinks.clientId, clientId),
        eq(notes.kind, "public"),
        conversationId === null ? isNull(notes.conversationId) : eq(notes.conversationId, conversationId),
      ),
    )
    .orderBy(desc(notes.createdAt));

  // One DEK unwrap per distinct author therapist, however many public notes
  // they've written for this client.
  const dekByTherapist = new Map<string, Buffer>();
  // A therapist crypto-shredded mid-race (they deleted between this query and
  // the DEK unwrap) is SKIPPED, never fatal: this is a LIST of notes, and one
  // departing author must not 500 or blank the client's whole notes panel.
  // Tracked so the skip is logged once per author (ids only), not per row.
  const shreddedTherapists = new Set<string>();
  const result: PublicNoteForClient[] = [];
  for (const row of rows) {
    if (!row.therapistId || shreddedTherapists.has(row.therapistId)) continue;
    let dek = dekByTherapist.get(row.therapistId);
    if (!dek) {
      try {
        dek = await getOrCreateUserDek(row.therapistId);
      } catch (error) {
        if (error instanceof KeyShreddedError) {
          shreddedTherapists.add(row.therapistId);
          console.error(`Skipping public notes for mid-deletion therapist ${row.therapistId} (${errorCause(error)})`);
          continue;
        }
        throw error;
      }
      dekByTherapist.set(row.therapistId, dek);
    }
    try {
      result.push({
        id: row.id,
        conversationId: row.conversationId,
        body: decryptText(dek, row.bodyCiphertext),
        therapistName: row.therapistName,
        createdAt: row.createdAt,
      });
    } catch (error) {
      console.error(`Failed to decrypt public note ${row.id} (${errorCause(error)})`);
    }
  }
  return result;
}

// Server-internal only — the chat route injects this into the system prompt,
// and only when the conversation has a live grant (checked there, not here).
// Latest version wins; earlier versions exist purely for the history
// listNotesForTherapist shows, never for steering.
export async function getActiveAiInstruction(linkId: string): Promise<string | null> {
  const [row] = await db
    .select({ bodyCiphertext: notes.bodyCiphertext, therapistId: therapistLinks.therapistId })
    .from(notes)
    .innerJoin(therapistLinks, eq(notes.linkId, therapistLinks.id))
    .where(and(eq(notes.linkId, linkId), eq(notes.kind, "ai_instruction")))
    // desc(version) alone is ambiguous against legacy duplicate-version rows
    // (pre-index, or a synthetic test artifact) — the createdAt tiebreak
    // makes "latest" deterministic even then.
    .orderBy(desc(notes.version), desc(notes.createdAt))
    .limit(1);
  if (!row || !row.therapistId) return null;
  const dek = await getOrCreateUserDek(row.therapistId);
  return decryptText(dek, row.bodyCiphertext);
}
