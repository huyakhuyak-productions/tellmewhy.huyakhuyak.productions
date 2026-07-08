import { z } from "zod";
import { listGrantedConversations } from "@/lib/sharing";
import { requireTherapist } from "../../../_lib/require-therapist";

// clientId is a Better Auth user id, not a uuid.
const paramsSchema = z.object({ clientId: z.string().min(1).max(128) });

type Ctx = { params: Promise<{ clientId: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const authResult = await requireTherapist();
  if (!authResult.ok) return authResult.response;

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  // MODULE SEMANTICS: a foreign/unlinked clientId is not distinguished from
  // a linked client with nothing shared yet — listGrantedConversations's
  // join simply finds no rows either way, so this returns [] with a 200,
  // never a 404. (Contrast with therapist-notes.createNote, which throws
  // NotFoundError for a client with no active link at all.)
  const conversations = await listGrantedConversations(authResult.therapistId, params.data.clientId);
  return Response.json(conversations);
}
