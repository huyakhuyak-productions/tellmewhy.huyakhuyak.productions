import { z } from "zod";
import { NotFoundError } from "@/lib/errors";
import { sendIntervention } from "@/lib/interventions";
import { requireTherapist } from "../../../_lib/require-therapist";

const paramsSchema = z.object({ conversationId: z.uuid() });
// Same cap as the client-side chat send (src/app/api/chat/route.ts) — an
// intervention is a message in the same conversation and shouldn't get a
// looser bound than the client's own turns.
const bodySchema = z.object({ text: z.string().min(1).max(8000) });

type Ctx = { params: Promise<{ conversationId: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const authResult = await requireTherapist();
  if (!authResult.ok) return authResult.response;

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  try {
    const message = await sendIntervention(authResult.therapistId, params.data.conversationId, parsedBody.data.text);
    return Response.json(message, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
