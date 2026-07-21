// @vitest-environment happy-dom
// The change-password failure must always speak the house line, never echo the
// raw server error.message: a verbatim server string can be noisy, shifting, or
// faintly enumerating. The transport-catch branch already does this; the
// rejected-response branch must too.
import "../../test/component-setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const changePassword = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: { changePassword: (...args: unknown[]) => changePassword(...args) },
}));

import { AccountScreen } from "./account-screen";

const HOUSE_COPY = "That didn't work — check your current password and try again.";

beforeEach(() => {
  changePassword.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AccountScreen change-password errors", () => {
  it("shows the house copy, not the raw server error.message, on a rejected change", async () => {
    changePassword.mockResolvedValue({
      error: { message: "current password is incorrect for user 42" },
    });
    render(<AccountScreen name="Sam" email="sam@example.com" />);

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "old-secret-1" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "brand-new-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(HOUSE_COPY);
    expect(alert.textContent).not.toContain("user 42");
    // The shared calm voice, not a red alarm.
    expect(alert.className).toContain("text-accent");
    expect(alert.className).not.toContain("text-red");
  });
});
