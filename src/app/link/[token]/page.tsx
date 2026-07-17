export { noIndexMetadata as metadata } from "@/lib/noindex-metadata";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AcceptInvite } from "@/components/link/accept-invite";

// Accepting an invite requires a session — but the token must survive the round
// trip through sign-in/up. We thread it as "?next=/link/<token>" (a same-origin
// path the auth pages sanitize and return to), never sessionStorage, so a person
// who signs up fresh from the link lands right back here to accept. The token
// itself is never previewed or resolved to a name; the landing stays generic and
// the accept happens on a deliberate button press.
export default async function LinkLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/link/${token}`)}`);

  return <AcceptInvite token={token} />;
}
