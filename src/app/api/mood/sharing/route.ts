import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { setMoodSharing } from "@/lib/mood";

const sharingSchema = z.object({ enabled: z.boolean() });

export async function PUT(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = sharingSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  try {
    await setMoodSharing(session.user.id, parsed.data.enabled);
    return new Response(null, { status: 204 });
  } catch (error) {
    // No active link means there is nothing to toggle — a client with no
    // therapist has no sharing state, indistinguishable from a missing row.
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
