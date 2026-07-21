// @vitest-environment happy-dom
// A transport-level rejection (offline/DNS) from the sign-in call must not
// strand the disabled "Signing in…" button forever: the handler has to release
// `pending` and surface a calm error, exactly as the non-throw error path does.
import "../../../test/component-setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const signInEmail = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: (...args: unknown[]) => signInEmail(...args) } },
}));

import { SignInForm } from "./sign-in-form";

beforeEach(() => {
  push.mockClear();
  signInEmail.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-secret-1" } });
  fireEvent.submit(screen.getByRole("button"));
}

describe("SignInForm", () => {
  it("un-strands the submit button when the transport rejects", async () => {
    signInEmail.mockRejectedValue(new Error("network down"));
    render(<SignInForm />);
    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/reach the server/i);

    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Continue");
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps its existing copy on a non-throw error and re-enables the button", async () => {
    signInEmail.mockResolvedValue({ error: { message: "Invalid email or password" } });
    render(<SignInForm />);
    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Invalid email or password");
    // Unified error voice: the calm accent InlineError, never the old red alarm.
    expect(alert.className).toContain("text-accent");
    expect(alert.className).not.toContain("text-red");

    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("navigates on success", async () => {
    signInEmail.mockResolvedValue({ error: null });
    render(<SignInForm next="/invite/abc" />);
    fillAndSubmit();

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/invite/abc"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
