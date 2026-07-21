import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { sendEmail } from "./email";
import { errorCause } from "./errors";
import { hashPassword, verifyPassword } from "./password";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    password: { hash: hashPassword, verify: verifyPassword },
    // A reset often means "someone may know my password" — leave no session standing.
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // Fire-and-forget: the HTTP reply to requestPasswordReset must NOT block
      // on SMTP. Awaiting the send opens a timing channel — a registered
      // address (real, possibly slow send) would answer measurably later than
      // an unknown one (no send), letting an attacker enumerate accounts by
      // response latency. Kick the send off and return immediately; a failure
      // is logged, never surfaced. errorCause keeps any decrypted content the
      // error might carry out of the log.
      //
      // Link only — no name echoes, no content. The email inherently tells
      // the inbox owner this address has an account; it must tell them
      // nothing else.
      void sendEmail({
        to: user.email,
        subject: "Reset your tellmewhy password",
        text: [
          "Someone asked to reset the password for this tellmewhy account.",
          "",
          `If it was you, follow this link within the next hour:`,
          url,
          "",
          "If it wasn't you, you can ignore this — nothing has changed.",
        ].join("\n"),
      }).catch((error: unknown) => {
        console.error(`Failed to send password-reset email (${errorCause(error)})`);
      });
    },
  },
  // better-auth's limiter is production-only by default (dev/test stay
  // unlimited); this rule tightens the one endpoint that sends email.
  rateLimit: {
    customRules: {
      "/request-password-reset": { window: 900, max: 5 },
      // Credential-guessing shaped: the current password is a secret an
      // attacker with a stolen session would try to brute-force here.
      "/change-password": { window: 900, max: 5 },
    },
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "client", input: false },
    },
  },
});
