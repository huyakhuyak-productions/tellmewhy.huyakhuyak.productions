export { noIndexMetadata as metadata } from "@/lib/noindex-metadata";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AccountScreen } from "./account-screen";

// The account home. Gated exactly like /chat: no session, no room — bounce to
// sign-in. Name and email are read from the session on the server and handed
// down as plain strings; the client screen never fetches them itself.
export default async function AccountPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  return (
    <AccountScreen
      name={session.user.name}
      email={session.user.email}
    />
  );
}
