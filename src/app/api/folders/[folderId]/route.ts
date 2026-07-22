import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isUniformNotFound } from "@/lib/errors";
import { deleteFolder, renameFolder } from "@/lib/folders";

const renameSchema = z.object({ name: z.string().min(1).max(80) });
const paramsSchema = z.object({ folderId: z.uuid() });

type Ctx = { params: Promise<{ folderId: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await ctx.params);
  const body = renameSchema.safeParse(await req.json().catch(() => null));
  if (!params.success || !body.success) return Response.json({ error: "Invalid input" }, { status: 400 });
  try {
    await renameFolder(params.data.folderId, session.user.id, body.data.name);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });
  try {
    await deleteFolder(params.data.folderId, session.user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
