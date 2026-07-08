import { headers } from "next/headers";
import { auth } from "@/lib/auth";

// Every therapist route resolves the caller through this ONE check before
// anything else runs. No session, or a session whose role isn't
// "therapist", both answer 404 — never 401/403 — so a client-role caller
// gets the exact same response a nonexistent route would give them and
// can't use the status code to learn this surface exists at all.
//
// This is deliberately NOT the sharing gate (requireGrantedConversation) —
// it only establishes WHO is asking. Every handler still has to pass the
// gate separately (directly, or via a module function that gates
// internally) before it touches any client data.
const NOT_FOUND_RESPONSE = () => Response.json({ error: "Not found" }, { status: 404 });

export type TherapistAuth = { ok: true; therapistId: string } | { ok: false; response: Response };

export async function requireTherapist(): Promise<TherapistAuth> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "therapist") {
    return { ok: false, response: NOT_FOUND_RESPONSE() };
  }
  return { ok: true, therapistId: session.user.id };
}
