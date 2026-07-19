import { ResetPasswordForm } from "./reset-password-form";

// better-auth's emailed link hits its own GET endpoint, which redirects here
// with either "?token=…" (a live reset token) or "?error=INVALID_TOKEN" when the
// link is expired or already spent. We read both as searchParams props — the
// pattern Next recommends over useSearchParams, which would force a Suspense
// boundary — and hand only the token string to the client form. Never the email.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const invalid = error === "INVALID_TOKEN" || !token;
  return <ResetPasswordForm token={invalid ? undefined : token} />;
}
