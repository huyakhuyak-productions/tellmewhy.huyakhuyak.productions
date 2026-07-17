import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LandingPage } from "@/components/landing/landing-page";

// The public front door is the site's canonical home. Title/description fall
// through to the root layout defaults (the untemplated homepage title).
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Signed-in visitors go straight to their room; everyone else meets the public
// landing page. Sign-in/up links on the landing carry no `next` param, so they
// follow the default post-auth flow into /chat.
export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/chat");
  return <LandingPage />;
}
