# Paldrop

Trasferimento foto da un telefono all'altro tramite QR code.
Nessun numero, nessun account, nessun contatto.

Stack: **React + Vite + TypeScript** lato client, **Convex** per database,
sessioni, file storage e realtime.

## Flusso

1. **Telefono destinazione** → `/receive` → “Genera QR code”.
   Viene creata una sessione temporanea con token casuale di 32 caratteri
   (160 bit di entropia, alfabeto base32 leggibile) e scadenza a 15 minuti.
   Il QR punta a `https://<dominio>/r/<token>`; sotto il QR viene mostrato il
   codice testuale per l'inserimento manuale.
2. **Telefono mittente** scansiona il QR (oppure incolla il codice su
   “Invia foto” nella home) e apre `/r/:token`: seleziona o scatta foto,
   le anteprima e le invia con barra di avanzamento.
3. Le foto arrivano **in tempo reale** sulla pagina di ricezione:
   in “Accettazione automatica” compaiono subito, in “Approvazione manuale”
   finiscono in “Da approvare” con i pulsanti Accetta / Rifiuta.
4. Il destinazione può **Scaricare** (download nella galleria) ed **Eliminare**
   ogni foto, e può **Chiudi sessione**: tutti i file vengono cancellati dallo
   storage in quel momento.

## Limiti e sicurezza

- Sessione: 15 minuti, max **20 foto** e **100 MB** totali (25 MB per file).
- Tipi ammessi: `image/jpeg`, `image/png`, `image/webp`, `image/heic`.
- Validazione lato server su ogni azione: controllo token, stato ed expiring
  della sessione, controlli atomici su conteggio e byte totali.
- I byte vengono **ispezionati** (magic bytes) nell'azione di upload: un file
  non immagine o con MIME dichiarato falso viene rifiutato anche se supera i
  controlli dichiarati.
- I token non sono enumerabili, non esiste nessuna funzione che elenchi le
  sessioni, e le foto sono raggiungibili solo dal token della sessione.
- `cleanupExpiredSessions` viene eseguito **ogni minuto** da un cron Convex:
  elimina sessioni scadute, foto e file dallo storage, poi ripulisce i record.

## Struttura

```
convex/
  schema.ts     # tabelle sessions e photos (con indici)
  lib.ts        # costanti, token, validazione, sniffing, cleanup helper
  sessions.ts   # createSession, getSessionByToken, closeSession, cleanup
  photos.ts     # generateUploadUrl, uploadPhoto, listPhotos, accept/reject/delete
  crons.ts      # cleanup ogni minuto
src/
  pages/        # Home, Receive, Send, Expired, Privacy, Terms
  components/   # Layout, Logo, ErrorBoundary
  i18n.tsx      # dizionario IT/EN con rilevamento lingua browser
  lib/client.ts # codici, upload con progresso, download, formattazione
scripts/
  smoke.mjs           # suite di verifica lato server (28 controlli)
  upload-photo.mjs    # simula il telefono mittente
  make-test-image.mjs # genera un PNG di prova
```

## Sviluppo locale

```bash
npm install
npx convex dev      # deployment locale, senza account: scrive .env.local
npm run dev         # http://localhost:5173
```

`npx convex dev` scarica il backend locale e salva `VITE_CONVEX_URL` in
`.env.local`; se manca, la app mostra una pagina di configurazione.

## Verifica

```bash
npm run typecheck                       # tsc su src + convex
npm run build                           # typecheck + bundle di produzione
node scripts/make-test-image.mjs        # PNG di prova
node scripts/smoke.mjs                  #28 controlli server-side
node scripts/upload-photo.mjs <token> scripts/test-photo.png
```

## Deploy

Il progetto è deployabile direttamente da Freebuff (frontend + Convex):
`npx convex deploy` pubblica schema, funzioni e cron, mentre il frontend usa
`VITE_CONVEX_URL`. In alternativa:

```bash
npx convex deploy          # backend
npm run build && npm run preview   # frontend
```

## Pagine

| Rotta       | Contenuto                                                     |
| ----------- | ------------------------------------------------------------- |
| `/`         | Logo, “Ricevi foto”, “Invia foto”, inserimento codice manuale   |
| `/receive`  | QR grande, codice sessione, stato, foto realtime, chiudi sessione |
| `/r/:token` | Pagina mittente: seleziona/scatta, anteprima, invio con progresso |
| `/expired`  | “Questa sessione è scaduta o non è più disponibile.”            |
| `/privacy`  | Informativa privacy                                           |
| `/terms`    | Termini d’uso                                                  |
