import { describe, expect, it } from "vitest";
import {
  ensureExtension,
  errorCodeOf,
  formatBytes,
  formatCode,
  formatCountdown,
  isValidCode,
  normalizeCode,
  resolveMime,
} from "./client";

describe("normalizeCode / isValidCode", () => {
  it("uppercases and strips separators", () => {
    expect(normalizeCode("abcd-2345 efgh-6789")).toBe("ABCD2345EFGH6789");
  });

  it("accepts a well-formed 32-char code", () => {
    expect(isValidCode("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")).toBe(true);
  });

  it("rejects a code of the wrong length", () => {
    expect(isValidCode("ABCD")).toBe(false);
  });

  it("rejects characters outside the base32 alphabet (0, 1, I, L, O, U)", () => {
    expect(isValidCode("0".repeat(32))).toBe(false);
  });
});

describe("formatCode", () => {
  it("groups into blocks of 4", () => {
    expect(formatCode("ABCDEFGH")).toBe("ABCD EFGH");
  });

  it("leaves a trailing short block as-is", () => {
    expect(formatCode("ABCDEFG")).toBe("ABCD EFG");
  });
});

describe("errorCodeOf", () => {
  it("reads a ConvexError-style data.code payload", () => {
    const error = { data: { code: "SESSION_EXPIRED" } };
    expect(errorCodeOf(error)).toBe("SESSION_EXPIRED");
  });

  it("reads a Paldrop:CODE marker from an Error message", () => {
    expect(errorCodeOf(new Error("Paldrop:UPLOAD_INVALID"))).toBe("UPLOAD_INVALID");
  });

  it("buckets fetch/network failures as NETWORK", () => {
    expect(errorCodeOf(new Error("Failed to fetch"))).toBe("NETWORK");
  });

  it("falls back to UNKNOWN for anything unrecognized", () => {
    expect(errorCodeOf(new Error("something else entirely"))).toBe("UNKNOWN");
  });
});

describe("resolveMime", () => {
  const fileOf = (name: string, type: string) => new File([new Blob()], name, { type });

  it("normalizes image/heif to image/heic", () => {
    expect(resolveMime(fileOf("photo.heif", "image/heif"))).toBe("image/heic");
  });

  it("uses the declared type when present", () => {
    expect(resolveMime(fileOf("photo.png", "image/png"))).toBe("image/png");
  });

  it("falls back to the extension when type is empty", () => {
    expect(resolveMime(fileOf("photo.jpg", ""))).toBe("image/jpeg");
  });

  it("defaults to jpeg when neither type nor extension is known", () => {
    expect(resolveMime(fileOf("photo", ""))).toBe("image/jpeg");
  });
});

describe("ensureExtension", () => {
  it("leaves a name that already has an extension untouched", () => {
    expect(ensureExtension("photo.png", "image/jpeg")).toBe("photo.png");
  });

  it("appends the right extension when missing", () => {
    expect(ensureExtension("photo", "image/webp")).toBe("photo.webp");
  });
});

describe("formatBytes", () => {
  it("renders zero/negative/non-finite as 0 MB", () => {
    expect(formatBytes(0, "en")).toBe("0 MB");
    expect(formatBytes(-5, "en")).toBe("0 MB");
    expect(formatBytes(NaN, "en")).toBe("0 MB");
  });

  it("stays in bytes under 1 KB", () => {
    expect(formatBytes(512, "en")).toBe("512 B");
  });

  it("uses a comma decimal separator in Italian", () => {
    expect(formatBytes(1.5 * 1024 * 1024, "it")).toBe("1,5 MB");
  });

  it("uses a dot decimal separator in English", () => {
    expect(formatBytes(1.5 * 1024 * 1024, "en")).toBe("1.5 MB");
  });
});

describe("formatCountdown", () => {
  it("formats minutes and seconds with zero-padding", () => {
    expect(formatCountdown(65_000)).toBe("01:05");
  });

  it("clamps negative remaining time to zero", () => {
    expect(formatCountdown(-1000)).toBe("00:00");
  });
});
