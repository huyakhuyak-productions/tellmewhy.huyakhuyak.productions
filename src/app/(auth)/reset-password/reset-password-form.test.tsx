// @vitest-environment happy-dom
// Pins the shared error voice: a rejected reset surfaces through the calm
// InlineError (serif italic, accent), not the old red alarm — the whole auth
// surface now speaks in one register.
import "../../../test/component-setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const resetPassword = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: { resetPassword: (...args: unknown[]) => resetPassword(...args) },
}));

import { ResetPasswordForm } from "./reset-password-form";

beforeEach(() => {
  resetPassword.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ResetPasswordForm", () => {
  it("shows a rejected reset in the shared InlineError voice", async () => {
    resetPassword.mockResolvedValue({ error: { message: "That reset link is no longer valid." } });
    render(<ResetPasswordForm token="tok" />);
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "a-secret-10" },
    });
    fireEvent.submit(screen.getByRole("button"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("That reset link is no longer valid.");
    expect(alert.className).toContain("text-accent");
    expect(alert.className).toContain("font-serif");
    expect(alert.className).not.toContain("text-red");
  });
});
