import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError, RetryError } from "ai";
import { inspect } from "node:util";
import { mockEmailOutbox } from "@/lib/email";
import {
  isOutOfCredits,
  OutOfCreditsAlerter,
  providerFailureCause,
  RETRY_AFTER_FAILED_SEND_MS,
} from "./provider-failure";

const SENTINEL = "SENTINEL_DECRYPTED_PROMPT";

// The HTTP-402 shape: what @openrouter/ai-sdk-provider throws when OpenRouter
// refuses the request outright. requestBodyValues is the decrypted prompt.
function creditsRefused(statusCode = 402): APICallError {
  return new APICallError({
    message: "[openrouter] Insufficient credits. Add more using https://openrouter.ai/settings/credits",
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: { messages: [{ role: "user", content: SENTINEL }] },
    statusCode,
    responseBody: `{"error":{"code":${statusCode},"message":"Insufficient credits"}}`,
    data: { error: { code: statusCode, message: "Insufficient credits" } },
  });
}

// The third shape: a NON-streaming call whose HTTP-200 body is an error
// payload. The provider rethrows it as an APICallError with `statusCode: 200`
// and the FLAT payload on `data` (not nested under `error` like the 402 path).
function creditsRefusedInBody(code: number | string = 402): APICallError {
  return new APICallError({
    message: "Insufficient credits",
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: { messages: [{ role: "user", content: SENTINEL }] },
    statusCode: 200,
    data: { code, message: "Insufficient credits", type: null, param: null },
  });
}

describe("isOutOfCredits", () => {
  it("recognises OpenRouter's HTTP 402 APICallError", () => {
    expect(isOutOfCredits(creditsRefused())).toBe(true);
  });

  it("recognises a non-streaming HTTP-200 error body — an APICallError with status 200 and the code on data", () => {
    expect(isOutOfCredits(creditsRefusedInBody(402))).toBe(true);
    expect(isOutOfCredits(creditsRefusedInBody("402"))).toBe(true);
    expect(isOutOfCredits(creditsRefusedInBody(500))).toBe(false);
  });

  it("recognises the HTTP-200 stream shape — a bare error payload with code 402", () => {
    expect(isOutOfCredits({ code: 402, message: "Insufficient credits", type: null, param: null })).toBe(true);
    expect(isOutOfCredits({ code: "402", message: "Insufficient credits" })).toBe(true);
  });

  it("sees through the SDK's RetryError when the last attempt was a credit refusal", () => {
    const wrapped = new RetryError({
      message: "Failed after 2 attempts. Last error: Insufficient credits",
      reason: "errorNotRetryable",
      errors: [new Error("upstream 503"), creditsRefused()],
    });
    expect(isOutOfCredits(wrapped)).toBe(true);
    expect(providerFailureCause(wrapped)).toBe("OpenRouter: out of credits");
    const unrelated = new RetryError({
      message: "Failed after 2 attempts",
      reason: "maxRetriesExceeded",
      errors: [new Error("upstream 503"), new Error("upstream 503")],
    });
    expect(isOutOfCredits(unrelated)).toBe(false);
  });

  it("is false for every other failure", () => {
    expect(isOutOfCredits(creditsRefused(500))).toBe(false);
    expect(isOutOfCredits({ code: 401, message: "No auth" })).toBe(false);
    expect(isOutOfCredits(new Error("provider down"))).toBe(false);
    expect(isOutOfCredits(null)).toBe(false);
    expect(isOutOfCredits(undefined)).toBe(false);
    expect(isOutOfCredits("402")).toBe(false);
  });
});

describe("providerFailureCause", () => {
  it("names the credit outage for both 402 shapes, never the request body", () => {
    expect(providerFailureCause(creditsRefused())).toBe("OpenRouter: out of credits");
    expect(providerFailureCause({ code: 402, message: "Insufficient credits" })).toBe("OpenRouter: out of credits");
    expect(providerFailureCause(creditsRefused())).not.toContain(SENTINEL);
  });

  it("names the outage for the status-200 body shape too", () => {
    expect(providerFailureCause(creditsRefusedInBody())).toBe("OpenRouter: out of credits");
  });

  it("logs code + message for any other bare stream payload (provider prose, never user content)", () => {
    expect(providerFailureCause({ code: 502, message: "Provider returned error" })).toBe(
      "OpenRouter error 502: Provider returned error",
    );
    expect(providerFailureCause({ code: null, message: "odd" })).toBe("OpenRouter error: odd");
  });

  it("falls back to errorCause for anything else", () => {
    expect(providerFailureCause(new Error("provider down"))).toBe("Error: provider down");
    expect(providerFailureCause({ code: 401 })).toBe("unknown error");
  });
});

