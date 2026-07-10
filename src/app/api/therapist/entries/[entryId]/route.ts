import { z } from "zod";
import { NotFoundError } from "@/lib/errors";
import { getSharedEntryForTherapist } from "@/lib/exercises";
import { withRequestScope } from "@/lib/request-scope";
import { requireTherapist } from "../../_lib/require-therapist";

const paramsSchema = z.object({ entryId: z.uuid() });

type Ctx = { params: Promise<{ entryId: string }> };

// getSharedEntryForTherapist is the ONE path a therapist reads an entry's
// content — and it opens only when the client has shared THIS entry and the
// exercise's link is active and owned by the caller. An unshared entry, a
// revoked link, a foreign therapist, or a self-guided entry all throw
// NotFoundError → 404. Decrypts under the client's DEK, so it runs in a scope.
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const authResult = await requireTherapist();
  if (!authResult.ok) return authResult.response;

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  try {
    const entry = await withRequestScope(() =>
      getSharedEntryForTherapist(authResult.therapistId, params.data.entryId),
    );
    return Response.json({ entry });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
