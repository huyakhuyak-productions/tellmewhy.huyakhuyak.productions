import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { therapistLinks } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getActiveLinkForClient, getActiveLinksForTherapist } from "@/lib/therapist-links";

// Role-appropriate view of "my link(s)", shaped for the two very different
// UIs this feeds (Trust screen for a client; a client roster for a
// therapist):
//
//   { role: "client", link: null }
//   { role: "client", link: { linkId, status: "invited" } }
//   { role: "client", link: { linkId, status: "active", therapistId, therapistName } }
//   { role: "therapist", links: [{ linkId, clientId, clientName }, ...] }
//
// The frozen therapist-links.ts contract only exposes ACTIVE-link lookups
// (getActiveLinkForClient / getActiveLinksForTherapist) — there's no module
// function for "my own still-pending invite". A client-initiated invite is
// only ever attributable to a client via its own `clientId` column before
// it's accepted (a therapist-initiated invite has no clientId at all until
// accept), so a direct, read-only lookup here is safe and mirrors the
// batched-name lookup the chat route already does straight against `user`.
export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  if (session.user.role === "therapist") {
    const links = await getActiveLinksForTherapist(userId);
    return Response.json({ role: "therapist", links });
  }

  const activeLink = await getActiveLinkForClient(userId);
  if (activeLink) {
    return Response.json({ role: "client", link: { status: "active", ...activeLink } });
  }

  const [pending] = await db
    .select({ id: therapistLinks.id })
    .from(therapistLinks)
    .where(and(eq(therapistLinks.clientId, userId), eq(therapistLinks.status, "invited")));
  if (pending) {
    return Response.json({ role: "client", link: { linkId: pending.id, status: "invited" } });
  }

  return Response.json({ role: "client", link: null });
}
