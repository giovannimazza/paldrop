/** Client-side helpers: codes, downloads, uploads with progress, formatting. */

import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { codedError, extractErrorCode, withTimeout } from "./errors";

/** Native Android plugin bundled in the APK (see android/.../MediaSavePlugin.java). */
type MediaSaveOptions = { url: string; fileName: string; mimeType: string };
type MediaSaveResult = { uri: string; bytes: number };
const MediaSave = registerPlugin<{ save(o: MediaSaveOptions): Promise<MediaSaveResult> }>(
  "MediaSave"
);

export const TOKEN_PATTERN = /^[A-Z2-7]{32}$/;

/** Uppercases and strips separators so users can paste codes with spaces/dashes. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidCode(input: string): boolean {
  return TOKEN_PATTERN.test(normalizeCode(input));
}

/** Groups a code in blocks of 4 for readable display: ABCD EFGH ... */
export function formatCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join(" ");
}

const CODE_ERROR_PATTERN = /Paldrop:([A-Z_]+)/;

/** Extracts a coded backend error, falling back to a network/unknown bucket. */
export function errorCodeOf(error: unknown): string {
  // ConvexError payload: { code: "SESSION_EXPIRED" } (survives production redaction)
  const data = (error as { data?: unknown } | null)?.data;
  if (data && typeof data === "object" && typeof (data as { code?: unknown }).code === "string") {
    return (data as { code: string }).code;
  }
  const message = String(
    (error as { data?: unknown } | null)?.data ??
      (error instanceof Error ? error.message : error) ??
      ""
  );
  const match = message.match(CODE_ERROR_PATTERN);
  if (match) return match[1];
  if (/fetch|network|Failed to|WebSocket|load failed/i.test(message)) return "NETWORK";
  return "UNKNOWN";
}

/** POSTs a blob to a Convex upload URL, reporting progress (0..1). */
export function uploadWithProgress(
  url: string,
  blob: Blob,
  onProgress: (fraction: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (blob.type) xhr.setRequestHeader("Content-Type", blob.type);
    xhr.responseType = "text";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as { storageId?: string };
          if (parsed.storageId) {
            resolve(parsed.storageId);
            return;
          }
          reject(new Error("Paldrop:UPLOAD_INVALID"));
        } catch {
          reject(new Error("Paldrop:UPLOAD_INVALID"));
        }
      } else {
        reject(new Error("Paldrop:UPLOAD_INVALID"));
      }
    };
    xhr.onerror = () => reject(new Error("network error"));
    xhr.onabort = () => reject(new Error("network error"));
    xhr.send(blob);
  });
}

/** Reads natural dimensions so the receiver can lay out previews. */
export function readImageDimensions(
  file: File
): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    if (typeof URL === "undefined" || !file.type.startsWith("image/")) {
      resolve({});
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: image.naturalWidth || undefined,
        height: image.naturalHeight || undefined,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({});
    };
    image.src = url;
  });
}

/** Where a save ended up, so the UI can confirm it to the user. */
export type DownloadOutcome = "native" | "native-fallback" | "web";

/**
 * Saves a photo so the user can actually find it afterwards.
 * In the APK the WebView has no download manager and ignores the `download`
 * attribute for cross-origin URLs, so native code does the work; on the web
 * a blob keeps the file in the browser's downloads.
 *
 * Resolves with where the save happened and rejects with a coded error
 * (`data.code`) when nothing could be saved, so the caller can always show
 * an outcome instead of doing nothing.
 */
