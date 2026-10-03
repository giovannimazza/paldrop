import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    token: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    status: v.union(v.literal("active"), v.literal("closed"), v.literal("expired")),
    autoAccept: v.boolean(),
    totalBytesUploaded: v.number(),
    fileCount: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_expiresAt", ["expiresAt"]),

  photos: defineTable({
    sessionId: v.id("sessions"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    fileSize: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("rejected")),
    uploadedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_status", ["sessionId", "status"])
    .index("by_expiresAt", ["expiresAt"]),
});
