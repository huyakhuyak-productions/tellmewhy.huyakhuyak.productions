import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { deleteNote } from "@/lib/notes";

const paramsSchema = z.object({ noteId: z.uuid() });

type Ctx = { params: Promise<{ noteId: string }> };

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  try {
    await deleteNote(session.user.id, params.data.noteId);
    return new Response(null, { status: 204 });
  } catch (error) {
    // A foreign note and a nonexistent one answer identically.
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
