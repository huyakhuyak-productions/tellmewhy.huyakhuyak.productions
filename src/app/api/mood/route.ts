import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { ValidationError } from "@/lib/errors";
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
    // Only the domain's own validation failures (static, client-safe messages —
    // see ValidationError in errors.ts) map to 400. Anything else is an
    // infrastructure failure (DB, crypto) and rethrows into a 500, so its
    // internal message never reaches a response body.
    if (error instanceof ValidationError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  // days is best-effort — a bad query string should never 400 a read of the
  // client's own data: a missing or non-numeric value falls back to the
  // default, while any numeric one (0 and negatives included) clamps into the
  // 1–366 window.
  const daysParam = new URL(req.url).searchParams.get("days");
  const raw = daysParam === null ? Number.NaN : Number(daysParam);
  const days = Number.isFinite(raw) ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.trunc(raw))) : DEFAULT_DAYS;

  // Decrypts the client's check-ins — scope the request so getOrCreateUserDek
  // memoizes the DEK unwrap within it (see the chat route).
  return withRequestScope(async () => {
    const checkins = await listMoodCheckins(userId, days);
    return Response.json({ checkins });
  });
}
