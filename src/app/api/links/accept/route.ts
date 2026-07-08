import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
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
    // already-linked) are plain Errors, not NotFoundError — mapped to 400
    // with the module's own message. NotFoundError is handled distinctly as
    // a safety net matching every other route's discipline, even though
    // this module never actually throws it. The submitted token is never
    // echoed back in either branch.
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    if (error instanceof Error) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
