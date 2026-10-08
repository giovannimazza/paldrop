# Paldrop

Transfer photos from one phone to another with a QR code.
No number, no account, no contact.

Stack: **React + Vite + TypeScript** on the client, **Convex** for the
database, sessions, file storage and realtime updates.

## Web app or APK

For the classic online flow nothing needs to be installed: Paldrop runs in
the browser and the "app" is the URL you open on both phones. On the
receiving phone you can add it to the home screen (Safari → *Add to Home
Screen*); it opens full-screen on iOS thanks to the `apple-mobile-web-app-capable`
meta tag.

For the **offline mode** (see below) there is an installable APK, wrapped
with Capacitor: it hosts the backend itself and can start a local-only
hotspot, so the two phones transfer photos with no internet at all.
Download `Paldrop.apk` from the
[Releases](https://github.com/giovannimazza/paldrop/releases) page and allow
"install from unknown sources" for your file manager. The footer of the
installed app shows the exact build stamp.

## Flow

1. **Receiving phone** → `/receive` → “Generate QR code”.
   A temporary session is created with a random 32-character token
   (160 bits of entropy, readable base32 alphabet) and a 15-minute expiry.
   The QR points to `https://<domain>/r/<token>`; the same code is shown as
   text underneath for manual entry.
2. **Sending phone** scans the QR (or pastes the code on “Send photos” on the
   home page) and opens `/r/:token`: it selects or captures photos, previews
   them and uploads them with a progress bar.
3. Photos show up **in real time** on the receiving page: with *Automatic
   acceptance* they appear immediately, with *Manual approval* they land in
   “To approve” with Accept / Reject buttons.
4. The receiver can **Download** (saved to the gallery) and **Delete** every
   photo, and can **Close session**: all files are removed from storage at
   that moment.

## Limits and security

- Session: 15 minutes, max **20 photos** and **100 MB** in total (25 MB per file).
- Allowed types: `image/jpeg`, `image/png`, `image/webp`, `image/heic`.
- Server-side validation on every action: token, session state and expiry are
  checked, and the photo count / byte totals are enforced atomically.
- The bytes are **inspected** (magic numbers) inside the upload action: a
  non-image file or a forged MIME type is rejected even if the declared
  metadata looks fine.
- Tokens cannot be enumerated, no function ever lists sessions, and photos
  are only reachable with the session token.
- `cleanupExpiredSessions` runs **every minute** from a Convex cron job: it
  deletes expired sessions, their photos and the storage blobs, then purges
  the leftover records.

## Offline mode (no internet)

The APK can host the backend itself, for when there is no mobile data or
Wi-Fi uplink:

1. On the receiving phone open **Ricevi foto** and tap **Avvia server offline**.
2. The phone starts a local HTTP server (Java, port `8787`) that serves both
   the web app and a REST API mirroring the Convex one (sessions, uploads,
   accept/reject/delete, extend, close, expiry).
3. The QR code then points at `http://<phone-ip>:8787/r/<token>`: the sending
   phone scans it and runs the very same app served by the local server —
   no app install and no internet required, just both phones on the same
   network (same Wi-Fi, or the receiver's hotspot).

Relevant pieces:

- `android/.../local/LocalHttpServer.java` — pure Java backend (no Android
  imports, so it is smoke-tested on a desktop JVM).
- `android/.../LocalServerPlugin.java` — Capacitor plugin (`PaldropLocal`:
  start/stop/status + LAN IP lookup).
- `src/lib/backend.ts` — dual backend layer: realtime Convex hooks in cloud
  mode, one-second REST polling in local mode; operations branch per call.
- The WebView uses `androidScheme: http` so the APK origin can reach the
  plain-HTTP local server, and the manifest declares `usesCleartextTraffic`
  plus `<queries>` for `ACTION_IMAGE_CAPTURE`.

## Structure

```
convex/
  schema.ts     # sessions and photos tables (with indexes)
  lib.ts        # constants, tokens, validation, sniffing, cleanup helpers
  sessions.ts   # createSession, getSessionByToken, closeSession, cleanup
  photos.ts     # generateUploadUrl, uploadPhoto, listPhotos, accept/reject/delete
  crons.ts      # cleanup every minute
src/
  pages/        # Home, Receive, Send, Expired, Privacy, Terms
  components/   # Layout, Logo, OtaBanner, ErrorBoundary
  i18n.tsx      # IT/EN dictionary with browser-language detection
  lib/client.ts # codes, upload with progress, download, formatting
  lib/backend.ts # cloud/offline dual backend (mode detection, ops, polling)
  lib/ota.ts    # OTA manifest check, bundle download, user-triggered swap
android/.../local/LocalHttpServer.java  # offline backend served by the APK
scripts/
  smoke.mjs           # cloud server-side verification suite (32 checks)
  smoke-local.mjs     # offline backend suite (33 checks)
  build-apk.mjs       # web build + cap sync + APK -> Paldrop.apk
  build-ota-bundle.mjs # OTA bundle zip + manifest -> ota/
  lib/zip.mjs         # dependency-free ZIP writer
  lib/version.mjs     # 1.<yymmdd>.<hhmm> bundle version
  upload-photo.mjs    # simulates the sending phone
  make-test-image.mjs # generates a test PNG
```

## Local development

```bash
npm install
npx convex dev      # local deployment, no account required: writes .env.local
npm run dev         # http://localhost:5173
```

`npx convex dev` downloads the local backend and stores `VITE_CONVEX_URL` in
`.env.local`; if it is missing, the app shows a setup page.

> The local backend only listens on `127.0.0.1:3210`, so two physical phones
> need a deployed backend (see below) or a tunnel.

## Verification

```bash
npm run typecheck                       # tsc over src + convex
npm run build                           # typecheck + production bundle
node scripts/make-test-image.mjs        # test PNG
node scripts/smoke.mjs                  # 32 cloud checks (Convex)
node scripts/upload-photo.mjs <token> scripts/test-photo.png

# Offline backend (pure Java): compile, run, then test
javac -d .tmp/localserver/out \
  android/app/src/main/java/com/giovannimazza/paldrop/local/LocalHttpServer.java \
  scripts/local-server/LocalServerMain.java
java -cp .tmp/localserver/out LocalServerMain dist .tmp/localserver/data 8787
node scripts/smoke-local.mjs            # 33 offline checks
```

## Deploy

Backend (production):

```bash
npx convex deployment token create paldrop-prod --deployment prod --save-env .env.production.local
npx convex deploy --env-file .env.production.local
```

`.env.production` (committed) holds only the public `VITE_CONVEX_URL`, so
`npm run build` bakes the production backend URL into the client, while the
deploy key stays in the git-ignored `.env.production.local` (deploy keys are
never bundled: only `VITE_*` variables reach the browser). Current production
backend: `https://spotted-manatee-851.convex.cloud`.

Frontend: `.github/workflows/pages.yml` builds and publishes `dist/` to GitHub
Pages on every push to `main` (enable **Settings → Pages → Source: GitHub
Actions** once). Local check: `npm run build && npm run preview`.

## Android APK

Prebuilt APKs are attached to every
[release](https://github.com/giovannimazza/paldrop/releases). To rebuild one
locally (Android SDK + JDK 21, e.g. `ANDROID_HOME` / `JAVA_HOME`, with a
fallback to `.android-sdk/` and `.tools/jdk21/`):

```bash
node scripts/build-apk.mjs   # npm run build + cap sync + assembleDebug
# -> Paldrop.apk copied to the project root
```

Scanning still happens with the phone camera: in cloud mode it opens the
hosted send page (so the frontend must be deployed), while in offline mode
the QR points at the receiving phone's local server.

## OTA updates

The installed APK updates its web layer over the air, so a typo fix or a new
screen reaches phones without anyone reinstalling anything. Native changes —
a new plugin, a permission, the launcher icon — still need a fresh APK.

How it works:

- Every push to `main` builds a second copy of the web app with the APK's
  settings and publishes two files at the site root:
  `ota.json` (the manifest) and `paldrop-<version>.zip` (the bundle).
- The version is `1.<yymmdd>.<hhmm>` in UTC, baked into both the APK and each
  bundle. An APK only ever picks up bundles published after it was built.
- On launch, and whenever it comes back to the foreground (at most twice an
  hour), the app reads the manifest. If it names a newer version it downloads
  the zip in the background and shows a bar above the footer.
- The swap happens only when the user taps it. Reloading the WebView in the
  middle of a transfer would lose the photos in flight, so it is never
  automatic.
- The bundle has to sit on the same origin as the manifest and be served over
  https, so a tampered manifest still cannot point the app elsewhere.

To build the pair by hand:

```bash
npm run ota:bundle                     # -> ota/ota.json + ota/paldrop-<version>.zip
PALDROP_OTA_SKIP_BUILD=1 npm run ota:bundle   # repack the existing dist/
```

The plugin is [`@capgo/capacitor-updater`](https://capgo.app/docs/plugin/self-hosted/getting-started)
in manual mode: no Capgo account and no server of our own, just two static
files on GitHub Pages. The trade-off is that the self-hosted path has no
automatic rollback — if a bundle boots badly, the fix is to publish a newer
one, or reinstall the APK (which resets to the bundle it ships with).

## Pages

| Route       | Content                                                             |
| ----------- | ------------------------------------------------------------------- |
| `/`         | Logo, “Receive photos”, “Send photos”, manual session-code entry      |
| `/receive`  | Big QR, session code, status, realtime photos, close session          |
| `/r/:token` | Sender page: select/capture, preview, upload with progress            |
| `/expired`  | “This session has expired or is no longer available.”                 |
| `/privacy`  | Privacy policy                                                        |
| `/terms`    | Terms of use                                                          |

## Languages

Italian is the default; English is selected automatically from the browser
language, and both can be switched at any time from the header.
