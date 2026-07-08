import { z } from "zod";
import { NotFoundError } from "@/lib/errors";
import { createNote } from "@/lib/therapist-notes";
import { requireTherapist } from "../_lib/require-therapist";

const bodySchema = z.object({
  // A Better Auth user id, not a uuid.
  clientId: z.string().min(1).max(128),
  conversationId: z.uuid().optional(),
  kind: z.enum(["private", "public", "ai_instruction"]),
  body: z.string().min(1).max(4000),
});

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireTherapist();
  if (!authResult.ok) return authResult.response;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  try {
    const note = await createNote(authResult.therapistId, parsed.data.clientId, {
      conversationId: parsed.data.conversationId,
      kind: parsed.data.kind,
      body: parsed.data.body,
    });
    return Response.json(note, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
