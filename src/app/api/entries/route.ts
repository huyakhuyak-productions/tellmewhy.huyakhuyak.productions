import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isUniformNotFound } from "@/lib/errors";
import { saveEntry, thoughtRecordSchema } from "@/lib/exercises";
import { entryRateLimiter } from "@/lib/rate-limit";

// exerciseId is optional: absent means a self-guided entry (never tied to a
// therapist). payload is the full thought record — the same schema the domain
// re-parses, so an empty required field is rejected here as a 400.
const entrySchema = z.object({ exerciseId: z.uuid().optional(), payload: thoughtRecordSchema });

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!entryRateLimiter.consume(session.user.id)) {
    return Response.json({ error: "A gentle pace — try again in a moment" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = entrySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  try {
    const { id } = await saveEntry(session.user.id, parsed.data);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    // A given exerciseId that isn't one of this user's own assignments is
    // indistinguishable from a nonexistent one — NotFoundError → 404.
    if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
