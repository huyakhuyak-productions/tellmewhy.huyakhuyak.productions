import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { renameConversation, setConversationHidden } from "@/lib/conversations";
import { isUniformNotFound } from "@/lib/errors";
import { assignConversationToFolder } from "@/lib/folders";
import { conversationMutateRateLimiter } from "@/lib/rate-limit";

const bodySchema = z
  .object({
    folderId: z.uuid().nullable().optional(),
    title: z.string().min(1).max(200).optional(),
    hidden: z.boolean().optional(),
  })
  .refine((b) => b.folderId !== undefined || b.title !== undefined || b.hidden !== undefined, {
    message: "Nothing to update",
  });
const paramsSchema = z.object({ conversationId: z.uuid() });

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!conversationMutateRateLimiter.consume(session.user.id)) {
    return Response.json({ error: "A gentle pace — try again in a moment" }, { status: 429 });
  }
  const params = paramsSchema.safeParse(await ctx.params);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!params.success || !body.success) return Response.json({ error: "Invalid input" }, { status: 400 });
  try {
    // Apply folder assignment first: it validates ownership of both conversation and folder.
    // Once it succeeds, the rename on the same conversation cannot realistically fail.
    if (body.data.folderId !== undefined) {
      await assignConversationToFolder(params.data.conversationId, session.user.id, body.data.folderId);
    }
    if (body.data.title !== undefined) {
      await renameConversation(params.data.conversationId, session.user.id, body.data.title, { customized: true });
    }
    if (body.data.hidden !== undefined) {
      await setConversationHidden(params.data.conversationId, session.user.id, body.data.hidden);
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
