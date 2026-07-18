// Transactional email via Resend's plain HTTP API — deliberately no SDK
// (no-new-packages rule). Without RESEND_API_KEY (dev, test) it records to
// an in-memory outbox and logs, mirroring the AI_MOCK posture, and refuses
// to run mocked in production. Real mode never logs recipient or body; a
// failure surfaces only the HTTP status.
export type EmailMessage = { to: string; subject: string; text: string };

// Dev/test hook only — real mode never touches it.
export const mockEmailOutbox: EmailMessage[] = [];

export async function sendEmail(message: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is not set — refusing to mock email in production");
    }
    mockEmailOutbox.push(message);
    // Dev needs the body (it carries the reset link); mock mode only.
    console.log(`[email mock] subject="${message.subject}"\n${message.text}`);
    return;
  }
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is not set");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: message.to, subject: message.subject, text: message.text }),
  });
  if (!response.ok) throw new Error(`email send failed: HTTP ${response.status}`);
}
