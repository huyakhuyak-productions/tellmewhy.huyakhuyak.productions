import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { inviteCreateRateLimiter } from "@/lib/rate-limit";
import { createInvite } from "@/lib/therapist-links";

// Which side of the link this session's caller initiates: a therapist
// inviting a client, or a client inviting a therapist. Server-decided from
// the session's own role — never taken from client input.
export async function POST(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Invite tokens are a resource in their own right (each is a live
  // credential that can mint a therapist link) — rate-limited with its own
  // small bucket, separate from every other limiter in the app.
  if (!inviteCreateRateLimiter.consume(session.user.id)) {
    return Response.json({ error: "A gentle pace on invites — try again shortly" }, { status: 429 });
  }

  const initiatedBy = session.user.role === "therapist" ? "therapist" : "client";
  try {
    const { linkId, token } = await createInvite(session.user.id, initiatedBy);
    // The raw token is returned to the caller exactly once, here — never
    // logged, never persisted anywhere but its hash (see therapist-links.ts).
    return Response.json({ linkId, token, path: `/link/${token}` }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
