import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createConversation, listConversations } from "@/lib/conversations";
import { isUniformNotFound } from "@/lib/errors";
import { conversationCreateRateLimiter } from "@/lib/rate-limit";

const createSchema = z.object({ title: z.string().min(1).max(200) });

export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await listConversations(session.user.id));
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
  if (!conversationCreateRateLimiter.consume(session.user.id)) {
    return Response.json({ error: "A gentle pace — try again in a moment" }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  try {
    const conversation = await createConversation(session.user.id, parsed.data.title);
    return Response.json(conversation, { status: 201 });
  } catch (error) {
    if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
