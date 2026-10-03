import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const it = {
  "app.tagline": "Nessun numero, nessun account, nessun contatto.",
  "nav.privacy": "Privacy",
  "nav.terms": "Termini d’uso",
  "nav.theme": "Cambia tema",

  "home.receive": "Ricevi foto",
  "home.receiveHint": "Crea un QR code e fai scansionare dall’altro telefono.",
  "home.send": "Invia foto",
  "home.sendHint": "Scansiona il QR oppure inserisci il codice sessione.",
  "home.manualTitle": "Hai un codice sessione?",
  "home.manualPlaceholder": "Codice sessione (32 caratteri)",
  "home.manualOpen": "Apri sessione",
  "home.manualError": "Codice non valido. Controllalo e riprova.",
  "home.manualHelp":
    "Chiedi al telefono destinazione di mostrare il codice sotto il QR code.",

  "receive.title": "Ricevi foto",
  "receive.subtitle": "Mostra questo QR code al telefono che invia le foto.",
  "receive.generate": "Genera QR code",
  "receive.regenerate": "Nuovo QR code",
  "receive.generating": "Creazione sessione…",
  "receive.modeTitle": "Come vuoi ricevere le foto?",
  "receive.modeAuto": "Automatica",
  "receive.modeAutoHint": "Le foto appaiono subito",
  "receive.modeManual": "Manuale",
  "receive.modeManualHint": "Approvi ogni foto",
  "receive.codeLabel": "Codice sessione",
  "receive.codeHelp":
    "Non riesci a scansionare? Su un altro telefono apri Paldrop, premi “Invia foto” e inserisci questo codice.",
  "receive.expiresIn": "Scade tra",
  "receive.extend": "Estendi di 15 minuti",
  "receive.extendDone": "Sessione estesa di 15 minuti.",
  "receive.expiredNote": "Sessione scaduta: le foto sono state eliminate.",
  "receive.closedNote": "Sessione chiusa: le foto sono state eliminate.",
  "receive.stats": "{files} foto · {size}",
  "receive.statsOne": "1 foto · {size}",
  "receive.photosTitle": "Foto ricevute",
  "receive.empty": "In attesa delle foto…",
  "receive.emptyHint": "Le foto appariranno qui in tempo reale.",
  "receive.pendingTitle": "Da approvare",
  "receive.close": "Chiudi sessione",
  "receive.closeConfirm": "Conferma chiusura",
  "receive.closeCancel": "Annulla",
  "receive.closeWarning": "Le foto verranno eliminate definitivamente.",
  "receive.newSession": "Crea nuova sessione",

  "status.active": "Attiva",
  "status.waiting": "In attesa",
  "status.expired": "Scaduta",
  "status.closed": "Chiusa",

  "photo.download": "Scarica",
  "photo.delete": "Elimina",
  "photo.deleteConfirm": "Eliminare questa foto?",
  "photo.accept": "Accetta",
  "photo.reject": "Rifiuta",
  "photo.pending": "In approvazione",

  "send.title": "Invia foto a questo telefono",
  "send.subtitle": "Nessun dato personale, nessun account.",
  "send.select": "Seleziona foto",
  "send.capture": "Scatta foto",
  "send.selected": "Foto selezionate",
  "send.empty": "Nessuna foto selezionata",
  "send.remove": "Rimuovi",
  "send.send": "Invia",
  "send.sending": "Invio in corso…",
  "send.progress": "Caricamento",
  "send.doneOne": "Foto inviata",
  "send.doneMany": "Foto inviate",
  "send.sendMore": "Invia altre foto",
  "send.limitHint": "Max 20 foto e 100 MB totali per sessione.",
  "send.waitApproval": "Il destinatario approverà ogni foto prima di vederla.",
  "send.sessionValidFor": "Sessione valida per altri",

  "expired.message": "Questa sessione è scaduta o non è più disponibile.",
  "expired.home": "Torna alla home",

  "errors.SESSION_NOT_FOUND": "Sessione inesistente.",
  "errors.SESSION_EXPIRED": "Sessione scaduta.",
  "errors.SESSION_CLOSED": "Sessione chiusa.",
  "errors.INVALID_TOKEN": "Codice sessione non valido.",
  "errors.PHOTO_NOT_FOUND": "Foto non trovata.",
  "errors.INVALID_FILE_TYPE": "Formato non supportato: usa JPEG, PNG, WebP o HEIC.",
  "errors.LIMIT_FILE_SIZE": "Foto troppo grande (max 25 MB ciascuna).",
  "errors.LIMIT_TOTAL_BYTES": "Limite di 100 MB raggiunto per questa sessione.",
  "errors.LIMIT_PHOTO_COUNT": "Limite di 20 foto raggiunto.",
  "errors.UPLOAD_INVALID": "Caricamento non riuscito. Riprova.",
  "errors.NETWORK": "Connessione assente. Riprova.",
  "errors.UNKNOWN": "Qualcosa è andato storto. Riprova.",

  "common.loading": "Caricamento…",
  "common.retry": "Riprova",

  "privacy.title": "Privacy",
  "privacy.intro":
    "Paldrop trasferisce foto tra due telefoni senza raccogliere dati personali.",
  "privacy.p1title": "Cosa raccogliamo",
  "privacy.p1":
    "Nessun account, nessun numero di telefono, nessuna email, nessun contatto. Le sessioni contengono solo un codice casuale e i file che scegli di inviare.",
  "privacy.p2title": "Quanto durano i dati",
  "privacy.p2":
    "Le sessioni scadono dopo 15 minuti. Alla scadenza, alla chiusura o quando elimini una foto, il file viene rimosso definitivamente dallo storage.",
  "privacy.p3title": "Chi può vedere le foto",
  "privacy.p3":
    "Solo chi possiede il link o il codice della sessione. I link non compaiono in elenchi pubblici e non sono indovinabili.",
  "privacy.p4title": "Cookie e tracciamento",
  "privacy.p4":
    "Non usiamo cookie di profilazione né strumenti di analytics di terze parti. In locale salviamo solo lingua, tema e la tua sessione di ricezione.",

  "terms.title": "Termini d’uso",
  "terms.intro": "Usando Paldrop accetti queste condizioni semplici.",
  "terms.p1title": "Uso del servizio",
  "terms.p1":
    "Paldrop è uno strumento gratuito per trasferire immagini tra dispositivi di tua proprietà o per i quali hai il permesso del proprietario.",
  "terms.p2title": "Limite di responsabilità",
  "terms.p2":
    "Il servizio viene fornito così com’è. Non siamo responsabili di perdite derivanti da sessioni condivise con persone non autorizzate.",
  "terms.p3title": "Contenuti",
  "terms.p3":
    "Resti responsabile delle foto che invii. È vietato distribuire contenuti illeciti o violare diritti di terzi.",
  "terms.p4title": "Sospensione",
  "terms.p4":
    "Possiamo limitare o interrompere sessioni anomale per proteggere il servizio.",

  "setup.title": "Configurazione richiesta",
  "setup.body":
    "Manca VITE_CONVEX_URL. Esegui `npx convex dev`, poi copia l’URL del deployment in .env.local.",
} as const;