export async function downloadFile(
  url: string,
  fileName: string,
  mimeType: string = "image/jpeg"
): Promise<DownloadOutcome> {
  if (isNativePlatform()) {
    let failureCode = "SAVE_FAILED";
    try {
      // 1) Native download straight into MediaStore (gallery / Download).
      //    On Android 9- this first shows the storage permission prompt.
      //    A stuck native call must not hang the button forever.
      await withTimeout(MediaSave.save({ url, fileName, mimeType }), 45_000, "SAVE_TIMEOUT");
      return "native";
    } catch (error) {
      failureCode = nativeErrorCode(error);
      // A denied permission is terminal: retrying would only re-prompt.
      if (failureCode !== "PERMISSION_DENIED") {
        try {
          // 2) Fallback: fetch here and write into the public Documents folder.
          await withTimeout(saveViaFilesystem(url, fileName), 45_000, "SAVE_TIMEOUT");
          return "native-fallback";
        } catch {
          // Keep the original code for the error surfaced below.
        }
      }
    }
    // Nothing saved: report why, so the UI can show a real message instead
    // of silently doing nothing (the WebView has no download manager).
    throw codedError(failureCode);
  }
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("download failed");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerDownload(objectUrl, fileName);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    return "web";
  } catch {
    // Fallback: plain link (Convex storage serves with the right headers).
    triggerDownload(url, fileName);
    return "web";
  }
}

/** Extracts a coded reason from a Capacitor plugin rejection. */
function nativeErrorCode(error: unknown): string {
  return extractErrorCode(
    error,
    /PERMISSION_DENIED|MISSING_ARGS|SAVE_TIMEOUT|SAVE_FAILED/,
    "SAVE_FAILED"
  );
}

/** Build stamp baked in by scripts/build-apk.mjs ("dev" for plain builds). */
export const APP_BUILD = import.meta.env.VITE_BUILD_STAMP ?? "dev";

/** True only inside the Capacitor WebView (Android APK). */
function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Fetches the photo and writes it into the public Documents/Paldrop folder. */
async function saveViaFilesystem(url: string, fileName: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("download failed");
  // An HTML body means we hit a page (e.g. an SPA shell), not the photo:
  // saving it would create a corrupt white file in the gallery.
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) throw new Error("html response");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) throw new Error("empty file");
  await Filesystem.writeFile({
    path: `Paldrop/${fileName}`,
    data: arrayBufferToBase64(buffer),
    directory: Directory.Documents,
    recursive: true,
  });
}

/** Chunked base64 encoding: large photos would overflow the stack otherwise. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function triggerDownload(href: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Resolves the MIME type sent to the server, filling gaps for pickers that
 * leave `file.type` empty and normalizing HEIF to the accepted HEIC type.
 */
export function resolveMime(file: File): string {
  const declared = (file.type || "").toLowerCase();
  if (declared === "image/heif") return "image/heic";
  if (declared) return declared;
  const extension = (file.name.split(".").pop() || "").toLowerCase();
  const byExtension: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heic",
  };
  return byExtension[extension] ?? "image/jpeg";
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
};

export function ensureExtension(fileName: string, mimeType: string): string {
  if (/\.[a-z0-9]+$/i.test(fileName)) return fileName;
  return fileName + (EXTENSION_BY_TYPE[mimeType] ?? "");
}

export function formatBytes(bytes: number, lang: "it" | "en"): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const decimals = unit <= 1 ? 0 : value >= 10 ? 0 : 1;
  const rendered = value
    .toFixed(decimals)
    .replace(".", lang === "it" ? "," : ".");
  return `${rendered} ${units[unit]}`;
}

/** mm:ss countdown, clamped at zero. */
export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Canonical absolute base URL of the hosted app, always ending with "/".
 *
 * Inside the Capacitor APK the WebView loads bundled assets from
 * https://localhost, so window.location.origin would put "localhost" in the
 * QR code. VITE_PUBLIC_APP_URL (baked in by scripts/build-apk.mjs) points at
 * the real hosted site; plain web builds fall back to the current origin plus
 * the base path.
 */
export function publicAppBaseUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
  if (configured) return `${configured.replace(/\/+$/, "")}/`;
  return `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/*$/, "/")}`;
}

/** Absolute URL of the send page, honouring a possible base path (e.g. GitHub Pages). */
export function absoluteSessionUrl(token: string): string {
  return `${publicAppBaseUrl()}r/${token}`;
}
