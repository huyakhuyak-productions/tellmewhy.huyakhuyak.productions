import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createFolder, listFolders } from "@/lib/folders";

const createSchema = z.object({ name: z.string().min(1).max(80) });

export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await listFolders(session.user.id));
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  const folder = await createFolder(session.user.id, parsed.data.name);
  return Response.json(folder, { status: 201 });
}
