import { hash, verify, Algorithm } from "@node-rs/argon2";

// OWASP-recommended Argon2id, explicit params — never library defaults.
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(input: { hash: string; password: string }): Promise<boolean> {
  return verify(input.hash, input.password).catch(() => false);
}
