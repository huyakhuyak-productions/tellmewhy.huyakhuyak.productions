import { safeNextPath } from "@/lib/next-path";
import { SignInForm } from "./sign-in-form";

// Reads "?next=" as a Page searchParams prop (the pattern Next recommends over
// useSearchParams, which would force a Suspense boundary here) and sanitizes it
// to a same-origin path before handing it to the client form — so an invite the
// person followed survives the sign-in round trip via the URL, not sessionStorage.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <SignInForm next={safeNextPath(next) ?? undefined} />;
}
