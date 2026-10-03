import { action, mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  MAX_FILE_BYTES,
  MAX_PHOTOS_PER_SESSION,
  MAX_TOTAL_BYTES,
  fail,
  findSession,
  isAllowedMime,
  publicStatus,
  requireActiveSession,
  sanitizeFileName,
  sniffImageType,
} from "./lib";

/** Short-lived upload URL; only usable when the target session is active. */
export const generateUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireActiveSession(ctx, token);
    return await ctx.storage.generateUploadUrl();
  },
});

async function loadPhoto(
  ctx: MutationCtx,
  token: string,
  photoId: Id<"photos">
): Promise<{ session: Doc<"sessions">; photo: Doc<"photos"> }> {
  const session = await requireActiveSession(ctx, token);
  const photo = await ctx.db.get(photoId);
  if (!photo || photo.sessionId !== session._id) fail("PHOTO_NOT_FOUND");
  return { session, photo };
}

/**
 * Atomically records an already-validated upload inside the session.
 * Re-checks every limit so no race can exceed the configured caps.
 */
export const recordPhoto = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    fileSize: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) fail("SESSION_NOT_FOUND");
    const status = publicStatus(session);
    if (status === "closed") fail("SESSION_CLOSED");
    if (status === "expired") fail("SESSION_EXPIRED");

    if (!isAllowedMime(args.mimeType)) fail("INVALID_FILE_TYPE");

    // Defense in depth: size comes from storage metadata, not the client.
    const meta = await ctx.db.system.get("_storage", args.storageId);
    if (!meta) fail("UPLOAD_INVALID");
    const size = typeof meta.size === "number" ? meta.size : args.fileSize;
    if (size <= 0 || size > MAX_FILE_BYTES) fail("LIMIT_FILE_SIZE");
    if (session.fileCount >= MAX_PHOTOS_PER_SESSION) fail("LIMIT_PHOTO_COUNT");
    if (session.totalBytesUploaded + size > MAX_TOTAL_BYTES) fail("LIMIT_TOTAL_BYTES");

    const photoId = await ctx.db.insert("photos", {
      sessionId: session._id,
      storageId: args.storageId,
      fileName: sanitizeFileName(args.fileName),
      mimeType: args.mimeType,
      fileSize: size,
      width: args.width,
      height: args.height,
      status: session.autoAccept ? "accepted" : "pending",
      uploadedAt: Date.now(),
      expiresAt: session.expiresAt,
    });

    await ctx.db.patch(session._id, {
      fileCount: session.fileCount + 1,
      totalBytesUploaded: session.totalBytesUploaded + size,
    });

    return {
      id: photoId,
      status: session.autoAccept ? ("accepted" as const) : ("pending" as const),
      fileCount: session.fileCount + 1,
      totalBytesUploaded: session.totalBytesUploaded + size,
    };
  },
});

/**
 * Validates an uploaded photo against the real bytes (MIME allowlist,
 * magic-byte sniffing, per-file / per-session limits) and stores its record.
 * Runs as an action because reading file content requires action context.
 */
export const uploadPhoto = action({
  args: {
    token: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    fileSize: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    id: Id<"photos">;
    status: "accepted" | "pending";
    fileCount: number;
    totalBytesUploaded: number;
  }> => {
    // Session status is verified up-front so the caller gets a clear error;
    // per-session limits are re-checked atomically in recordPhoto. Here we
    // validate the actual bytes, which requires action context.
    if (!isAllowedMime(args.mimeType)) fail("INVALID_FILE_TYPE");
    if (!Number.isFinite(args.fileSize) || args.fileSize <= 0) fail("INVALID_FILE_TYPE");

    const { sessionId } = await ctx.runQuery(internal.sessions.getSessionIdByToken, {
      token: args.token,
    });

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) fail("UPLOAD_INVALID");

    // Trust the bytes, not the client: sniff the actual content.
    const sniffed = await sniffImageType(blob);
    if (!sniffed) fail("INVALID_FILE_TYPE");
    if (blob.type && !isAllowedMime(blob.type)) fail("INVALID_FILE_TYPE");
    if (args.mimeType === "image/heic" && sniffed !== "image/heic") fail("INVALID_FILE_TYPE");
    if (args.mimeType !== "image/heic" && sniffed !== args.mimeType) fail("INVALID_FILE_TYPE");

    const width = args.width !== undefined && args.width > 0 ? Math.round(args.width) : undefined;
    const height = args.height !== undefined && args.height > 0 ? Math.round(args.height) : undefined;

    return await ctx.runMutation(internal.photos.recordPhoto, {
      sessionId,
      storageId: args.storageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSize: blob.size,
      width,
      height,
    });
  },
});

/** Realtime photo list for the receiver (accepted + pending), with signed URLs. */
export const listPhotos = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await findSession(ctx, token);
    if (!session) return null;

    const photos = await ctx.db
      .query("photos")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .order("asc")
      .collect();

    const visible = photos.filter((p) => p.status !== "rejected");
    const withUrls = await Promise.all(
      visible.map(async (p) => ({
        id: p._id,
        fileName: p.fileName,
        mimeType: p.mimeType,
        fileSize: p.fileSize,
        width: p.width,
        height: p.height,
        status: p.status,
        uploadedAt: p.uploadedAt,
        url: await ctx.storage.getUrl(p.storageId),
      }))
    );
    withUrls.sort((a, b) => a.uploadedAt - b.uploadedAt);
    return {
      status: publicStatus(session),
      autoAccept: session.autoAccept,
      photos: withUrls,
    };
  },
});

/** Receiver approves a pending photo. */
export const acceptPhoto = mutation({
  args: { token: v.string(), photoId: v.id("photos") },
  handler: async (ctx, { token, photoId }) => {
    const { photo } = await loadPhoto(ctx, token, photoId);
    if (photo.status === "rejected") fail("PHOTO_NOT_FOUND");
    await ctx.db.patch(photo._id, { status: "accepted" });
    return { ok: true };
  },
});

/** Receiver refuses a photo (pending or already accepted). */
export const rejectPhoto = mutation({
  args: { token: v.string(), photoId: v.id("photos") },
  handler: async (ctx, { token, photoId }) => {
    const { photo } = await loadPhoto(ctx, token, photoId);
    await ctx.db.patch(photo._id, { status: "rejected" });
    return { ok: true };
  },
});

/** Receiver deletes a photo and its blob immediately. */
export const deletePhoto = mutation({
  args: { token: v.string(), photoId: v.id("photos") },
  handler: async (ctx, { token, photoId }) => {
    const { session, photo } = await loadPhoto(ctx, token, photoId);
    await ctx.storage.delete(photo.storageId);
    await ctx.db.delete(photo._id);
    await ctx.db.patch(session._id, {
      fileCount: Math.max(0, session.fileCount - 1),
      totalBytesUploaded: Math.max(0, session.totalBytesUploaded - photo.fileSize),
    });
    return { ok: true };
  },
});
