import { decryptText, encryptText } from "./envelope";

export interface KeyProvider {
  wrapDek(dek: Buffer): Promise<string>;
  unwrapDek(wrapped: string): Promise<Buffer>;
}

export class EnvKeyProvider implements KeyProvider {
  private readonly kek: Buffer;

  constructor(kekBase64: string | undefined = process.env.MASTER_KEK) {
    if (!kekBase64) throw new Error("MASTER_KEK env variable is not set");
    const kek = Buffer.from(kekBase64, "base64");
    if (kek.length !== 32) throw new Error("MASTER_KEK must decode to exactly 32 bytes");
    this.kek = kek;
  }

  async wrapDek(dek: Buffer): Promise<string> {
    return encryptText(this.kek, dek.toString("base64"));
  }

  async unwrapDek(wrapped: string): Promise<Buffer> {
    return Buffer.from(decryptText(this.kek, wrapped), "base64");
  }
}

let singleton: KeyProvider | undefined;

export function getKeyProvider(): KeyProvider {
  singleton ??= new EnvKeyProvider();
  return singleton;
}
