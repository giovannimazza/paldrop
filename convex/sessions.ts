import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  MAX_PHOTOS_PER_SESSION,
  MAX_TOTAL_BYTES,
  PURGE_GRACE_MS,
  SESSION_TTL_MS,
  deleteSessionFiles,
  findSession,
  generateToken,
  normalizeOrigin,
  publicStatus,
  requireActiveSession,
} from "./lib";

const sessionLimits = {
  maxPhotos: MAX_PHOTOS_PER_SESSION,
  maxTotalBytes: MAX_TOTAL_BYTES,
};

/**
 * Creates a temporary receive session with a long, unpredictable token.
 * Returns the full URL to encode in the QR code.
 */
export const createSession = mutation({
  args: {
    autoAccept: v.boolean(),
    origin: v.optional(v.string()),
  },
  handler: async (ctx, { autoAccept, origin }) => {
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;

    // Extremely unlikely, but guarantee token uniqueness.
    let token = generateToken();
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await ctx.db
        .query("sessions")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique();
      if (!clash) break;
      token = generateToken();
    }

    await ctx.db.insert("sessions", {
      token,
      createdAt: now,
      expiresAt,
      status: "active",
      autoAccept,
      totalBytesUploaded: 0,
      fileCount: 0,
    });

    const base = normalizeOrigin(origin);
    return {
      token,
      url: `${base ?? ""}/r/${token}`,
      expiresAt,
      autoAccept,
      ...sessionLimits,
    };
  },
});

/** Public session info for a token. Returns null when unknown/invalid (never lists sessions). */
export const getSessionByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await findSession(ctx, token);
    if (!session) return null;
    return {
      status: publicStatus(session),
      autoAccept: session.autoAccept,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      fileCount: session.fileCount,
      totalBytesUploaded: session.totalBytesUploaded,
      path: `/r/${session.token}`,
      ...sessionLimits,
    };
  },
});

/** Internal lookup used by the upload action (actions have no direct db read). */
export const getSessionIdByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await requireActiveSession(ctx, token);
    return { sessionId: session._id };
  },
});

/** Closes a session from the receiver and immediately deletes all stored photos. */
export const closeSession = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await requireActiveSession(ctx, token);
    await deleteSessionFiles(ctx, session._id);
    await ctx.db.patch(session._id, {
      status: "closed",
      totalBytesUploaded: 0,
      fileCount: 0,
    });
    return { ok: true };
  },
});

/**
 * Deletes expired sessions, their photos and storage blobs, then purges
 * stale session records. Runs every minute via a cron job.
 */
export const cleanupExpiredSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let deletedFiles = 0;
    let deletedSessions = 0;

    // 1) Expire active sessions past their deadline, wiping their files.
    const due = await ctx.db
      .query("sessions")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(200);
    for (const session of due) {
      if (session.status === "active") {
        deletedFiles += await deleteSessionFiles(ctx, session._id);
        await ctx.db.patch(session._id, { status: "expired" });
      } else if (session.expiresAt < now - PURGE_GRACE_MS) {
        deletedFiles += await deleteSessionFiles(ctx, session._id);
        await ctx.db.delete(session._id);
        deletedSessions++;
      }
    }

    // 2) Safety net: orphaned photos past their expiry are removed too.
    const orphanPhotos = await ctx.db
      .query("photos")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(500);
    for (const photo of orphanPhotos) {
      await ctx.storage.delete(photo.storageId);
      await ctx.db.delete(photo._id);
      deletedFiles++;
    }

    return { deletedFiles, deletedSessions };
  },
});
