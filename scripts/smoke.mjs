// Paldrop server-side smoke suite. Run against a local Convex deployment:
//   npx convex dev
//   node scripts/smoke.mjs
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const CONVEX_URL = process.env.VITE_CONVEX_URL ?? "http://127.0.0.1:3210";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const client = new ConvexHttpClient(CONVEX_URL);

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function errorCode(error) {
  // Preferred channel: ConvexError payload (works on production deployments).
  const data = error?.data;
  if (data && typeof data.code === "string") return data.code;
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/Paldrop:([A-Z_]+)/)?.[1] ?? message;
}

async function expectErrorCode(label, promise, expected) {
  try {
    await promise;
    check(label, false, `expected ${expected}, nothing thrown`);
  } catch (error) {
    check(label, errorCode(error) === expected, `got ${errorCode(error)}`);
  }
}

async function upload(token, bytes, mimeType, fileName) {
  const uploadUrl = await client.mutation(api.photos.generateUploadUrl, { token });
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: bytes,
  });
  if (!response.ok) throw new Error(`storage upload failed: ${response.status}`);
  const { storageId } = await response.json();
  return await client.action(api.photos.uploadPhoto, {
    token,
    storageId,
    fileName,
    mimeType,
    fileSize: bytes.length,
  });
}

function pngLikeBuffer(size) {
  const buffer = Buffer.alloc(size, 0x11);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.write("IHDR", 12, "ascii");
  return buffer;
}

const { readFileSync } = await import("node:fs");
const photo = readFileSync("scripts/test-photo.png");

// --- session lifecycle ------------------------------------------------------
console.log("Session lifecycle");
const created = await client.mutation(api.sessions.createSession, {
  autoAccept: false,
  origin: "https://paldrop.example",
});
check("createSession returns a 32-char token", /^[A-Z2-7]{32}$/.test(created.token), created.token);
check("createSession returns a full QR url", created.url === `https://paldrop.example/r/${created.token}`, created.url);
check("createSession sets a 15 min expiry", Math.abs(created.expiresAt - Date.now() - 15 * 60 * 1000) < 5000);
check("createSession exposes limits", created.maxPhotos === 20 && created.maxTotalBytes === MAX_TOTAL_BYTES);

const session = await client.query(api.sessions.getSessionByToken, { token: created.token });
check("getSessionByToken returns active session", session?.status === "active" && session.autoAccept === false);
check("getSessionByToken never leaks the token list", session?.path === `/r/${created.token}`);
check("getSessionByToken returns null for unknown token", (await client.query(api.sessions.getSessionByToken, { token: "A".repeat(32) })) === null);
check("listPhotos returns null for unknown token", (await client.query(api.photos.listPhotos, { token: "A".repeat(32) })) === null);
check(
  "malformed token returns null",
  (await client.query(api.sessions.getSessionByToken, { token: "short" })) === null
);

// --- upload validation ------------------------------------------------------
console.log("Upload validation");
const valid = await upload(created.token, photo, "image/png", "foto.png");
check("valid PNG accepted as pending", valid.status === "pending" && valid.fileCount === 1);
check("byte accounting is tracked", valid.totalBytesUploaded === photo.length);

await expectErrorCode(
  "non-image bytes rejected (sniffing)",
  upload(created.token, Buffer.from("questo non è un'immagine"), "image/png", "falso.png"),
  "INVALID_FILE_TYPE"
);
await expectErrorCode(
  "PNG bytes with image/jpeg declared type rejected",
  upload(created.token, photo, "image/jpeg", "falso.jpg"),
  "INVALID_FILE_TYPE"
);
await expectErrorCode(
  "GIF bytes declared as webp rejected",
  upload(created.token, Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64)]), "image/webp", "falso.webp"),
  "INVALID_FILE_TYPE"
);
await expectErrorCode(
  "file over 25 MB rejected",
  upload(created.token, pngLikeBuffer(MAX_FILE_BYTES + 1024), "image/png", "grande.png"),
  "LIMIT_FILE_SIZE"
);
await expectErrorCode(
  "upload to unknown session rejected",
  upload("B".repeat(32), photo, "image/png", "foto.png"),
  "SESSION_NOT_FOUND"
);

// --- photo moderation -------------------------------------------------------
console.log("Photo moderation");
const photoId = valid.id;
const photos = await client.query(api.photos.listPhotos, { token: created.token });
check("listPhotos shows the pending photo", photos.photos.length === 1 && photos.photos[0].url !== null);
await client.mutation(api.photos.acceptPhoto, { token: created.token, photoId });
const afterAccept = await client.query(api.photos.listPhotos, { token: created.token });
check("acceptPhoto moves photo to accepted", afterAccept.photos[0].status === "accepted");
await client.mutation(api.photos.rejectPhoto, { token: created.token, photoId });
const afterReject = await client.query(api.photos.listPhotos, { token: created.token });
check("rejectPhoto hides the photo", afterReject.photos.length === 0);
await client.mutation(api.photos.deletePhoto, { token: created.token, photoId });
const sessionAfterDelete = await client.query(api.sessions.getSessionByToken, { token: created.token });
check("deletePhoto frees the byte counter", sessionAfterDelete.totalBytesUploaded === 0 && sessionAfterDelete.fileCount === 0);

// --- limits -----------------------------------------------------------------
console.log("Session limits");
for (let i = 0; i < 20; i++) {
  await upload(created.token, photo, "image/png", `foto-${i}.png`);
}
const full = await client.query(api.sessions.getSessionByToken, { token: created.token });
check("20 photos accepted", full.fileCount === 20, String(full.fileCount));
await expectErrorCode(
  "21st photo rejected",
  upload(created.token, photo, "image/png", "foto-21.png"),
  "LIMIT_PHOTO_COUNT"
);

// --- total bytes limit ------------------------------------------------------
console.log("Total byte limit (100 MB)");
const big = await client.mutation(api.sessions.createSession, { autoAccept: true });
for (let i = 0; i < 4; i++) {
  await upload(big.token, pngLikeBuffer(MAX_FILE_BYTES), "image/png", `big-${i}.png`);
}
const fourBig = await client.query(api.sessions.getSessionByToken, { token: big.token });
check("4 x 25 MB accepted (100 MB exactly)", fourBig.fileCount === 4 && fourBig.totalBytesUploaded === MAX_TOTAL_BYTES, JSON.stringify(fourBig));
await expectErrorCode(
  "next photo rejected over 100 MB",
  upload(big.token, photo, "image/png", "extra.png"),
  "LIMIT_TOTAL_BYTES"
);
await client.mutation(api.sessions.closeSession, { token: big.token });

// --- close ------------------------------------------------------------------
console.log("Session close");
await client.mutation(api.sessions.closeSession, { token: created.token });
const closed = await client.query(api.sessions.getSessionByToken, { token: created.token });
check("closed session reports closed", closed.status === "closed");
const closedPhotos = await client.query(api.photos.listPhotos, { token: created.token });
check("closed session has no photos left", closedPhotos.photos.length === 0);
await expectErrorCode(
  "upload after close rejected",
  upload(created.token, photo, "image/png", "dopo.png"),
  "SESSION_CLOSED"
);
await expectErrorCode(
  "closeSession is idempotent-safe for unknown tokens",
  client.mutation(api.sessions.closeSession, { token: "Z".repeat(32) }),
  "SESSION_NOT_FOUND"
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
