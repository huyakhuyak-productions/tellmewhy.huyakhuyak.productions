import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { setActiveLeaf } from "@/lib/conversations";
import { NotFoundError } from "@/lib/errors";
import { conversationMutateRateLimiter } from "@/lib/rate-limit";

const paramsSchema = z.object({ conversationId: z.uuid() });
const bodySchema = z.object({ messageId: z.uuid() });

type Ctx = { params: Promise<{ conversationId: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!conversationMutateRateLimiter.consume(session.user.id)) {
    return Response.json({ error: "A gentle pace — try again in a moment" }, { status: 429 });
  }
  const params = paramsSchema.safeParse(await ctx.params);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!params.success || !body.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  try {
    // A foreign/missing conversation and a messageId that isn't part of it are
    // both indistinguishable "not found" to the caller — no hint either way.
    await setActiveLeaf(params.data.conversationId, session.user.id, body.data.messageId);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
