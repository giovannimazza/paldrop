// Builds the OTA bundle: the same web app the APK ships, packed as a zip, plus
// the manifest the installed app polls to notice there is something newer.
//
// Usage: node scripts/build-ota-bundle.mjs [publicBaseUrl]
//
// Output (in ota/, served from the root of the public site):
//   ota.json                     -> { version, url, builtAt }
//   paldrop-<version>.zip        -> the dist/ tree, index.html at the root
//
// Only HTML/CSS/JS travel this way. Anything native (a new plugin, a
// permission, the launcher icon) still needs a fresh APK.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import { createZip } from "./lib/zip.mjs";
import { bundleVersion } from "./lib/version.mjs";

const PUBLIC_URL = process.argv[2] ?? process.env.PALDROP_PUBLIC_URL ?? "https://giovannimazza.github.io/paldrop/";
const base = PUBLIC_URL.endsWith("/") ? PUBLIC_URL : PUBLIC_URL + "/";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push({ full, dir: true, mtime: st.mtime });
      out.push(...walk(full));
    } else {
      out.push({ full, dir: false, mtime: st.mtime });
    }
  }
  return out;
}

const now = new Date();
const version = process.env.PALDROP_OTA_VERSION ?? bundleVersion(now);
const zipName = `paldrop-${version}.zip`;

const env = {
  ...process.env,
  // The bundle is served from the WebView root, never from /paldrop/.
  BASE_PATH: "/",
  VITE_PUBLIC_APP_URL: base,
  VITE_OTA_VERSION: version,
  VITE_OTA_MANIFEST_URL: base + "ota.json",
  VITE_BUILD_STAMP: version,
};

// PALDROP_OTA_SKIP_BUILD reuses whatever is already in dist/, for repacking
// an existing build without paying for a full rebuild.
if (process.env.PALDROP_OTA_SKIP_BUILD === "1") {
  console.log(`\n1/3  Reusing the existing dist/ (version ${version})`);
} else {
  console.log(`\n1/3  Building the web app for the bundle (version ${version})`);
  execSync("npm run build", { stdio: "inherit", env });
}

console.log("\n2/3  Packing dist/ into the bundle zip");
const dist = resolve("dist");
const entries = walk(dist).map((item) => ({
  name: relative(dist, item.full).split(sep).join(posix.sep) + (item.dir ? "/" : ""),
  dir: item.dir,
  mtime: item.mtime,
  data: item.dir ? undefined : readFileSync(item.full),
}));
if (!entries.some((e) => e.name === "index.html")) {
  throw new Error("dist/index.html is missing: refusing to publish a bundle the WebView cannot boot");
}

const out = resolve("ota");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const zip = createZip(entries);
writeFileSync(join(out, zipName), zip);

console.log("\n3/3  Writing the manifest");
writeFileSync(
  join(out, "ota.json"),
  JSON.stringify({ version, url: base + zipName, builtAt: now.toISOString() }, null, 2) + "\n"
);

const size = (zip.length / 1024 / 1024).toFixed(2);
console.log(`\nDONE  ${zipName} (${size} MB) and ota.json -> ${out}`);
