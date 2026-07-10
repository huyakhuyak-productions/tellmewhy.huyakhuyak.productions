import { z } from "zod";
import { NotFoundError } from "@/lib/errors";
import { getMoodTrendForTherapist } from "@/lib/mood";
import { withRequestScope } from "@/lib/request-scope";
import { requireTherapist } from "../../../_lib/require-therapist";

// clientId is a Better Auth user id, not a uuid.
const paramsSchema = z.object({ clientId: z.string().min(1).max(128) });

type Ctx = { params: Promise<{ clientId: string }> };

// getMoodTrendForTherapist gates internally: no active link, a foreign
// therapist, a revoked link, or a client who never enabled mood sharing all
// throw NotFoundError, indistinguishable here from a 404. Decrypts the client's
// check-ins under their DEK, so the read runs inside a request scope.
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const authResult = await requireTherapist();
  if (!authResult.ok) return authResult.response;

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  try {
    const trend = await withRequestScope(() =>
      getMoodTrendForTherapist(authResult.therapistId, params.data.clientId),
    );
    return Response.json({ trend });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
