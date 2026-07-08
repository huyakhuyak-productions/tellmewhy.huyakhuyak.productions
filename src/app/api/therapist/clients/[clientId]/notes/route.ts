import { z } from "zod";
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
  // query notes under, so this returns [] with a 200, never a 404.
  const notes = await listNotesForTherapist(authResult.therapistId, params.data.clientId);
  return Response.json(notes);
}