describe("OutOfCreditsAlerter", () => {
  const OWNER = "owner@example.com";
  const COOLDOWN = 6 * 60 * 60 * 1000;
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
    mockEmailOutbox.length = 0;
    vi.stubEnv("OWNER_EMAIL", OWNER);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emails the owner once when credits run out, with no user data in the mail", async () => {
    const alerter = new OutOfCreditsAlerter({ now, cooldownMs: COOLDOWN });
    await alerter.alertIfOutOfCredits(creditsRefused());
    expect(mockEmailOutbox).toHaveLength(1);
    const [mail] = mockEmailOutbox;
    expect(mail.to).toBe(OWNER);
    expect(mail.subject).toMatch(/out of credits/i);
    expect(mail.text).toMatch(/openrouter/i);
    expect(inspect(mail, { depth: 20 })).not.toContain(SENTINEL);
  });

  it("stays quiet for the cooldown, then alerts again once it has passed", async () => {
    const alerter = new OutOfCreditsAlerter({ now, cooldownMs: COOLDOWN });
    await alerter.alertIfOutOfCredits(creditsRefused());
    clock += COOLDOWN - 1;
    await alerter.alertIfOutOfCredits({ code: 402, message: "Insufficient credits" });
    expect(mockEmailOutbox).toHaveLength(1);
    clock += 1;
    await alerter.alertIfOutOfCredits(creditsRefused());
    expect(mockEmailOutbox).toHaveLength(2);
  });

  it("does nothing for a failure that is not a credit outage", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const alerter = new OutOfCreditsAlerter({ now, cooldownMs: COOLDOWN });
    await alerter.alertIfOutOfCredits(new Error("provider down"));
    await alerter.alertIfOutOfCredits(creditsRefused(500));
    expect(mockEmailOutbox).toHaveLength(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("logs one loud line (throttled) and sends nothing when OWNER_EMAIL is unset", async () => {
    vi.stubEnv("OWNER_EMAIL", "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const alerter = new OutOfCreditsAlerter({ now, cooldownMs: COOLDOWN });
    await alerter.alertIfOutOfCredits(creditsRefused());
    await alerter.alertIfOutOfCredits(creditsRefused());
    expect(mockEmailOutbox).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toHaveLength(1);
    expect(errorSpy.mock.calls[0][0]).toContain("OWNER_EMAIL");
  });

  it("logs a failed send (name + message only), never throws, and retries after a short backoff — not per request", async () => {
    // Real send path (no outbox): Resend answers 403 once, then the key is
    // gone again so the retry lands in the outbox.
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "no-reply@example.com");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 403 })));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const alerter = new OutOfCreditsAlerter({ now, cooldownMs: COOLDOWN });
    await expect(alerter.alertIfOutOfCredits(creditsRefused())).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toHaveLength(1);
    expect(errorSpy.mock.calls[0][0]).toContain("HTTP 403");
    expect(inspect(errorSpy.mock.calls, { depth: 20 })).not.toContain(SENTINEL);
    // A failed send must not hold the slot for a whole cooldown (the owner
    // would go untold for hours) — but it must not release it either: during
    // an outage EVERY request fails, and a persistent Resend misconfiguration
    // would otherwise retry at user-traffic rate. Back off, then retry.
    vi.stubEnv("RESEND_API_KEY", "");
    await alerter.alertIfOutOfCredits(creditsRefused());
    expect(mockEmailOutbox).toHaveLength(0);
    clock += RETRY_AFTER_FAILED_SEND_MS - 1;
    await alerter.alertIfOutOfCredits(creditsRefused());
    expect(mockEmailOutbox).toHaveLength(0);
    clock += 1;
    await alerter.alertIfOutOfCredits(creditsRefused());
    expect(mockEmailOutbox).toHaveLength(1);
  });
});
