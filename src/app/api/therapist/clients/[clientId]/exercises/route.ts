import { z } from "zod";
import { isUniformNotFound } from "@/lib/errors";
import { assignExercise, listAssignmentsForTherapist } from "@/lib/exercises";
import { therapistWriteRateLimiter } from "@/lib/rate-limit";
import { withRequestScope } from "@/lib/request-scope";
import { requireTherapist } from "../../../_lib/require-therapist";

// clientId is a Better Auth user id, not a uuid.
const paramsSchema = z.object({ clientId: z.string().min(1).max(128) });
const assignSchema = z.object({
  type: z.literal("thought_record"),
  instruction: z.string().min(1).max(2000),
});

type Ctx = { params: Promise<{ clientId: string }> };

// listAssignmentsForTherapist gates internally on an active link owned by the
// caller; a foreign / unlinked / revoked pair throws NotFoundError → 404.
// Instructions decrypt under the client's DEK, so the read runs in a scope.
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const authResult = await requireTherapist();
  if (!authResult.ok) return authResult.response;

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  try {
    const assignments = await withRequestScope(() =>
      listAssignmentsForTherapist(authResult.therapistId, params.data.clientId),
    );
    return Response.json({ assignments });
  } catch (error) {
    if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}

// assignExercise gates internally: only an active link with this exact client
// can assign, otherwise NotFoundError → 404. The instruction encrypts under the
// client's DEK, so the write runs in a scope.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const authResult = await requireTherapist();
  if (!authResult.ok) return authResult.response;

  if (!therapistWriteRateLimiter.consume(authResult.therapistId)) {
    return Response.json({ error: "A gentle pace — your work is saved as you go" }, { status: 429 });
  }

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsedBody = assignSchema.safeParse(body);
  if (!parsedBody.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  try {
    const assigned = await withRequestScope(() =>
      assignExercise(authResult.therapistId, params.data.clientId, parsedBody.data),
    );
    return Response.json(assigned, { status: 201 });
  } catch (error) {
    if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
