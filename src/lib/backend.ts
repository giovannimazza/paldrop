/**
 * Dual backend layer: the app talks either to the Convex cloud or to the
 * offline HTTP server hosted by the APK itself (see LocalHttpServer.java),
 * depending on which one is reachable.
 *
 * Queries keep their realtime Convex hooks in cloud mode and poll the local
 * REST API once a second in local mode; all mutations branch at call time so
 * page components stay backend-agnostic.
 */
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { ConvexHttpClient } from "convex/browser";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  absoluteSessionUrl,
  publicAppBaseUrl,
  readImageDimensions,
  resolveMime,
  uploadWithProgress,
} from "./client";

export type BackendMode = { kind: "convex" } | { kind: "local"; base: string };

export type SessionStatus = "active" | "expired" | "closed";
export type PhotoStatus = "pending" | "accepted" | "rejected";

export type SessionInfo = {
  status: SessionStatus;
  autoAccept: boolean;
  createdAt: number;
  expiresAt: number;
  fileCount: number;
  totalBytesUploaded: number;
  path: string;
  maxPhotos: number;
  maxTotalBytes: number;
};

export type PhotoInfo = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
  status: PhotoStatus;
  uploadedAt: number;
  expiresAt: number;
  url: string | null;
};

export type PhotosInfo = {
  status: SessionStatus;
  autoAccept: boolean;
  photos: PhotoInfo[];
};

type LocalServerInfo = { running: boolean; url?: string; ip?: string; port?: number };
type HotspotInfo = { running: boolean; ssid?: string; passphrase?: string };

export type HotspotState = { ssid: string; passphrase: string };

type LocalServerPluginType = {
  start(): Promise<LocalServerInfo>;
  stop(): Promise<{ running: boolean }>;
  status(): Promise<LocalServerInfo>;
  startHotspot(): Promise<HotspotInfo>;
  stopHotspot(): Promise<{ running: boolean }>;
  hotspotStatus(): Promise<HotspotInfo>;
};

const LocalServer = registerPlugin<LocalServerPluginType>("PaldropLocal");

