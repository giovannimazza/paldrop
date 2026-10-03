// Paldrop offline-backend smoke suite (LocalHttpServer hosted by the APK).
//
// The server is pure Java, so run it on a desktop JVM first:
//   .tools/jdk21/<jdk>/bin/javac -d .tmp/localserver/out \
//     android/app/src/main/java/com/giovannimazza/paldrop/local/LocalHttpServer.java \
//     scripts/local-server/LocalServerMain.java
//   .tools/jdk21/<jdk>/bin/java -cp .tmp/localserver/out LocalServerMain dist .tmp/localserver/data 8787
//   node scripts/smoke-local.mjs [baseUrl]
//
// Requires `npm run build` first (the suite serves and fetches dist/).
import { readFileSync, globSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
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

async function json(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-json body
  }
  return { status: res.status, data, headers: res.headers };
}

const png = readFileSync("scripts/test-photo.png");

console.log("Health & static");
{
  const health = await json("GET", "/api/health");
  check("health reports paldrop-local", health.status === 200 && health.data?.app === "paldrop-local", JSON.stringify(health.data));
  check("health has CORS header", health.headers.get("access-control-allow-origin") === "*");

  const index = await fetch(`${BASE}/`);
  const html = await index.text();
  check("GET / serves the app shell", index.status === 200 && /<!doctype html/i.test(html), `status ${index.status}`);

  const assetName = globSync("dist/assets/*.js").map((p) => p.replaceAll("\\", "/"))[0]?.split("/").pop();
  const asset = await fetch(`${BASE}/assets/${assetName}`);
  check("GET /assets/*.js serves the bundle", asset.status === 200 && (asset.headers.get("content-type") ?? "").includes("javascript"), `status ${asset.status}`);

  const spa = await fetch(`${BASE}/r/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`);
  check("SPA fallback serves index.html for /r/<token>", spa.status === 200 && /<!doctype html/i.test(await spa.text()));

  const route = await fetch(`${BASE}/receive`);
  const routeType = route.headers.get("content-type") ?? "";
  check("SPA routes are served as text/html", route.status === 200 && routeType.includes("text/html"), `status ${route.status} type ${routeType}`);

  const spaType = (await fetch(`${BASE}/r/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).headers.get("content-type") ?? "";
  check("SPA fallback keeps the html content type", spaType.includes("text/html"), spaType);

  const traversal = await fetch(`${BASE}/../../etc/passwd`);
  const traversalText = await traversal.text();
  check("path traversal does not leak files", !traversalText.includes("root:"), traversalText.slice(0, 40));

  const missing = await fetch(`${BASE}/nope.js`);
  const missingText = await missing.text();
  check("missing asset falls back to index.html", missing.status === 200 && /<!doctype html/i.test(missingText));
  check("missing asset fallback is html, not js", (missing.headers.get("content-type") ?? "").includes("text/html"), missing.headers.get("content-type") ?? "");
}

console.log("Session lifecycle");
let token;
{
  const created = await json("POST", "/api/sessions", { autoAccept: false });
  token = created.data?.token;
  check("createSession returns a 32-char token", created.status === 200 && /^[A-Z2-7]{32}$/.test(token ?? ""), JSON.stringify(created.data));
  check("createSession sets a 15 min expiry", Math.abs(created.data.expiresAt - Date.now() - 15 * 60 * 1000) < 5000);
  check("createSession exposes limits", created.data.maxPhotos === 20 && created.data.maxTotalBytes === 100 * 1024 * 1024);

  const fetched = await json("GET", `/api/sessions/${token}`);
  check("getSession returns active session", fetched.status === 200 && fetched.data.status === "active" && fetched.data.autoAccept === false);

  const unknown = await json("GET", `/api/sessions/${"A".repeat(32)}`);
  check("unknown session returns SESSION_NOT_FOUND", unknown.status === 404 && unknown.data?.code === "SESSION_NOT_FOUND", JSON.stringify(unknown.data));
}

console.log("Upload validation");
let photoId;
{
  const ok = await fetch(`${BASE}/api/sessions/${token}/upload?fileName=foto.png&mimeType=image/png`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  const okData = await ok.json();
  photoId = okData?.id;
  check("valid PNG accepted as pending", ok.status === 200 && okData.status === "pending" && okData.fileCount === 1, JSON.stringify(okData));
  check("byte accounting is tracked", okData.totalBytesUploaded === png.length, String(okData.totalBytesUploaded));

  const fake = await fetch(`${BASE}/api/sessions/${token}/upload?fileName=falso.png&mimeType=image/png`, {
    method: "POST",
    body: Buffer.from("questo non e un'immagine"),
  });
  const fakeData = await fake.json().catch(() => null);
  check("non-image bytes rejected (sniffing)", fake.status === 400 && fakeData?.code === "INVALID_FILE_TYPE", JSON.stringify(fakeData));

  const mismatch = await fetch(`${BASE}/api/sessions/${token}/upload?fileName=foto.jpg&mimeType=image/jpeg`, {
    method: "POST",
    body: png,
  });
  const mismatchData = await mismatch.json().catch(() => null);
  check("declared mime must match the bytes", mismatch.status === 400 && mismatchData?.code === "INVALID_FILE_TYPE", JSON.stringify(mismatchData));

  const oversized = await fetch(`${BASE}/api/sessions/${token}/upload?fileName=big.png&mimeType=image/png`, {
    method: "POST",
    body: Buffer.alloc(25 * 1024 * 1024 + 1, 1),
  });
  const oversizedData = await oversized.json().catch(() => null);
  check("file over 25 MB rejected", oversized.status === 413 && oversizedData?.code === "LIMIT_FILE_SIZE", `${oversized.status} ${JSON.stringify(oversizedData)}`);
}

console.log("Photos");
{
  const list = await json("GET", `/api/sessions/${token}/photos`);
  check("listPhotos returns the pending photo", list.status === 200 && list.data.photos.length === 1 && list.data.photos[0].url !== null, JSON.stringify(list.data));

  const file = await fetch(`${BASE}${list.data.photos[0].url}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  check("file bytes round-trip with the right type", file.status === 200 && file.headers.get("content-type") === "image/png" && bytes.equals(png), `status ${file.status} type ${file.headers.get("content-type")}`);

  const accept = await json("POST", `/api/photos/${photoId}/accept`, { token });
  const afterAccept = await json("GET", `/api/sessions/${token}/photos`);
  check("acceptPhoto moves photo to accepted", accept.status === 200 && afterAccept.data.photos[0].status === "accepted", JSON.stringify(afterAccept.data));

  const secondExtend = await json("POST", `/api/sessions/${token}/extend`, {});
  const photosAfterExtend = await json("GET", `/api/sessions/${token}/photos`);
  check("extendSession moves photo expiry with the session",
    secondExtend.status === 200 && photosAfterExtend.data.photos[0].expiresAt === secondExtend.data.expiresAt,
    JSON.stringify({ photo: photosAfterExtend.data.photos[0]?.expiresAt, session: secondExtend.data.expiresAt }));

  const reject = await json("POST", `/api/photos/${photoId}/reject`, { token });
  const afterReject = await json("GET", `/api/sessions/${token}/photos`);
  check("rejectPhoto hides the photo", reject.status === 200 && afterReject.data.photos.length === 0, JSON.stringify(afterReject.data));

  const wrongToken = await json("POST", `/api/photos/${photoId}/accept`, { token: "Z".repeat(32) });
  check("photo action with wrong token rejected", wrongToken.status === 404, String(wrongToken.status));
}

console.log("Delete frees counters");
{
  const fresh = (await json("POST", "/api/sessions", { autoAccept: true })).data.token;
  const up = await fetch(`${BASE}/api/sessions/${fresh}/upload?fileName=libera.png&mimeType=image/png`, { method: "POST", body: png });
  const upData = await up.json();
  const del = await json("POST", `/api/photos/${upData.id}/delete`, { token: fresh });
  const session = await json("GET", `/api/sessions/${fresh}`);
  check("deletePhoto frees the byte counter", del.status === 200 && session.data.totalBytesUploaded === 0 && session.data.fileCount === 0, JSON.stringify(session.data));
}

console.log("Photo count limit (20)");
{
  const limitSession = (await json("POST", "/api/sessions", { autoAccept: true })).data.token;
  let accepted = 0;
  let limitCode = null;
  for (let i = 0; i < 21; i++) {
    const res = await fetch(`${BASE}/api/sessions/${limitSession}/upload?fileName=p${i}.png&mimeType=image/png`, {
      method: "POST",
      body: png,
    });
    if (res.status === 200) accepted++;
    else limitCode = (await res.json()).code;
  }
  check("20 photos accepted, 21st rejected", accepted === 20 && limitCode === "LIMIT_PHOTO_COUNT", `accepted ${accepted} code ${limitCode}`);
}

console.log("Session extension & close");
{
  const before = (await json("GET", `/api/sessions/${token}`)).data.expiresAt;
  const extended = await json("POST", `/api/sessions/${token}/extend`, {});
  check("extendSession adds 15 minutes", extended.data.extendedByMs === 15 * 60 * 1000 && extended.data.expiresAt - before >= 15 * 60 * 1000 - 5000, JSON.stringify(extended.data));

  const unknownExtend = await json("POST", `/api/sessions/${"Y".repeat(32)}/extend`, {});
  check("extendSession rejects unknown token", unknownExtend.status === 404 && unknownExtend.data?.code === "SESSION_NOT_FOUND", JSON.stringify(unknownExtend.data));

  const closed = await json("POST", `/api/sessions/${token}/close`, {});
  check("closeSession reports ok", closed.status === 200 && closed.data.ok === true, JSON.stringify(closed.data));

  const sessionAfterClose = await json("GET", `/api/sessions/${token}`);
  check("closed session reports closed", sessionAfterClose.status === 200 && sessionAfterClose.data.status === "closed", JSON.stringify(sessionAfterClose.data));

  const photosAfterClose = await json("GET", `/api/sessions/${token}/photos`);
  check("closed session has no photos left", photosAfterClose.status === 200 && photosAfterClose.data.photos.length === 0, JSON.stringify(photosAfterClose.data));
}

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
