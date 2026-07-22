import { z } from "zod";
import { isUniformNotFound } from "@/lib/errors";
import { listNotesForTherapist } from "@/lib/therapist-notes";
import { requireTherapist } from "../../../_lib/require-therapist";

// clientId is a Better Auth user id, not a uuid.
const paramsSchema = z.object({ clientId: z.string().min(1).max(128) });

type Ctx = { params: Promise<{ clientId: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const authResult = await requireTherapist();
  if (!authResult.ok) return authResult.response;

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  // MODULE SEMANTICS: same as clients/[clientId]/conversations — a foreign
  // clientId with no link at all to this therapist just finds no linkIds to
  // query notes under, so this returns [] with a 200, never a 404. The one
  // non-[] outcome is the mid-race stale session: listNotesForTherapist unwraps
  // the THERAPIST's OWN DEK, so a desk-holder whose own key was tombstoned
  // between requireTherapist's session read and that unwrap gets the uniform
  // 404, never a 500.
  try {
    const notes = await listNotesForTherapist(authResult.therapistId, params.data.clientId);
    return Response.json(notes);
  } catch (error) {
    if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
