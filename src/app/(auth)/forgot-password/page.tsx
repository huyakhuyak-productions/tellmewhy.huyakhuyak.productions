import { ForgotPasswordForm } from "./forgot-password-form";

// Rendered per request (not statically prerendered) so the root layout reads
// the Umami env at runtime — Dokku config isn't in scope at image-build time,
// and a baked-empty static page would silently ship no analytics script.
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
