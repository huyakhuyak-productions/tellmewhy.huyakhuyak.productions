import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createConversation, listConversations } from "@/lib/conversations";

const createSchema = z.object({ title: z.string().min(1).max(200) });

export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await listConversations(session.user.id));
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  const conversation = await createConversation(session.user.id, parsed.data.title);
  return Response.json(conversation, { status: 201 });
}
