import { z } from "zod";
import { NotFoundError } from "@/lib/errors";
import { closeExercise } from "@/lib/exercises";
import { therapistWriteRateLimiter } from "@/lib/rate-limit";
import { requireTherapist } from "../../_lib/require-therapist";

const paramsSchema = z.object({ exerciseId: z.uuid() });
const bodySchema = z.object({ status: z.literal("closed") });

type Ctx = { params: Promise<{ exerciseId: string }> };

// closeExercise gates internally: only the assigning link's therapist, and only
// while that link is active, may close it — a non-assigner, revoked link, or
// unknown id all throw NotFoundError → 404. No decrypt happens, so no request
// scope is needed. 204 on success (an idempotent state change, no body).
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const authResult = await requireTherapist();
  if (!authResult.ok) return authResult.response;

  if (!therapistWriteRateLimiter.consume(authResult.therapistId)) {
    return Response.json({ error: "A gentle pace — your work is saved as you go" }, { status: 429 });
  }

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  try {
    await closeExercise(authResult.therapistId, params.data.exerciseId);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
