import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listAuditEventsForClient } from "@/lib/audit";
import { listGrantsForClient } from "@/lib/sharing";
import { getActiveLinkForClient } from "@/lib/therapist-links";

// One round trip for the Trust screen: link state, which conversations are
// currently granted, and the client's own audit feed — all scoped to the
// caller as a client, regardless of their `role` (a therapist calling this
// about themselves would just see their own client-side state, if any).
export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const [link, grants, audit] = await Promise.all([
    getActiveLinkForClient(userId),
    listGrantsForClient(userId),
    listAuditEventsForClient(userId),
  ]);

  return Response.json({ link, grants, audit });
}
