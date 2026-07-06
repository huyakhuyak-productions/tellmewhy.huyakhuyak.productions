import { convertToModelMessages, generateText, streamText, type UIMessage } from "ai";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isTitleCustomized, loadMessages, renameConversation, saveMessage } from "@/lib/conversations";
import { NotFoundError } from "@/lib/errors";
import { assessRisk } from "@/lib/ai/crisis";
import { getChatModel, getClassifierModel, getTitleModel } from "@/lib/ai/models";
import { buildSystemPrompt, buildTitlePrompt } from "@/lib/ai/system-prompt";
import chatRateLimiter from "@/lib/rate-limit";
import { clampTitle } from "@/lib/title";

const bodySchema = z.object({ conversationId: z.uuid(), text: z.string().min(1).max(8000) });

const CONTEXT_WINDOW = 30; // most recent messages sent to the model

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  if (!chatRateLimiter.consume(userId)) {
    return Response.json({ error: "Slow down a little" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  const { conversationId, text } = parsed.data;

  try {
    const riskLevel = await assessRisk(text, getClassifierModel());
    await saveMessage({ conversationId, userId, sender: "client", text, riskLevel });

    const history = await loadMessages(conversationId, userId);
    const uiMessages: UIMessage[] = history.slice(-CONTEXT_WINDOW).map((m) => ({
      id: m.id,
      role: m.sender === "client" ? "user" : "assistant",
      parts: [{ type: "text", text: m.text }],
    }));

    const system =
      riskLevel === "crisis"
        ? buildSystemPrompt() +
          "\n\nIMPORTANT: The latest message shows possible self-harm or suicidal intent. " +
          "Respond with warmth and seriousness, and gently encourage immediate real-world support."
        : buildSystemPrompt();

    const result = streamText({
      model: getChatModel(),
      system,
      // Adaptation: ai@6 makes `convertToModelMessages` async (it now returns
      // `Promise<ModelMessage[]>` instead of a synchronous array) — await it.
      messages: await convertToModelMessages(uiMessages),
      onFinish: async ({ text: replyText }) => {
        try {
          await saveMessage({ conversationId, userId, sender: "ai", text: replyText });
        } catch (error) {
          // The stream already reached the client; without this log the reply
          // would vanish silently (ai v6 swallows onFinish rejections).
          console.error(`Failed to persist AI reply for conversation ${conversationId}`, error);
        }

        // A generated title can echo crisis phrasing prominently on the home
        // screen — display exposure, distinct from encryption at rest — so
        // crisis-flagged first exchanges keep the neutral date title instead.
        if (history.length === 1 && riskLevel !== "crisis") {
          try {
            if (!(await isTitleCustomized(conversationId, userId))) {
              const { text: rawTitle } = await generateText({
                model: getTitleModel(),
                prompt: buildTitlePrompt(text, replyText),
                abortSignal: AbortSignal.timeout(5000),
              });
              // Code-point-safe clamp — see clampTitle for why a plain
              // `.slice(0, 80)` (UTF-16 code units) can split an emoji.
              const title = clampTitle(rawTitle.trim());
              if (title) await renameConversation(conversationId, userId, title, { customized: false });
            }
          } catch (error) {
            // Fire-and-forget by design — a failed title never disturbs the chat.
            console.error(`Failed to auto-title conversation ${conversationId}`, error);
          }
        }
      },
    });

    // Persist the reply even if the client disconnects mid-stream:
    // without this, onFinish only fires when the client consumes the
    // full stream, and an abandoned tab loses the AI turn forever.
    result.consumeStream();

    return result.toUIMessageStreamResponse({ headers: { "x-risk-level": riskLevel } });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
