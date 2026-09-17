import { APICallError, RetryError } from "ai";
import { sendEmail } from "@/lib/email";
import { errorCause } from "@/lib/errors";

// OpenRouter's error payload is `{ code, message, type, param }` (`code` a
// number or a string). Depending on the path it reaches us bare, or on an
// APICallError's `data` either flat or nested under `error` — see below.
function payloadCode(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  if ("code" in value) return (value as { code: unknown }).code;
  if ("error" in value) return payloadCode((value as { error: unknown }).error);
  return undefined;
}

function isCreditCode(code: unknown): boolean {
  return code === 402 || code === "402";
}

// OpenRouter refusing a request for lack of credit arrives in three shapes:
//
//  1. HTTP 402 — the provider throws an APICallError with `statusCode: 402`
//     (and `requestBodyValues` = the whole decrypted prompt, so the object
//     itself must never be logged). `data` nests the payload under `error`.
//  2. HTTP 200 whose body is an error payload, on a NON-streaming call — the
//     provider rethrows it as an APICallError with `statusCode: 200` and the
//     FLAT payload on `data`.
//  3. HTTP 200 whose SSE body is an error payload, on a streaming call — the
//     provider enqueues the bare payload object as a stream error. No Error
//     instance, no statusCode.
//
// And one wrapper: if the SDK retried a transient failure and the balance hit
// zero between attempts, the 402 arrives wrapped in a RetryError — look inside.
export function isOutOfCredits(error: unknown): boolean {
  if (RetryError.isInstance(error)) return error.errors.some(isOutOfCredits);
  if (APICallError.isInstance(error)) {
    return error.statusCode === 402 || isCreditCode(payloadCode(error.data));
  }
  return isCreditCode(payloadCode(error));
}

// The one string a failure log may carry about a provider error. The bare
// stream-payload shape isn't an Error, so errorCause would only say "unknown
// error": name the outage, or else log the payload's code + message — that
// message is the provider describing ITS upstream, never the person's words.
export function providerFailureCause(error: unknown): string {
  if (isOutOfCredits(error)) return "OpenRouter: out of credits";
  if (!(error instanceof Error) && typeof error === "object" && error !== null && "message" in error) {
    const { code, message } = error as { code?: unknown; message: unknown };
    const label = code === null || code === undefined ? "OpenRouter error" : `OpenRouter error ${String(code)}`;
    return `${label}: ${String(message)}`;
  }
  return errorCause(error);
}

const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
// After a send FAILS, retry this soon rather than after the full cooldown —
// but not on the very next request: during an outage every request fails,
// and a persistent Resend misconfiguration would otherwise retry (and log) at
// user-traffic rate.
export const RETRY_AFTER_FAILED_SEND_MS = 5 * 60 * 1000;

interface OutOfCreditsAlerterOptions {
  /** Minimum gap between two owner alerts. */
  cooldownMs?: number;
  /** Injectable clock so tests are deterministic — no real-time sleeps. */
  now?: () => number;
}

// Tells the owner — by email, through the existing Resend module — that
// OpenRouter is refusing requests, so the user-facing "the owner has been
// told" (service-issue-copy.ts) is true. One mail per cooldown, not one per
// failed message: every send from every person fails while the balance is
// zero, and the owner needs a single nudge, not a flood.
//
// Limitation: the cooldown lives in process memory only, like the rate
// limiter (rate-limit.ts). It resets on restart and, on a horizontally-scaled
// deployment, each instance would send its own alert. Acceptable for this
// app's single-instance deployment.
export class OutOfCreditsAlerter {
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private lastAlertAt: number | null = null;

  constructor(options: OutOfCreditsAlerterOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = options.now ?? (() => Date.now());
  }

  // Never rejects: this runs from inside stream/error handlers, where a thrown
  // error would replace the failure it was meant to report.
  async alertIfOutOfCredits(error: unknown): Promise<void> {
    if (!isOutOfCredits(error)) return;
    const now = this.now();
    if (this.lastAlertAt !== null && now - this.lastAlertAt < this.cooldownMs) return;
    // Claim the slot before the (async) send so concurrent failures collapse
    // into one mail; shortened below if the send fails, so the owner isn't
    // left untold for a whole cooldown.
    this.lastAlertAt = now;

    const to = process.env.OWNER_EMAIL;
    if (!to) {
      console.error(
        "OpenRouter is refusing requests (out of credits) and OWNER_EMAIL is not set — nobody is being notified",
      );
      return;
    }
    try {
      await sendEmail({
        to,
        subject: "tellmewhy: OpenRouter is refusing requests — out of credits",
        text: [
          "OpenRouter answered 402 (insufficient credits) to a request from tellmewhy.",
          "",
          "Until the balance is topped up, every reply fails: people see a calm notice",
          "that something is wrong on our end and that you have been told. Their words",
          "stay in the composer; nothing they wrote is lost.",
          "",
          "Top up at https://openrouter.ai/settings/credits",
          "",
          `Sent at ${new Date(now).toISOString()}. No further alert for ${Math.round(this.cooldownMs / 3_600_000)} hours.`,
        ].join("\n"),
      });
    } catch (sendError) {
      // Back off, don't release: see RETRY_AFTER_FAILED_SEND_MS.
      this.lastAlertAt = now - this.cooldownMs + RETRY_AFTER_FAILED_SEND_MS;
      // Name + message only — never the error object (see errors.ts).
      console.error(`Failed to email the owner about the OpenRouter credit outage (${errorCause(sendError)})`);
    }
  }
}

// Single shared instance (see the in-memory limitation on the class above).
const outOfCreditsAlerter = new OutOfCreditsAlerter();

// Fire-and-forget entry point for every AI call site's failure path. Safe to
// call with ANY error — it is a no-op unless the error is a credit refusal.
export function alertOwnerIfOutOfCredits(error: unknown): void {
  void outOfCreditsAlerter.alertIfOutOfCredits(error);
}
