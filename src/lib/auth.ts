import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { sendEmail } from "./email";
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
      // Link only — no name echoes, no content. The email inherently tells
      // the inbox owner this address has an account; it must tell them
      // nothing else.
      await sendEmail({
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
      });
    },
  },
  // better-auth's limiter is production-only by default (dev/test stay
  // unlimited); this rule tightens the one endpoint that sends email.
  rateLimit: {
    customRules: {
      "/request-password-reset": { window: 900, max: 5 },
    },
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "client", input: false },
    },
  },
});