/** True only inside the APK's WebView. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// --- mode resolution --------------------------------------------------------

let currentMode: BackendMode | null = null;
let detectPromise: Promise<BackendMode> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** True when the given base URL answers as the Paldrop local server. */
async function probeLocal(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/health`, { cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json()) as { app?: string };
    return data?.app === "paldrop-local";
  } catch {
    return false;
  }
}

async function detect(): Promise<BackendMode> {
  // 1) This page itself is served by the local server (sender phone).
  if (await probeLocal("")) {
    return { kind: "local", base: "" };
  }
  // 2) The native server was started earlier in this app run.
  if (isNativeApp()) {
    try {
      const info = await LocalServer.status();
      if (info.running && info.url && (await probeLocal(info.url))) {
        return { kind: "local", base: info.url };
      }
    } catch {
      // plugin unavailable: fall through to the cloud
    }
  }
  return { kind: "convex" };
}

function applyMode(mode: BackendMode): BackendMode {
  currentMode = mode;
  detectPromise = Promise.resolve(mode);
  emit();
  return mode;
}

function ensureMode(): Promise<BackendMode> {
  if (!detectPromise) {
    detectPromise = detect().then(applyMode);
  }
  return detectPromise;
}

/** Subscribes a component to the current backend mode (null while probing). */
export function useBackendMode(): BackendMode | null {
  const [mode, setMode] = useState<BackendMode | null>(currentMode);
  useEffect(() => {
    const listener = () => setMode(currentMode);
    listeners.add(listener);
    ensureMode().then(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return mode;
}

/** Starts the native offline server and switches the app to local mode. */
export async function startLocalServer(): Promise<BackendMode> {
  const info = await LocalServer.start();
  if (!info.running || !info.url || !(await probeLocal(info.url))) {
    throw codedError("SERVER_START_FAILED");
  }
  return applyMode({ kind: "local", base: info.url });
}

/** Stops the native offline server and re-detects the backend. */
export async function stopLocalServer(): Promise<BackendMode> {
  await LocalServer.stop();
  return applyMode(await detect());
}

// --- local-only hotspot -----------------------------------------------------

function pluginErrorCode(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z_]+$/.test(code)) return code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  const match = message.match(
    /HOTSPOT_UNSUPPORTED|HOTSPOT_FAILED|HOTSPOT_BUSY|PERMISSION_DENIED|SERVER_START_FAILED/
  );
  return match ? match[0] : fallback;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(codedError("HOTSPOT_FAILED")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Starts the Android local-only hotspot so the two phones get their own
 * network without a router; rejects with a coded error the UI can show.
 */
export async function startLocalHotspot(): Promise<HotspotState> {
  try {
    // Generous: the system permission dialog may be waiting for the user.
    const info = await withTimeout(LocalServer.startHotspot(), 120_000);
    if (!info.running || !info.ssid) throw codedError("HOTSPOT_FAILED");
    return { ssid: info.ssid, passphrase: info.passphrase ?? "" };
  } catch (error) {
    throw codedError(pluginErrorCode(error, "HOTSPOT_FAILED"));
  }
}

export async function stopLocalHotspot(): Promise<void> {
  try {
    await LocalServer.stopHotspot();
  } catch {
    // Already stopped.
  }
}

/** Returns the hotspot credentials when it is already running. */
export async function getLocalHotspot(): Promise<HotspotState | null> {
  try {
    const info = await LocalServer.hotspotStatus();
    if (info.running && info.ssid) {
      return { ssid: info.ssid, passphrase: info.passphrase ?? "" };
    }
  } catch {
    // Not native / plugin unavailable.
  }
  return null;
}

/**
 * True when a local base URL points at the phone itself (127.0.0.1/localhost):
 * other phones cannot reach that address, so it must never end up in a QR code.
 */
export function isLoopbackBase(mode: BackendMode | null): boolean {
  if (mode?.kind !== "local" || !mode.base) return false;
  return /^https?:\/\/(localhost|127(\.\d{1,3}){3}|\[::1\])(:\d+)?([/?#]|$)/i.test(
    mode.base
  );
}

/**
 * Re-detects the backend: the advertised server URL changes when the
 * hotspot (and with it the phone's IP address) comes up or goes down.
 *
 * The AP interface receives its IP address a moment after the system reports
 * the hotspot as started, so while the URL is still this device itself we
 * keep re-detecting briefly instead of baking 127.0.0.1 into the QR code.
 */
export async function refreshBackendMode(): Promise<BackendMode> {
  let mode = await detect();
  for (let attempt = 0; attempt < 5 && isLoopbackBase(mode); attempt++) {
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    mode = await detect();
  }
  return applyMode(mode);
}

// --- shared plumbing --------------------------------------------------------

function codedError(code: string): Error & { data?: unknown } {
  const error = new Error(code) as Error & { data?: unknown };
  error.data = { code };
  return error;
}

let httpClient: ConvexHttpClient | null = null;

function convex(): ConvexHttpClient {
  if (!httpClient) {
    const url = import.meta.env.VITE_CONVEX_URL;
    if (!url) throw codedError("NETWORK");
    httpClient = new ConvexHttpClient(url);
  }
  return httpClient;
}

async function localJson<T>(
  base: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw codedError("NETWORK");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body
  }
  if (!res.ok) {
    const code = (data as { code?: string } | null)?.code;
    throw codedError(typeof code === "string" ? code : "UNKNOWN");
  }
  return data as T;
}

/** Absolute URL of the QR target for a session in the active mode. */
export function sessionUrl(mode: BackendMode | null, token: string): string {
  if (mode?.kind === "local") {
    const base = mode.base || window.location.origin;
    return `${base.replace(/\/+$/, "")}/r/${token}`;
  }
  return absoluteSessionUrl(token);
}

/** Human-readable local server address (empty when running on the cloud). */
export function localServerUrl(mode: BackendMode | null): string | null {
  if (mode?.kind !== "local") return null;
  return mode.base || window.location.origin;
}

// --- operations -------------------------------------------------------------

export async function createSession(
  mode: BackendMode | null,
  autoAccept: boolean
): Promise<{ token: string; expiresAt: number }> {
  const active = mode ?? (await ensureMode());
  if (active.kind === "local") {
    return localJson(active.base, "POST", "/api/sessions", { autoAccept });
  }
  return await convex().mutation(api.sessions.createSession, {
    autoAccept,
    origin: publicAppBaseUrl(),
  });
}

export async function closeSession(mode: BackendMode | null, token: string): Promise<void> {
  const active = mode ?? (await ensureMode());
  if (active.kind === "local") {
    await localJson(active.base, "POST", `/api/sessions/${token}/close`, {});
    return;
  }
  await convex().mutation(api.sessions.closeSession, { token });
}

export async function extendSession(mode: BackendMode | null, token: string): Promise<void> {
  const active = mode ?? (await ensureMode());
  if (active.kind === "local") {
    await localJson(active.base, "POST", `/api/sessions/${token}/extend`, {});
    return;
  }
  await convex().mutation(api.sessions.extendSession, { token });
}

async function photoAction(
  mode: BackendMode | null,
  action: "accept" | "reject" | "delete",
  token: string,
  photoId: string
): Promise<void> {
  const active = mode ?? (await ensureMode());
  if (active.kind === "local") {
    await localJson(active.base, "POST", `/api/photos/${photoId}/${action}`, { token });
    return;
  }
  const args = { token, photoId: photoId as Id<"photos"> };
  if (action === "accept") await convex().mutation(api.photos.acceptPhoto, args);
  else if (action === "reject") await convex().mutation(api.photos.rejectPhoto, args);
  else await convex().mutation(api.photos.deletePhoto, args);
}

export const acceptPhoto = (mode: BackendMode | null, token: string, photoId: string) =>
  photoAction(mode, "accept", token, photoId);
export const rejectPhoto = (mode: BackendMode | null, token: string, photoId: string) =>
  photoAction(mode, "reject", token, photoId);
export const deletePhoto = (mode: BackendMode | null, token: string, photoId: string) =>
  photoAction(mode, "delete", token, photoId);

/** Uploads one file with progress, through the active backend. */
export async function uploadFile(options: {
  mode: BackendMode | null;
  token: string;
  file: File;
  onProgress: (fraction: number) => void;
}): Promise<void> {
  const { mode, token, file, onProgress } = options;
  const active = mode ?? (await ensureMode());
  const mimeType = resolveMime(file);

  if (active.kind === "local") {
    const query =
      `?fileName=${encodeURIComponent(file.name)}&mimeType=${encodeURIComponent(mimeType)}`;
    await localUpload(`${active.base}/api/sessions/${token}/upload${query}`, file, onProgress);
    return;
  }

  const dimensions = await readImageDimensions(file);
  const uploadUrl = await convex().mutation(api.photos.generateUploadUrl, { token });
  const storageId = await uploadWithProgress(uploadUrl, file, onProgress);
  await convex().action(api.photos.uploadPhoto, {
    token,
    storageId: storageId as Id<"_storage">,
    fileName: file.name,
    mimeType,
    fileSize: file.size,
    width: dimensions.width,
    height: dimensions.height,
  });
}

function localUpload(url: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let code = "UNKNOWN";
      try {
        code = (JSON.parse(xhr.responseText) as { code?: string })?.code ?? "UNKNOWN";
      } catch {
        // keep UNKNOWN
      }
      reject(codedError(code));
    };
    xhr.onerror = () => reject(codedError("NETWORK"));
    xhr.onabort = () => reject(codedError("NETWORK"));
    xhr.send(file);
  });
}

// --- queries ----------------------------------------------------------------

/**
 * Polls a local REST endpoint once a second.
 * undefined = still loading, null = not found / unreachable.
 */
function useLocalPoll<T>(url: string | null): T | null | undefined {
  // The stored data is tagged with the URL it belongs to: when the URL
  // changes (new token, mode switch) we report "loading" instead of stale or
  // initial null, otherwise the caller would treat it as "session missing".
  const [state, setState] = useState<{ url: string | null; data: T | null | undefined }>({
    url: null,
    data: undefined,
  });
  useEffect(() => {
    if (!url) {
      setState({ url: null, data: null });
      return;
    }
    let live = true;
    setState((prev) => (prev.url === url ? prev : { url, data: undefined }));
    const tick = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!live) return;
        if (!res.ok) {
          setState({ url, data: null });
          return;
        }
        const json = (await res.json()) as T;
        if (live) setState({ url, data: json });
      } catch {
        // Server unreachable: keep whatever we had, else treat as absent.
        if (live) {
          setState((prev) =>
            prev.url === url && prev.data !== undefined ? prev : { url, data: null }
          );
        }
      }
    };
    void tick();
    const interval = window.setInterval(() => void tick(), 1000);
    return () => {
      live = false;
      window.clearInterval(interval);
    };
  }, [url]);

  if (state.url !== url) {
    return url === null ? null : undefined;
  }
  return state.data;
}

export function useSessionInfo(
  mode: BackendMode | null,
  token: string | null
): SessionInfo | null | undefined {
  const convexSession = useQuery(
    api.sessions.getSessionByToken,
    mode && mode.kind === "convex" && token ? { token } : "skip"
  );
  const localSession = useLocalPoll<SessionInfo>(
    mode && mode.kind === "local" && token ? `${mode.base}/api/sessions/${token}` : null
  );
  if (!mode) return undefined;
  if (mode.kind === "local") return localSession;
  return convexSession as SessionInfo | null | undefined;
}

export function usePhotosInfo(
  mode: BackendMode | null,
  token: string | null
): PhotosInfo | null | undefined {
  const convexPhotos = useQuery(
    api.photos.listPhotos,
    mode && mode.kind === "convex" && token ? { token } : "skip"
  );
  const localPhotos = useLocalPoll<PhotosInfo>(
    mode && mode.kind === "local" && token ? `${mode.base}/api/sessions/${token}/photos` : null
  );
  if (!mode) return undefined;
  if (mode.kind === "local") {
    if (!localPhotos) return localPhotos;
    // The server sends photo URLs as "/api/files/<id>". Inside the APK the
    // page lives at Capacitor's http://localhost origin, which intercepts
    // extensionless paths and answers with index.html: an <img> would show
    // a broken white square and a save would store that HTML. Resolve the
    // URL against the local server's base so it is absolute.
    const base = mode.base;
    return {
      ...localPhotos,
      photos: localPhotos.photos.map((photo) =>
        photo.url && photo.url.startsWith("/")
          ? { ...photo, url: `${base.replace(/\/+$/, "")}${photo.url}` }
          : photo
      ),
    };
  }
  return convexPhotos as PhotosInfo | null | undefined;
}
