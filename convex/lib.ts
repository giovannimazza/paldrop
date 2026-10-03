import type { DatabaseReader, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/** Session lifetime: 15 minutes. */
export const SESSION_TTL_MS = 15 * 60 * 1000;
/** Per-session photo count limit. */
export const MAX_PHOTOS_PER_SESSION = 20;
/** Per-session total upload limit: 100 MB. */
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
/** Per-file upload limit (keeps single uploads sane inside the 100 MB budget). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Only these image MIME types are accepted. */
export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
/** Base32 alphabet (no I, L, O, U, 0, 1) so codes are easy to read aloud. */
export const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** Session tokens/codes are 32 characters long (>= 32 required). */
export const TOKEN_LENGTH = 32;
/** How long closed/expired session records linger before being purged. */
export const PURGE_GRACE_MS = 60 * 60 * 1000;

export type SessionStatus = "active" | "closed" | "expired";

/** Throws a coded error the client can map to a localized message. */
export function fail(code: string): never {
  throw new Error(`Paldrop:${code}`);
}

export function isValidToken(token: unknown): token is string {
  return typeof token === "string" && new RegExp(`^[${TOKEN_ALPHABET}]{${TOKEN_LENGTH}}$`).test(token);
}

/** Cryptographically random, URL-safe session token (160 bits of entropy). */
export function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return out;
}

/** Status including lazy expiry (a session past expiresAt is expired even if not yet swept). */
export function publicStatus(session: Doc<"sessions">): SessionStatus {
  if (session.status !== "active") return session.status;
  return Date.now() >= session.expiresAt ? "expired" : session.status;
}

/** Loads a session for a query, mutation or action; fails unless it is usable. */
export async function requireActiveSession(
  ctx: { db: DatabaseReader },
  token: string
): Promise<Doc<"sessions">> {
  if (!isValidToken(token)) fail("INVALID_TOKEN");
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!session) fail("SESSION_NOT_FOUND");
  const status = publicStatus(session);
  if (status === "closed") fail("SESSION_CLOSED");
  if (status === "expired") fail("SESSION_EXPIRED");
  return session;
}

/** Loads a session by token without throwing (used by public queries). */
export async function findSession(
  ctx: { db: DatabaseReader },
  token: string
): Promise<Doc<"sessions"> | null> {
  if (!isValidToken(token)) return null;
  return await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180);
  return cleaned.length > 0 ? cleaned : "foto";
}

export function isAllowedMime(mime: string): mime is (typeof ALLOWED_MIME_TYPES)[number] {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * Server-side content sniffing so renamed non-images are rejected
 * even when the declared MIME type looks legitimate.
 */
export async function sniffImageType(blob: Blob): Promise<string | null> {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (head.length < 12) return null;
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...head.slice(from, Math.min(to, head.length)));
  // JPEG: FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47)
    return "image/png";
  // WEBP: "RIFF" .... "WEBP"
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  // HEIC/HEIF family: .... "ftyp" + brand
  if (ascii(4, 8) === "ftyp") return "image/heic";
  return null;
}

/** Deletes every photo record and its blob from Convex File Storage. */
export async function deleteSessionFiles(
  ctx: MutationCtx,
  sessionId: Id<"sessions">
): Promise<number> {
  const photos = await ctx.db
    .query("photos")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  for (const photo of photos) {
    await ctx.storage.delete(photo.storageId);
    await ctx.db.delete(photo._id);
  }
  return photos.length;
}

/** Accepts an app origin and returns a normalized base URL, or null. */
export function normalizeOrigin(origin?: string): string | null {
  const candidates = [origin, process.env.PALDROP_ORIGIN];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim().replace(/\/+$/, "");
    if (/^https?:\/\/[^\s/?#]{1,180}$/i.test(trimmed)) return trimmed;
  }
  return null;
}