export type TKey = keyof typeof it;

const en: Record<TKey, string> = {
  "app.tagline": "No number, no account, no contact.",
  "nav.privacy": "Privacy",
  "nav.terms": "Terms of use",
  "nav.theme": "Switch theme",

  "home.receive": "Receive photos",
  "home.receiveHint": "Create a QR code and let the other phone scan it.",
  "home.send": "Send photos",
  "home.sendHint": "Scan the QR code or enter the session code.",
  "home.manualTitle": "Have a session code?",
  "home.manualPlaceholder": "Session code (32 characters)",
  "home.manualOpen": "Open session",
  "home.manualError": "Invalid code. Check it and try again.",
  "home.manualHelp":
    "Ask the receiving phone to show the code under the QR code.",

  "receive.title": "Receive photos",
  "receive.subtitle": "Show this QR code to the phone sending the photos.",
  "receive.generate": "Generate QR code",
  "receive.regenerate": "New QR code",
  "receive.generating": "Creating session…",
  "receive.modeTitle": "How do you want to receive?",
  "receive.modeAuto": "Automatic",
  "receive.modeAutoHint": "Photos appear immediately",
  "receive.modeManual": "Manual",
  "receive.modeManualHint": "Approve every photo",
  "receive.codeLabel": "Session code",
  "receive.codeHelp":
    "Can’t scan? On the other phone open Paldrop, tap “Send photos” and enter this code.",
  "receive.expiresIn": "Expires in",
  "receive.extend": "Extend by 15 minutes",
  "receive.extendDone": "Session extended by 15 minutes.",
  "receive.expiredNote": "Session expired: photos have been deleted.",
  "receive.closedNote": "Session closed: photos have been deleted.",
  "receive.stats": "{files} photos · {size}",
  "receive.statsOne": "1 photo · {size}",
  "receive.photosTitle": "Received photos",
  "receive.empty": "Waiting for photos…",
  "receive.emptyHint": "Photos will appear here in real time.",
  "receive.pendingTitle": "To approve",
  "receive.close": "Close session",
  "receive.closeConfirm": "Confirm close",
  "receive.closeCancel": "Cancel",
  "receive.closeWarning": "Photos will be permanently deleted.",
  "receive.newSession": "Create new session",

  "status.active": "Active",
  "status.waiting": "Waiting",
  "status.expired": "Expired",
  "status.closed": "Closed",

  "photo.download": "Download",
  "photo.delete": "Delete",
  "photo.deleteConfirm": "Delete this photo?",
  "photo.accept": "Accept",
  "photo.reject": "Reject",
  "photo.pending": "Awaiting approval",

  "send.title": "Send photos to this phone",
  "send.subtitle": "No personal data, no account.",
  "send.select": "Choose photos",
  "send.capture": "Take photo",
  "send.selected": "Selected photos",
  "send.empty": "No photo selected",
  "send.remove": "Remove",
  "send.send": "Send",
  "send.sending": "Uploading…",
  "send.progress": "Upload",
  "send.doneOne": "Photo sent",
  "send.doneMany": "Photos sent",
  "send.sendMore": "Send more photos",
  "send.limitHint": "Up to 20 photos and 100 MB in total per session.",
  "send.waitApproval": "The receiver will approve each photo before seeing it.",
  "send.sessionValidFor": "Session valid for another",

  "expired.message": "This session has expired or is no longer available.",
  "expired.home": "Back to home",

  "errors.SESSION_NOT_FOUND": "Session not found.",
  "errors.SESSION_EXPIRED": "Session expired.",
  "errors.SESSION_CLOSED": "Session closed.",
  "errors.INVALID_TOKEN": "Invalid session code.",
  "errors.PHOTO_NOT_FOUND": "Photo not found.",
  "errors.INVALID_FILE_TYPE": "Unsupported format: use JPEG, PNG, WebP or HEIC.",
  "errors.LIMIT_FILE_SIZE": "Photo too large (max 25 MB each).",
  "errors.LIMIT_TOTAL_BYTES": "100 MB limit reached for this session.",
  "errors.LIMIT_PHOTO_COUNT": "20 photo limit reached.",
  "errors.UPLOAD_INVALID": "Upload failed. Try again.",
  "errors.NETWORK": "No connection. Try again.",
  "errors.UNKNOWN": "Something went wrong. Try again.",

  "common.loading": "Loading…",
  "common.retry": "Retry",

  "privacy.title": "Privacy",
  "privacy.intro":
    "Paldrop transfers photos between two phones without collecting personal data.",
  "privacy.p1title": "What we collect",
  "privacy.p1":
    "No account, no phone number, no email, no contacts. Sessions only contain a random code and the files you choose to send.",
  "privacy.p2title": "How long data lasts",
  "privacy.p2":
    "Sessions expire after 15 minutes. On expiry, on close, or when you delete a photo, the file is permanently removed from storage.",
  "privacy.p3title": "Who can see the photos",
  "privacy.p3":
    "Only whoever holds the session link or code. Links are never listed publicly and cannot be guessed.",
  "privacy.p4title": "Cookies and tracking",
  "privacy.p4":
    "We use no profiling cookies and no third-party analytics. Locally we only store your language, theme and receive session.",

  "terms.title": "Terms of use",
  "terms.intro": "By using Paldrop you accept these simple conditions.",
  "terms.p1title": "Use of the service",
  "terms.p1":
    "Paldrop is a free tool to transfer images between devices you own or for which you have the owner’s permission.",
  "terms.p2title": "Limitation of liability",
  "terms.p2":
    "The service is provided as is. We are not liable for losses arising from sessions shared with unauthorized people.",
  "terms.p3title": "Content",
  "terms.p3":
    "You remain responsible for the photos you send. Distributing illegal content or infringing third-party rights is forbidden.",
  "terms.p4title": "Suspension",
  "terms.p4":
    "We may limit or stop abnormal sessions to protect the service.",

  "setup.title": "Setup required",
  "setup.body":
    "VITE_CONVEX_URL is missing. Run `npx convex dev`, then copy the deployment URL into .env.local.",
};

const dict: Record<"it" | "en", Record<TKey, string>> = { it, en };

export type Lang = "it" | "en";
const STORAGE_KEY = "paldrop.lang";

/** Whether a translation key exists (used for dynamic error keys). */
export function hasKey(key: string): key is TKey {
  return Object.prototype.hasOwnProperty.call(it, key);
}

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "it" || stored === "en") return stored;
  } catch {
    // ignore
  }
  const nav = typeof navigator !== "undefined" ? navigator.language || "" : "";
  return nav.toLowerCase().startsWith("en") ? "en" : "it";
}

type I18nValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TKey) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      t: (key: TKey) => dict[lang][key] ?? dict.it[key] ?? key,
    }),
    [lang, setLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
