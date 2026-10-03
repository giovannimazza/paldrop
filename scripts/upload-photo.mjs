// Simulates the sender phone: uploads a photo into a Paldrop session.
// Usage: node scripts/upload-photo.mjs <sessionToken> <file> [mimeType]
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const CONVEX_URL = process.env.VITE_CONVEX_URL ?? "http://127.0.0.1:3210";

const [token, file, explicitMime] = process.argv.slice(2);
if (!token || !file) {
  console.error("Usage: node scripts/upload-photo.mjs <sessionToken> <file> [mimeType]");
  process.exit(1);
}

const mimeByExtension = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heic",
  ".txt": "text/plain",
};
const mimeType = explicitMime ?? mimeByExtension[extname(file).toLowerCase()] ?? "image/png";
const bytes = readFileSync(file);

const client = new ConvexHttpClient(CONVEX_URL);

try {
  const uploadUrl = await client.mutation(api.photos.generateUploadUrl, { token });
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: bytes,
  });
  if (!response.ok) throw new Error(`storage upload failed: ${response.status}`);
  const { storageId } = await response.json();

  const result = await client.action(api.photos.uploadPhoto, {
    token,
    storageId,
    fileName: basename(file),
    mimeType,
    fileSize: bytes.length,
    width: 640,
    height: 480,
  });
  console.log("OK", JSON.stringify(result));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const coded = message.match(/Paldrop:([A-Z_]+)/);
  console.log("ERROR", coded ? coded[1] : message);
  process.exitCode = 1;
}
