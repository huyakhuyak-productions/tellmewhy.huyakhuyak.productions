import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended Argon2id, explicit params — never library defaults.
const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id — numeric literal because @node-rs/argon2 exports Algorithm as an ambient const enum, unusable under isolatedModules (TS2748)
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(input: { hash: string; password: string }): Promise<boolean> {
  // Any verify failure (malformed hash, bad params, internals) is treated as
  // a wrong password on purpose — never surface which failure mode occurred.
  return verify(input.hash, input.password).catch(() => false);
}
