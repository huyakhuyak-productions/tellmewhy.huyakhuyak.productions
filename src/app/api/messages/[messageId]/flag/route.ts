import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { flagMessageForTherapist } from "@/lib/conversations";
import { isUniformNotFound } from "@/lib/errors";

const paramsSchema = z.object({ messageId: z.uuid() });

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ messageId: string }> },
): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  try {
    await flagMessageForTherapist(session.user.id, params.data.messageId);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
