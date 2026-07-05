import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError, loadMessages, saveMessage } from "@/lib/conversations";
import { assessRisk } from "@/lib/ai/crisis";
import { getChatModel, getClassifierModel } from "@/lib/ai/models";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";

const bodySchema = z.object({ conversationId: z.string().uuid(), text: z.string().min(1).max(8000) });

const CONTEXT_WINDOW = 30; // most recent messages sent to the model

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const parsed = bodySchema.safeParse(await req.json());
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
        await saveMessage({ conversationId, userId, sender: "ai", text: replyText });
      },
    });

    return result.toUIMessageStreamResponse({ headers: { "x-risk-level": riskLevel } });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
