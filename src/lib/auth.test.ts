import { beforeEach, describe, expect, it, vi } from "vitest";

// Isolate the auth config from the real SMTP transport: these tests pin the
// shape of the config and the fire-and-forget contract of the reset-email
// callback, never a live send. (The DB-backed reset flow lives in
// password-reset.test.ts, which deliberately uses the real outbox.)
const sendEmail = vi.fn<(message: unknown) => Promise<void>>();
vi.mock("./email", () => ({
  sendEmail: (message: unknown) => sendEmail(message),
  mockEmailOutbox: [],
}));

import { auth } from "./auth";

type ResetArgs = Parameters<
  NonNullable<NonNullable<typeof auth.options.emailAndPassword>["sendResetPassword"]>
>[0];

const resetArgs = {
  user: { email: "person@example.com" },
  url: "https://tellmewhy.example/reset-password/tok",
  token: "tok",
} as unknown as ResetArgs;

describe("auth config", () => {
  describe("rate-limit customRules", () => {
    it("throttles password-reset requests to 5 per 15 minutes", () => {
      expect(auth.options.rateLimit?.customRules?.["/request-password-reset"]).toEqual({
        window: 900,
        max: 5,
      });
    });

    it("throttles change-password to 5 per 15 minutes (credential-guessing shaped)", () => {
      expect(auth.options.rateLimit?.customRules?.["/change-password"]).toEqual({
        window: 900,
        max: 5,
      });
    });
  });

  describe("sendResetPassword is fire-and-forget", () => {
    const sendResetPassword = auth.options.emailAndPassword!.sendResetPassword!;

    beforeEach(() => {
      sendEmail.mockReset();
    });

    it("resolves before a slow send settles, so the HTTP reply carries no SMTP timing", async () => {
      let sendSettled = false;
      sendEmail.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              sendSettled = true;
              resolve();
            }, 50);
          }),
      );

      await sendResetPassword(resetArgs);

      // If the callback awaited the send, control wouldn't return until the
      // timer fired — sendSettled would already be true. It must not be.
      expect(sendSettled).toBe(false);
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it("does not reject when the send fails; it logs the cause instead", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      sendEmail.mockRejectedValue(new Error("smtp down"));

      await expect(sendResetPassword(resetArgs)).resolves.toBeUndefined();

      // Flush the trailing .catch() microtask before asserting it logged.
      await Promise.resolve();
      await Promise.resolve();

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("smtp down"));
      errorSpy.mockRestore();
    });
  });
});
