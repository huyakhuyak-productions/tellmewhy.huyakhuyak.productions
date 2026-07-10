import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { acceptInvite } from "@/lib/therapist-links";

const bodySchema = z.object({ token: z.string().min(20).max(200) });

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  try {
    const { linkId } = await acceptInvite(body.data.token, session.user.id);
    return Response.json({ linkId });
  } catch (error) {
    // acceptInvite's own business-rule errors (expired, already used, self,
    // already-linked) are ValidationErrors with static, client-safe messages
    // (see errors.ts) — mapped to 400 with the module's own message.
    // NotFoundError is handled distinctly as a safety net matching every
    // other route's discipline, even though this module never actually
    // throws it. Anything else is an infrastructure failure and rethrows
    // into a 500, so its internal message never reaches a response body.
    // The submitted token is never echoed back in any branch.
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    if (error instanceof ValidationError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
