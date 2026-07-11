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
import { digests, messages } from "@/db/schema";
import { getDigestModel } from "./ai/models";
import { buildDigestPrompt } from "./ai/system-prompt";
import { decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
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

  // Staleness and anchor-validity need only ids: fetch id + createdAt for the
  // whole conversation, but NO ciphertext. On a cache hit this is all we ever
  // read of the messages — the ciphertext is fetched later, only when we
  // actually regenerate, and only for the windowed slice we summarize.
  const idRows = await db
    .select({ id: messages.id, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt), asc(messages.id));

  // Nothing to digest: never create a row for an empty conversation.
  if (idRows.length === 0) return null;

  const newestMessageId = idRows[idRows.length - 1].id;
  const validMessageIds = new Set(idRows.map((m) => m.id));

  const [existing] = await db.select().from(digests).where(eq(digests.conversationId, conversationId));
  const dek = await getOrCreateUserDek(clientId);

  // Cached and current: the stored digest already covers the newest message.
  // Returned WITHOUT ever fetching a single message ciphertext.
  if (existing && existing.coversUpToMessageId === newestMessageId) {
    const cached = tryDecryptBody(dek, existing.bodyCiphertext, conversationId);
    if (cached) {
      return { ...cached, coversUpToMessageId: existing.coversUpToMessageId, generatedAt: existing.generatedAt, stale: false };
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
        const cause = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
        console.error(`Skipping undecryptable message ${id} in digest for conversation ${conversationId} (${cause})`);
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
    const cause = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
    console.error(`Digest generation failed for conversation ${conversationId} (${cause})`);
    if (existing && priorBody) {
      return { ...priorBody, coversUpToMessageId: existing.coversUpToMessageId, generatedAt: existing.generatedAt, stale: true };
    }
    return null;
  }

  // Hallucination guard: keep only anchors pointing at messages that actually
  // belong to this conversation — a fabricated or cross-conversation id is
  // dropped before it can ever reach the therapist.
  const anchors = generated.anchors.filter((a) => validMessageIds.has(a.messageId));
  const body: DigestBody = { overview: generated.overview, themes: generated.themes, anchors };

  const generatedAt = new Date();
  const bodyCiphertext = encryptText(dek, JSON.stringify(body));
  // Latest-only: one digest per conversation, overwritten on refresh.
  await db
    .insert(digests)
    .values({ conversationId, bodyCiphertext, coversUpToMessageId: newestMessageId, generatedAt })
    .onConflictDoUpdate({
      target: digests.conversationId,
      set: { bodyCiphertext, coversUpToMessageId: newestMessageId, generatedAt },
    });

  return { ...body, coversUpToMessageId: newestMessageId, generatedAt, stale: false };
}

function tryDecryptBody(dek: Buffer, ciphertext: string, conversationId: string): DigestBody | null {
  try {
    return JSON.parse(decryptText(dek, ciphertext)) as DigestBody;
  } catch (error) {
    console.error(`Failed to decrypt digest body for conversation ${conversationId}`, error);
    return null;
  }
}
