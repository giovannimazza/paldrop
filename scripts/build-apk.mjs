// Builds the web app with the canonical public URL and packages it as an APK.
// Usage: node scripts/build-apk.mjs [publicBaseUrl] [--stage=web|sync|gradle|copy]
//
// Without --stage it runs every stage, which is what you want locally. CI runs
// the stages as separate steps so a failure is visible from the step name even
// when the run's logs cannot be fetched.
//
// The QR code must contain a URL the *other* phone can open, so the bundle
// baked into the APK cannot use window.location.origin (the WebView serves
// assets from https://localhost).
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundleVersion } from "./lib/version.mjs";

const args = process.argv.slice(2);
const stageArg = args.find((a) => a.startsWith("--stage="))?.slice("--stage=".length);
const positional = args.find((a) => !a.startsWith("--"));
const PUBLIC_URL = positional ?? process.env.PALDROP_PUBLIC_URL ?? "https://giovannimazza.github.io/paldrop/";

const STAGES = ["web", "sync", "gradle", "copy"];
if (stageArg && !STAGES.includes(stageArg)) {
  throw new Error(`Unknown stage "${stageArg}"; expected one of ${STAGES.join(", ")}`);
}
const runs = (stage) => !stageArg || stageArg === stage;
const isWindows = process.platform === "win32";

function findJdk21() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  const base = ".tools/jdk21";
  if (!existsSync(base)) return undefined;
  const entry = readdirSync(base).find((name) =>
    statSync(join(base, name)).isDirectory()
  );
  return entry ? resolve(base, entry) : undefined;
}

const env = {
  ...process.env,
  VITE_PUBLIC_APP_URL: PUBLIC_URL,
  // Shown in the app footer so an installed APK can be recognised at a glance.
  VITE_BUILD_STAMP: (() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  })(),
  // OTA: the APK knows its own bundle version and where to look for newer
  // ones, so it only picks up bundles published after this build.
  VITE_OTA_VERSION: bundleVersion(),
  VITE_OTA_MANIFEST_URL: (PUBLIC_URL.endsWith("/") ? PUBLIC_URL : PUBLIC_URL + "/") + "ota.json",
  ANDROID_HOME: process.env.ANDROID_HOME ?? resolve(".android-sdk"),
};
const javaHome = findJdk21();
if (javaHome) env.JAVA_HOME = javaHome;

if (runs("web")) {
  console.log(`\n1/4  Building web app with VITE_PUBLIC_APP_URL=${PUBLIC_URL}`);
  execSync("npm run build", { stdio: "inherit", env });
}

if (runs("sync")) {
  console.log("\n2/4  Syncing assets into the Android project");
  execSync("npx cap sync android", { stdio: "inherit", env });
}

if (runs("gradle")) {
  console.log("\n3/4  Compiling the APK (Gradle assembleDebug)");
  const gradle = isWindows
    ? ".\\gradlew.bat assembleDebug --no-daemon"
    : "./gradlew assembleDebug --no-daemon";
  execSync(gradle, { stdio: "inherit", env, cwd: "android" });
}

if (runs("copy")) {
  console.log("\n4/4  Copying APK to the project root");
  const apk = "android/app/build/outputs/apk/debug/app-debug.apk";
  copyFileSync(apk, "Paldrop.apk");
  const size = (statSync("Paldrop.apk").size / 1024 / 1024).toFixed(2);
  console.log(`\nDONE  Paldrop.apk (${size} MB) -> ${resolve("Paldrop.apk")}`);
}
