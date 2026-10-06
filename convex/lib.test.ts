import { describe, expect, it } from "vitest";
import {
  ALLOWED_MIME_TYPES,
  TOKEN_ALPHABET,
  TOKEN_LENGTH,
  generateToken,
  isAllowedMime,
  isValidToken,
  normalizeOrigin,
  publicStatus,
  sanitizeFileName,
  sniffImageType,
} from "./lib";
import type { Doc } from "./_generated/dataModel";

describe("generateToken / isValidToken", () => {
  it("generates a token of the expected length and alphabet", () => {
    const token = generateToken();
    expect(token).toHaveLength(TOKEN_LENGTH);
    expect(token).toMatch(new RegExp(`^[${TOKEN_ALPHABET}]{${TOKEN_LENGTH}}$`));
  });

  it("accepts a well-formed token", () => {
    expect(isValidToken(generateToken())).toBe(true);
  });

  it("rejects tokens of the wrong length", () => {
    expect(isValidToken("ABCDEFGH")).toBe(false);
  });

  it("rejects tokens with characters outside the alphabet", () => {
    // '0', '1', 'I', 'L', 'O', 'U' are deliberately excluded from TOKEN_ALPHABET.
    expect(isValidToken("0".repeat(TOKEN_LENGTH))).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidToken(12345)).toBe(false);
    expect(isValidToken(null)).toBe(false);
    expect(isValidToken(undefined)).toBe(false);
  });
});

describe("sanitizeFileName", () => {
  it("strips control characters and trims", () => {
    expect(sanitizeFileName("  foo\u0007bar.png  ")).toBe("foobar.png");
  });

  it("truncates to 180 characters", () => {
    const long = "a".repeat(250);
    expect(sanitizeFileName(long)).toHaveLength(180);
  });

  it("falls back to a default name when nothing is left", () => {
    expect(sanitizeFileName("\u0000\u0001  ")).toBe("foto");
  });
});

describe("isAllowedMime", () => {
  it("accepts every type in the allowlist", () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(isAllowedMime(mime)).toBe(true);
    }
  });

  it("rejects an unlisted type", () => {
    expect(isAllowedMime("application/pdf")).toBe(false);
  });
});

describe("sniffImageType", () => {
  const blobOf = (bytes: number[]) => new Blob([new Uint8Array(bytes)]);

  it("detects JPEG from its magic bytes", async () => {
    const blob = blobOf([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(await sniffImageType(blob)).toBe("image/jpeg");
  });

  it("detects PNG from its magic bytes", async () => {
    const blob = blobOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(await sniffImageType(blob)).toBe("image/png");
  });

  it("detects WEBP via the RIFF/WEBP markers", async () => {
    const bytes = [..."RIFF".split("").map((c) => c.charCodeAt(0)), 0, 0, 0, 0];
    bytes.push(..."WEBP".split("").map((c) => c.charCodeAt(0)));
    expect(await sniffImageType(blobOf(bytes))).toBe("image/webp");
  });

  it("detects HEIC via the ftyp marker", async () => {
    const bytes = [0, 0, 0, 0, ..."ftyp".split("").map((c) => c.charCodeAt(0)), 0, 0, 0, 0];
    expect(await sniffImageType(blobOf(bytes))).toBe("image/heic");
  });

  it("returns null for content that matches no known signature", async () => {
    expect(await sniffImageType(blobOf(new Array(16).fill(0)))).toBeNull();
  });

  it("returns null for a blob shorter than the sniff window", async () => {
    expect(await sniffImageType(blobOf([0xff, 0xd8]))).toBeNull();
  });
});

describe("normalizeOrigin", () => {
  it("accepts a plain https origin", () => {
    expect(normalizeOrigin("https://paldrop.app")).toBe("https://paldrop.app");
  });

  it("strips trailing slashes", () => {
    expect(normalizeOrigin("https://paldrop.app///")).toBe("https://paldrop.app");
  });

  it("rejects a non-URL string", () => {
    expect(normalizeOrigin("not a url")).toBeNull();
  });

  it("returns null when nothing is provided", () => {
    expect(normalizeOrigin(undefined)).toBeNull();
  });
});

describe("publicStatus", () => {
  const base: Doc<"sessions"> = {
    _id: "sessions:1" as Doc<"sessions">["_id"],
    _creationTime: 0,
    token: "x".repeat(32),
    createdAt: 0,
    expiresAt: 0,
    status: "active",
    autoAccept: true,
    totalBytesUploaded: 0,
    fileCount: 0,
  };

  it("reports expired once past expiresAt, even if still flagged active", () => {
    const session = { ...base, status: "active" as const, expiresAt: Date.now() - 1000 };
    expect(publicStatus(session)).toBe("expired");
  });

  it("reports active while before expiresAt", () => {
    const session = { ...base, status: "active" as const, expiresAt: Date.now() + 60_000 };
    expect(publicStatus(session)).toBe("active");
  });

  it("passes through a closed status regardless of expiresAt", () => {
    const session = { ...base, status: "closed" as const, expiresAt: Date.now() + 60_000 };
    expect(publicStatus(session)).toBe("closed");
  });
});
