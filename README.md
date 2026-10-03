# Paldrop

Transfer photos from one phone to another with a QR code.
No number, no account, no contact.

Stack: **React + Vite + TypeScript** on the client, **Convex** for the
database, sessions, file storage and realtime updates.

## No APK: Paldrop is a web app

Paldrop runs in the browser, so there is nothing to install and no `.apk`
is produced — the "app" is the URL you open on both phones. On the receiving
phone you can add it to the home screen (Safari → *Add to Home Screen*); it
opens full-screen on iOS thanks to the `apple-mobile-web-app-capable` meta
tag. A real APK would require wrapping the app with Capacitor or a Trusted
Web Activity, which is a separate build step.

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
  components/   # Layout, Logo, ErrorBoundary
  i18n.tsx      # IT/EN dictionary with browser-language detection
  lib/client.ts # codes, upload with progress, download, formatting
scripts/
  smoke.mjs           # server-side verification suite (28 checks)
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
node scripts/smoke.mjs                  # 28 server-side checks
node scripts/upload-photo.mjs <token> scripts/test-photo.png
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

The web app is wrapped with Capacitor, so an installable APK can be built
locally (Android SDK + JDK 21 required):

```bash
npx cap sync android
cd android
./gradlew assembleDebug          # or gradlew.bat on Windows
# android/app/build/outputs/apk/debug/app-debug.apk
```

Install it on the phone by copying the file and allowing "install from
unknown sources" for your file manager. Scanning still happens with the phone
camera: it opens the hosted send page, so the frontend must be deployed.

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
