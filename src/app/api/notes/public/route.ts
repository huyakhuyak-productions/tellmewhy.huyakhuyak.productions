import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listPublicNotesForClient } from "@/lib/therapist-notes";

const querySchema = z.object({ conversationId: z.uuid().optional() });

export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const query = querySchema.safeParse({ conversationId: searchParams.get("conversationId") ?? undefined });
  if (!query.success) return Response.json({ error: "Invalid query" }, { status: 400 });

  const notes = await listPublicNotesForClient(session.user.id, query.data.conversationId ?? null);
  return Response.json(notes);
}
