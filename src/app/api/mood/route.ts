import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkInMood, listMoodCheckins } from "@/lib/mood";
import { moodRateLimiter } from "@/lib/rate-limit";
import { withRequestScope } from "@/lib/request-scope";

// score is left loose here (any number) so the domain's own 1–5 whole-number
// rule is the single source of truth — an out-of-range value surfaces as its
// thrown message (400 below), not a duplicated zod bound that could drift.
const checkInSchema = z.object({ score: z.number(), note: z.string().optional() });

const MIN_DAYS = 1;
const MAX_DAYS = 366;
const DEFAULT_DAYS = 56;

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!moodRateLimiter.consume(session.user.id)) {
    return Response.json({ error: "A gentle pace — try again in a moment" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = checkInSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  try {
    await checkInMood(session.user.id, parsed.data);
    return new Response(null, { status: 204 });
  } catch (error) {
    // checkInMood validates the score/note bounds and throws a plain Error with
    // a client-facing message — surface it as a 400, same as the share route.
    if (error instanceof Error) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  // days is best-effort: a missing, non-numeric, or out-of-range value clamps
  // to the 1–366 window (default 56) rather than erroring — a bad query string
  // should never 400 a read of the client's own data.
  const raw = Number(new URL(req.url).searchParams.get("days"));
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.trunc(raw))) : DEFAULT_DAYS;

  // Decrypts the client's check-ins — scope the request so getOrCreateUserDek
  // memoizes the DEK unwrap within it (see the chat route).
  return withRequestScope(async () => {
    const checkins = await listMoodCheckins(userId, days);
    return Response.json({ checkins });
  });
}
