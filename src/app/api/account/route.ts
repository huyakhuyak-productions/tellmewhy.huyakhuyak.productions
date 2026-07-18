import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { deleteAccount } from "@/lib/account-deletion";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { accountDeleteRateLimiter } from "@/lib/rate-limit";

const bodySchema = z.object({ password: z.string().min(1) });

export async function DELETE(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!accountDeleteRateLimiter.consume(session.user.id)) {
    return Response.json({ error: "Slow down a little" }, { status: 429 });
  }
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  try {
    await deleteAccount(session.user.id, body.data.password);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
