// @vitest-environment happy-dom
// A transport-level rejection (offline/DNS) from the sign-up call must not
// strand the disabled "Creating…" button forever: the handler has to release
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

const signUpEmail = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: { signUp: { email: (...args: unknown[]) => signUpEmail(...args) } },
}));

import { SignUpForm } from "./sign-up-form";

beforeEach(() => {
  push.mockClear();
  signUpEmail.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Sam" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-secret-10" } });
  fireEvent.submit(screen.getByRole("button"));
}

describe("SignUpForm", () => {
  it("un-strands the submit button when the transport rejects", async () => {
    signUpEmail.mockRejectedValue(new Error("network down"));
    render(<SignUpForm />);
    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/reach the server/i);

    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Start talking");
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps its existing copy on a non-throw error and re-enables the button", async () => {
    signUpEmail.mockResolvedValue({ error: { message: "That email is already registered" } });
    render(<SignUpForm />);
    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("That email is already registered");
    // Unified error voice: the calm accent InlineError, never the old red alarm.
    expect(alert.className).toContain("text-accent");
    expect(alert.className).not.toContain("text-red");

    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("navigates on success", async () => {
    signUpEmail.mockResolvedValue({ error: null });
    render(<SignUpForm next="/invite/abc" />);
    fillAndSubmit();

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/invite/abc"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
