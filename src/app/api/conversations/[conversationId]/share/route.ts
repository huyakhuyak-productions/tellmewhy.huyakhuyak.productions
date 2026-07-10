import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { grantConversation, revokeGrant } from "@/lib/sharing";

const paramsSchema = z.object({ conversationId: z.uuid() });

type Ctx = { params: Promise<{ conversationId: string }> };

export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  try {
    await grantConversation(session.user.id, params.data.conversationId);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    // Only grantConversation's own business rule (no active link — a static,
    // client-safe ValidationError, see errors.ts) maps to 400 with its
    // message. Anything else is an infrastructure failure and rethrows into a
    // 500, so its internal message never reaches a response body.
    if (error instanceof ValidationError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  try {
    await revokeGrant(session.user.id, params.data.conversationId);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
