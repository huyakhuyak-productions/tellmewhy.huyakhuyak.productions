import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isUniformNotFound } from "@/lib/errors";
import { createFolder, listFolders } from "@/lib/folders";

const createSchema = z.object({ name: z.string().min(1).max(80) });

export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await listFolders(session.user.id));
  } catch (error) {
    // A stale session of a just-deleted user (own key tombstoned) gets the
    // uniform 404, never a 500.
    if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  try {
    const folder = await createFolder(session.user.id, parsed.data.name);
    return Response.json(folder, { status: 201 });
  } catch (error) {
    if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
