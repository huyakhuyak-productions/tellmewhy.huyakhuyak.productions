import { z } from "zod";
import { isUniformNotFound } from "@/lib/errors";
import { advanceReviewMarker } from "@/lib/therapist-access";
import { requireTherapist } from "../../../_lib/require-therapist";

const paramsSchema = z.object({ conversationId: z.uuid() });
const bodySchema = z.object({ messageId: z.uuid() });

type Ctx = { params: Promise<{ conversationId: string }> };

export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  const authResult = await requireTherapist();
  if (!authResult.ok) return authResult.response;

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  try {
    await advanceReviewMarker(authResult.therapistId, params.data.conversationId, parsedBody.data.messageId);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
