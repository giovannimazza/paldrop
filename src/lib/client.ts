/** Client-side helpers: codes, downloads, uploads with progress, formatting. */

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
  const message = String(
    (error as { data?: unknown } | null)?.data ?? (error instanceof Error ? error.message : error) ?? ""
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

/** Downloads a file through a blob so cross-origin photos land in the gallery. */
export async function downloadFile(url: string, fileName: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("download failed");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerDownload(objectUrl, fileName);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  } catch {
    // Fallback: plain link (Convex storage serves with the right headers).
    triggerDownload(url, fileName);
  }
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

/** Absolute URL of the send page, honouring a possible base path (e.g. GitHub Pages). */
export function absoluteSessionUrl(token: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/*$/, "/");
  return `${window.location.origin}${base}r/${token}`;
}

/** Base URL (origin + base path, trailing slash) used when creating a session. */
export function appBaseUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/*$/, "/")}`;
}
