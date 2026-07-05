import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { hashPassword, verifyPassword } from "./password";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    password: { hash: hashPassword, verify: verifyPassword },
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "client", input: false },
    },
  },
});
