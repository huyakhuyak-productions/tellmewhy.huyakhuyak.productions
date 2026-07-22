import { z } from "zod";
import { getOrRefreshDigest } from "@/lib/digests";
import { isUniformNotFound } from "@/lib/errors";
import { digestReadRateLimiter } from "@/lib/rate-limit";
import { withRequestScope } from "@/lib/request-scope";
import { requireTherapist } from "../../../_lib/require-therapist";

const paramsSchema = z.object({ conversationId: z.uuid() });

type Ctx = { params: Promise<{ conversationId: string }> };

// getOrRefreshDigest gates internally on requireGrantedConversation and throws
// NotFoundError for an ungranted / revoked / foreign caller — mapped to the
// same 404 a client-role caller gets from requireTherapist. A null return is
// NOT an error: it means "nothing to summarize / unavailable right now", and
// the route hands back { digest: null } rather than fabricating one. Decrypts
// under the client's DEK, so the whole call runs inside a request scope.
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const authResult = await requireTherapist();
  if (!authResult.ok) return authResult.response;

  // A generation can ride on any miss, so pace the endpoint per therapist —
  // generous for reading, protective against hammering. Same calm 429 copy as
  // the rest of the layer.
  if (!digestReadRateLimiter.consume(authResult.therapistId)) {
    return Response.json({ error: "A gentle pace — the digest is a moment away" }, { status: 429 });
  }

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  try {
    const digest = await withRequestScope(() =>
      getOrRefreshDigest(authResult.therapistId, params.data.conversationId),
    );
    return Response.json({ digest });
  } catch (error) {
    if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
