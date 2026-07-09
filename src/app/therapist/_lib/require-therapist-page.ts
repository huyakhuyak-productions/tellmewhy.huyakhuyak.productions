import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";

// The server-component twin of require-therapist.ts (the API guard). A missing
// session, or one whose role isn't "therapist", answers with notFound() — the
// same 404 indistinguishability the routes give, so a client-role visitor to a
// /therapist page can't tell the surface exists at all. The cookie proxy stays
// role-blind; only this check (and the API's) reads the role.
export async function requireTherapistPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "therapist") notFound();
  return session;
}
