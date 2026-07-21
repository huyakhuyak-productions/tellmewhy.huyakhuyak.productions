import { generateText, Output } from "ai";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { loadMessages } from "@/lib/conversations";
import { errorCause, NotFoundError } from "@/lib/errors";
import { getExtractorModel } from "@/lib/ai/models";
import { thoughtRecordSchema } from "@/lib/exercises";
import chatRateLimiter from "@/lib/rate-limit";
import { withRequestScope } from "@/lib/request-scope";

const bodySchema = z.object({ conversationId: z.uuid() });

const TRANSCRIPT_WINDOW = 30; // most recent messages the extractor reads
const MESSAGE_CLAMP = 2000; // per line, so one huge message can't blow up the prompt
const GENERATION_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_TOKENS = 1024;

// Draft a thought record from a conversation the client wants to turn into an
// entry. This ONLY extracts — it persists nothing. The client reviews and
// confirms the draft in a prefilled form (the entries route is what saves).
//
// Wrapped in withRequestScope like the chat route: decrypting the transcript
// unwraps the user's DEK, which memoizes within the request scope.
export async function POST(req: Request): Promise<Response> {
  return withRequestScope(() => handlePost(req));
}

async function handlePost(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  if (!chatRateLimiter.consume(userId)) {
    return Response.json({ error: "Slow down a little" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  const { conversationId } = parsed.data;

  try {
    // Ownership is enforced here: loadMessages throws NotFoundError for a
    // conversation the caller does not own (indistinguishable from missing).
    const history = await loadMessages(conversationId, userId);
    const transcript = history
      .slice(-TRANSCRIPT_WINDOW)
      .filter((m) => m.sender === "client" || m.sender === "ai")
      .map((m) => {
        const clamped = m.text.length > MESSAGE_CLAMP ? m.text.slice(0, MESSAGE_CLAMP) : m.text;
        return `${m.sender === "client" ? "Client" : "Companion"}: ${clamped}`;
      })
      .join("\n");

    try {
      // v6's non-deprecated structured-output API: `generateText` +
      // `Output.object` parses+validates against the schema and THROWS on
      // unparseable JSON or a schema mismatch, like the deprecated
      // `generateObject` — so the 502 path below is unchanged. A non-`stop`
      // finish (truncation, content filter) is covered too: no object is
      // parsed, so reading `output` here throws NoOutputGeneratedError into the
      // same catch, so a partial draft never reaches the client.
      const { output } = await generateText({
        model: getExtractorModel(),
        output: Output.object({ schema: thoughtRecordSchema }),
        prompt: buildExtractionPrompt(transcript),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      });
      // Persist NOTHING — the client confirms this draft in a prefilled form.
      return Response.json(output);
    } catch (error) {
      // NEVER log the raw error object: AI SDK errors carry the request/response
      // as enumerable own properties (APICallError's requestBodyValues embeds
      // the whole prompt — the decrypted transcript; NoObjectGeneratedError's
      // text embeds the raw generation), so a provider 4xx/5xx would dump client
      // plaintext into server logs. Ids plus error name/message only.
      console.error(`Thought-record extraction failed for conversation ${conversationId} (${errorCause(error)})`);
      return Response.json({ error: "Could not extract an entry" }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}

function buildExtractionPrompt(transcript: string): string {
  return [
    "From the conversation below, draft a CBT thought record capturing one difficult moment the person described.",
    "Fill each field in the person's own framing — do not diagnose, judge, or invent details they did not share.",
    "- situation: what happened, concretely.",
    "- thoughts: the automatic thoughts that ran through their mind.",
    "- emotions: the feelings they named or clearly expressed.",
    "- behavior: what they did in response.",
    "- bodySensations (optional): any physical sensations they mentioned.",
    "",
    "Conversation:",
    transcript,
  ].join("\n");
}
