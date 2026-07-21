// On-demand digests of a shared conversation, read by the client's own
// therapist. THE security law of this module: every read AND every write sits
// entirely behind `requireGrantedConversation`. An ungranted, revoked, or
// foreign caller must fail exactly like nonexistence — NotFoundError — and
// must never cause a digest row to be created or returned. The gate runs
// FIRST, before any digest/message query, so there is no path to a row without
// it. The body is encrypted under the CLIENT's DEK (their data, summarized for
// their therapist), never the therapist's. Failures past the gate are
// swallowed to a stale/null result — never rethrown — and logged id-only:
// never message plaintext, never digest content.
import { asc, eq, inArray } from "drizzle-orm";
import { generateObject } from "ai";
import { z } from "zod";
import { db } from "@/db";
import { conversations, digests, messages } from "@/db/schema";
import { resolveActivePath } from "./message-tree";
import { getDigestModel } from "./ai/models";
import { buildDigestPrompt } from "./ai/system-prompt";
import { decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { errorCause } from "./errors";
import { requireGrantedConversation } from "./sharing";

const MESSAGE_CLAMP = 500;
const TRANSCRIPT_WINDOW = 200;
const MAX_OUTPUT_TOKENS = 1024;
const GENERATION_TIMEOUT_MS = 20_000;

export type DigestBody = {
  overview: string;
  themes: string[];
  anchors: { messageId: string; label: string; kind: "moment" | "risk" }[];
};

export type DigestForTherapist = DigestBody & {
  coversUpToMessageId: string;
  generatedAt: Date;
  stale: boolean;
};

const digestSchema = z.object({
  overview: z.string(),
  themes: z.array(z.string()),
  anchors: z.array(
    z.object({
      messageId: z.string(),
      label: z.string(),
      kind: z.enum(["moment", "risk"]),
    }),
  ),
});

// Get-or-refresh IS the read path — there is no separate read that could
// bypass the gate. Returns the current digest (freshly generated or cached),
// or null when there is nothing to summarize / generation failed with no prior
// digest to fall back on.
export async function getOrRefreshDigest(
  therapistId: string,
  conversationId: string,
): Promise<DigestForTherapist | null> {
  // THE GATE — first line, before touching any digest or message data.
  const { clientId } = await requireGrantedConversation(therapistId, conversationId);

  // Staleness and anchor-validity need only ids: fetch id + parentId + createdAt
  // for the whole conversation, but NO ciphertext. On a cache hit this is all we
  // ever read of the messages — the ciphertext is fetched later, only when we
  // actually regenerate, and only for the windowed slice we summarize.
  const treeRows = await db
    .select({ id: messages.id, parentId: messages.parentId, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt), asc(messages.id));

  // Nothing to digest: never create a row for an empty conversation.
  if (treeRows.length === 0) return null;

  // The digest summarizes the client's ACTIVE PATH, not the whole tree —
  // superseded branches are neither in the transcript nor valid anchor targets.
  // Resolve the path from the conversation's active leaf; a leaf move alone
  // (same rows) shifts the path and thus the coverage, forcing a refresh.
  const [conv] = await db
    .select({ activeLeafId: conversations.activeLeafId })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  const pathIds = resolveActivePath(treeRows, conv?.activeLeafId ?? null);
  if (pathIds.length === 0) return null;

  const byId = new Map(treeRows.map((r) => [r.id, r]));
  // idRows in path order (root-first = chronological down the chain).
  const idRows = pathIds.map((id) => byId.get(id)!);

  const newestMessageId = pathIds[pathIds.length - 1];
  const validMessageIds = new Set(pathIds);

  const [existing] = await db.select().from(digests).where(eq(digests.conversationId, conversationId));
  const dek = await getOrCreateUserDek(clientId);

  // Cached and current: the stored digest already covers the newest message.
  // Returned WITHOUT ever fetching a single message ciphertext.
  if (existing && existing.coversUpToMessageId === newestMessageId) {
    const cached = tryDecryptBody(dek, existing.bodyCiphertext, conversationId);
    if (cached) {
      // Re-filter on every serve: an anchor stored when its message still
      // existed must drop the moment that message is deleted — a cached body is
      // no exception.
      return { ...filterAnchors(cached, validMessageIds), coversUpToMessageId: existing.coversUpToMessageId, generatedAt: existing.generatedAt, stale: false };
    }
    // Corrupt cached body — fall through and regenerate over the full history.
  }

  // Incremental when we have a decryptable prior digest: summarize only the
  // messages after the ones it already covered, seeding the model with the
  // prior body. Otherwise summarize from the start.
  const priorBody = existing ? tryDecryptBody(dek, existing.bodyCiphertext, conversationId) : null;
  let toDigestIds = idRows;
  if (existing) {
    const coveredIdx = idRows.findIndex((m) => m.id === existing.coversUpToMessageId);
    if (coveredIdx >= 0) toDigestIds = idRows.slice(coveredIdx + 1);
  }
  // The covered message was the newest (a corrupt-cache fall-through) or was
  // deleted — nothing "after" it. Re-summarize the whole history instead of
  // sending an empty transcript.
  if (toDigestIds.length === 0) toDigestIds = idRows;

  const windowedIds = toDigestIds.slice(-TRANSCRIPT_WINDOW).map((m) => m.id);

  // Ciphertext fetched ONLY now, ONLY for the windowed messages we will actually
  // summarize. inArray gives no order guarantee, so re-order via a lookup by the
  // windowedIds sequence (already chronological from idRows).
  const bodyRows = await db
    .select({ id: messages.id, sender: messages.sender, ciphertext: messages.ciphertext })
    .from(messages)
    .where(inArray(messages.id, windowedIds));
  const bodyById = new Map(bodyRows.map((r) => [r.id, r]));

  const transcript = windowedIds
    .flatMap((id) => {
      const row = bodyById.get(id);
      // Deleted between the ids read and this fetch — nothing to include.
      if (!row) return [];
      // Corrupt-row isolation, same as loadMessages: one undecryptable message
      // never aborts the digest; its line is simply omitted (never a leak).
      try {
        const text = decryptText(dek, row.ciphertext);
        const clamped = text.length > MESSAGE_CLAMP ? text.slice(0, MESSAGE_CLAMP) : text;
        return [`[message ${row.id}] ${row.sender}: ${clamped}`];
      } catch (error) {
        // Ids + error name/message only — never the message plaintext.
        console.error(`Skipping undecryptable message ${id} in digest for conversation ${conversationId} (${errorCause(error)})`);
        return [];
      }
    })
    .join("\n");

  const prompt = buildDigestPrompt({ priorDigest: priorBody ? JSON.stringify(priorBody) : null, transcript });

  let generated: DigestBody;
  try {
    const { object } = await generateObject({
      model: getDigestModel(),
      schema: digestSchema,
      prompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    });
    generated = object;
  } catch (error) {
    // Never throw past the gate. Fall back to the prior digest (marked stale)
    // or null. NEVER log the raw error object here: AI SDK errors carry the
    // request/response as enumerable own properties (APICallError's
    // requestBodyValues embeds the whole prompt — the decrypted transcript;
    // NoObjectGeneratedError's text embeds the raw generated digest), so a
    // routine provider 4xx/5xx would dump client plaintext into server logs.
    // Ids plus error name/message only.
    console.error(`Digest generation failed for conversation ${conversationId} (${errorCause(error)})`);
    if (existing && priorBody) {
      // Same guard on the stale fallback: the prior body may anchor a since-
      // deleted message, which must not reach the therapist.
      return { ...filterAnchors(priorBody, validMessageIds), coversUpToMessageId: existing.coversUpToMessageId, generatedAt: existing.generatedAt, stale: true };
    }
    return null;
  }

  // Hallucination guard on the fresh body: keep only anchors pointing at
  // messages that belong to this conversation right now — a fabricated,
  // cross-conversation, or since-deleted id is dropped before it can ever reach
  // the therapist.
  const body = filterAnchors(
    { overview: generated.overview, themes: generated.themes, anchors: generated.anchors },
    validMessageIds,
  );

  const generatedAt = new Date();
  const bodyCiphertext = encryptText(dek, JSON.stringify(body));
  // Latest-only: one digest per conversation, overwritten on refresh — but only
  // when our result still advances (or matches) the coverage we read.
  await db
    .insert(digests)
    .values({ conversationId, bodyCiphertext, coversUpToMessageId: newestMessageId, generatedAt })
    .onConflictDoUpdate({
      target: digests.conversationId,
      set: { bodyCiphertext, coversUpToMessageId: newestMessageId, generatedAt },
      // Compare-and-set against the coverage we READ before generating: if a
      // concurrent regeneration already advanced the row, our (older) result
      // must not roll it back. Our caller still gets the body we generated — it
      // was fresh at read time; the next open self-heals from the row.
      //
      // Deliberately NOT serialized with an advisory lock: the CAS already
      // guarantees correctness (no rollback, no torn write — the losing writer
      // simply no-ops). A lock would have to be held across the whole
      // generateObject call above to prevent the duplicate work, pinning a DB
      // connection for the multi-second model round-trip — a steep, always-on
      // cost to save the rare, cheap case of two refreshes racing and one
      // wasting its generation. We accept the occasional wasted generation.
      setWhere: existing ? eq(digests.coversUpToMessageId, existing.coversUpToMessageId) : undefined,
    });

  return { ...body, coversUpToMessageId: newestMessageId, generatedAt, stale: false };
}

// Hallucination/staleness guard: an anchor may only point at a message that
// exists in this conversation RIGHT NOW — fabricated ids and since-deleted
// messages both drop, on fresh, cached, and stale-fallback paths alike.
function filterAnchors(body: DigestBody, validMessageIds: Set<string>): DigestBody {
  return { ...body, anchors: body.anchors.filter((a) => validMessageIds.has(a.messageId)) };
}

function tryDecryptBody(dek: Buffer, ciphertext: string, conversationId: string): DigestBody | null {
  try {
    return JSON.parse(decryptText(dek, ciphertext)) as DigestBody;
  } catch (error) {
    // Ids + error name/message only — never the digest body plaintext.
    console.error(`Failed to decrypt digest body for conversation ${conversationId} (${errorCause(error)})`);
    return null;
  }
}
