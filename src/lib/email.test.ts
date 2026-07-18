import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockEmailOutbox, sendEmail } from "./email";

describe("sendEmail", () => {
  beforeEach(() => {
    mockEmailOutbox.length = 0;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("without an API key, records to the mock outbox and sends nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await sendEmail({ to: "a@example.com", subject: "Hello", text: "Body" });
    expect(mockEmailOutbox).toHaveLength(1);
    expect(mockEmailOutbox[0]).toEqual({ to: "a@example.com", subject: "Hello", text: "Body" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with an API key, POSTs to Resend and skips the outbox", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "tellmewhy <no-reply@tellmewhy.huyakhuyak.productions>";
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await sendEmail({ to: "a@example.com", subject: "Hello", text: "Body" });
    expect(mockEmailOutbox).toHaveLength(0);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body)).toMatchObject({ to: "a@example.com", subject: "Hello" });
  });

  it("throws on a non-2xx response without leaking recipient or body", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "no-reply@example.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 403 })));
    const attempt = sendEmail({ to: "secret@example.com", subject: "S", text: "T" });
    await expect(attempt).rejects.toThrow(/403/);
    await expect(attempt).rejects.not.toThrow(/secret@example.com/);
  });

  it("refuses mock mode in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(sendEmail({ to: "a@example.com", subject: "S", text: "T" })).rejects.toThrow(
      /RESEND_API_KEY/,
    );
    vi.unstubAllEnvs();
  });
});
