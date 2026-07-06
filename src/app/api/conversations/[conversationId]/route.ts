import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError } from "@/lib/conversations";
import { assignConversationToFolder } from "@/lib/folders";

const bodySchema = z.object({ folderId: z.uuid().nullable() });
const paramsSchema = z.object({ conversationId: z.uuid() });

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await ctx.params);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!params.success || !body.success) return Response.json({ error: "Invalid input" }, { status: 400 });
  try {
    await assignConversationToFolder(params.data.conversationId, session.user.id, body.data.folderId);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
