import { describe, expect, it } from "vitest";
import { CryptoError } from "./crypto/envelope";
import { KeyShreddedError } from "./crypto/user-keys";
import { errorCause, NotFoundError, ValidationError } from "./errors";

describe("errorCause", () => {
  // errorCause is the ONLY shape a failure log may carry about an error
  // (name + message, never the object). A custom error whose .name still reads
  // the default "Error" makes every log line lie about what actually failed —
  // so each class must render its real name here.
  it("renders each custom error's real class name", () => {
    expect(errorCause(new NotFoundError("missing row"))).toBe("NotFoundError: missing row");
    expect(errorCause(new ValidationError("bad input"))).toBe("ValidationError: bad input");
    expect(errorCause(new CryptoError("decryption failed"))).toBe("CryptoError: decryption failed");
    expect(errorCause(new KeyShreddedError("shredded"))).toBe("KeyShreddedError: shredded");
  });

  it("falls back to a static string for non-Error values", () => {
    expect(errorCause("nope")).toBe("unknown error");
    expect(errorCause(null)).toBe("unknown error");
    expect(errorCause({ message: "faked" })).toBe("unknown error");
  });
});
