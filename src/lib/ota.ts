// Over-the-air updates for the installed APK.
//
// The app polls a manifest published next to the web app, downloads the newer
// bundle in the background and swaps it in only when the user asks — a reload
// in the middle of a transfer would lose the photos being uploaded.
//
// Only HTML/CSS/JS ship this way. Native changes still need a new APK.
import { Capacitor } from "@capacitor/core";

export type OtaManifest = { version: string; url: string; builtAt?: string };

export type OtaState =
  | { phase: "idle" }
  | { phase: "downloading"; version: string }
  | { phase: "ready"; version: string }
  | { phase: "failed" };

/** Version of the bundle currently running, baked in at build time. */
export const BUNDLE_VERSION = import.meta.env.VITE_OTA_VERSION ?? "0.0.0";
const MANIFEST_URL = import.meta.env.VITE_OTA_MANIFEST_URL ?? "";
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Parses `1.261007.2130` into comparable parts; null when it isn't a version. */
export function parseVersion(value: unknown): number[] | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split(".");
  if (parts.length === 0 || parts.length > 4) return null;
  const out: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    out.push(Number(part));
  }
  return out;
}

/** >0 when a is newer than b, 0 when equal, <0 when older. */
export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Validates a manifest and decides whether it describes a newer bundle.
 * The zip has to sit on the same origin as the manifest: a manifest someone
 * managed to tamper with still cannot point the app at a bundle elsewhere.
 */
export function pickUpdate(raw: unknown, currentVersion: string, manifestUrl: string): OtaManifest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { version, url } = raw as Record<string, unknown>;
  const next = parseVersion(version);
  const current = parseVersion(currentVersion);
  if (!next || !current || typeof url !== "string") return null;
  if (compareVersions(next, current) <= 0) return null;
  let target: URL;
  let manifest: URL;
  try {
    target = new URL(url);
    manifest = new URL(manifestUrl);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" || target.origin !== manifest.origin) return null;
  return { version: version as string, url };
}

let state: OtaState = { phase: "idle" };
let pendingId: string | null = null;
let checking = false;
let lastCheck = 0;
const listeners = new Set<(state: OtaState) => void>();

function setState(next: OtaState): void {
  state = next;
  for (const listener of listeners) listener(next);
}

export function getOtaState(): OtaState {
  return state;
}

export function subscribeOta(listener: (state: OtaState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// Kept out of the web bundle: the plugin only exists inside the WebView.
async function updater() {
  const mod = await import("@capgo/capacitor-updater");
  return mod.CapacitorUpdater;
}

export function isOtaSupported(): boolean {
  return isNative() && MANIFEST_URL !== "";
}

export async function checkForOtaUpdate(force = false): Promise<void> {
  if (!isOtaSupported() || checking) return;
  if (state.phase === "downloading" || state.phase === "ready") return;
  if (!force && lastCheck !== 0 && Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
  checking = true;
  lastCheck = Date.now();
  try {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) return;
    const update = pickUpdate(await response.json(), BUNDLE_VERSION, MANIFEST_URL);
    if (!update) {
      setState({ phase: "idle" });
      return;
    }
    setState({ phase: "downloading", version: update.version });
    const bundle = await (await updater()).download({ url: update.url, version: update.version });
    pendingId = bundle.id;
    setState({ phase: "ready", version: update.version });
  } catch {
    setState({ phase: "failed" });
  } finally {
    checking = false;
  }
}

/** Swaps in the downloaded bundle. The WebView reloads, so nothing runs after. */
export async function applyOta(): Promise<void> {
  if (!pendingId) return;
  await (await updater()).set({ id: pendingId });
}

/**
 * Call once at startup. notifyAppReady() has to run on every native launch:
 * without it the plugin assumes the bundle crashed and rolls back.
 */
export async function startOta(): Promise<void> {
  if (!isNative()) return;
  try {
    await (await updater()).notifyAppReady();
  } catch {
    // An older APK without the plugin, or a bundle already marked ready.
  }
  if (!MANIFEST_URL) return;
  void checkForOtaUpdate(true);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void checkForOtaUpdate();
  });
}
