// Builds the web app with the canonical public URL and packages it as an APK.
// Usage: node scripts/build-apk.mjs [publicBaseUrl]
//
// The QR code must contain a URL the *other* phone can open, so the bundle
// baked into the APK cannot use window.location.origin (the WebView serves
// assets from https://localhost).
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const PUBLIC_URL = process.argv[2] ?? process.env.PALDROP_PUBLIC_URL ?? "https://giovannimazza.github.io/paldrop/";
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
  ANDROID_HOME: process.env.ANDROID_HOME ?? resolve(".android-sdk"),
};
const javaHome = findJdk21();
if (javaHome) env.JAVA_HOME = javaHome;

console.log(`\n1/4  Building web app with VITE_PUBLIC_APP_URL=${PUBLIC_URL}`);
execSync("npm run build", { stdio: "inherit", env });

console.log("\n2/4  Syncing assets into the Android project");
execSync("npx cap sync android", { stdio: "inherit", env });

console.log("\n3/4  Compiling the APK (Gradle assembleDebug)");
const gradle = isWindows
  ? ".\\gradlew.bat assembleDebug --no-daemon"
  : "./gradlew assembleDebug --no-daemon";
execSync(gradle, { stdio: "inherit", env, cwd: "android" });

console.log("\n4/4  Copying APK to the project root");
const apk = "android/app/build/outputs/apk/debug/app-debug.apk";
copyFileSync(apk, "Paldrop.apk");
const size = (statSync("Paldrop.apk").size / 1024 / 1024).toFixed(2);
console.log(`\nDONE  Paldrop.apk (${size} MB) -> ${resolve("Paldrop.apk")}`);
