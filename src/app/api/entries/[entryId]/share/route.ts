import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { shareEntry } from "@/lib/exercises";

const paramsSchema = z.object({ entryId: z.uuid() });

type Ctx = { params: Promise<{ entryId: string }> };

export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  try {
    await shareEntry(session.user.id, params.data.entryId);
    return new Response(null, { status: 204 });
  } catch (error) {
    // A foreign entry, a self-guided one (no exercise to join), or a revoked
    // link all fail identically here — NotFoundError → 404, never a hint.
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
