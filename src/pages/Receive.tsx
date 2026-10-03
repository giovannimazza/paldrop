import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { hasKey, useI18n, type TKey } from "../i18n";
import { StatusBadge } from "../components/Layout";
import {
  downloadFile,
  ensureExtension,
  errorCodeOf,
  formatBytes,
  formatCountdown,
} from "../lib/client";
import {
  acceptPhoto,
  closeSession,
  createSession,
  deletePhoto,
  extendSession,
  isNativeApp,
  localServerUrl,
  rejectPhoto,
  sessionUrl,
  startLocalServer,
  stopLocalServer,
  useBackendMode,
  usePhotosInfo,
  useSessionInfo,
  type PhotoInfo,
} from "../lib/backend";

const TOKEN_KEY = "paldrop.receive.token";
const MODE_KEY = "paldrop.receive.mode";

type Mode = "auto" | "manual";

type Photo = PhotoInfo;

type PhotoCardProps = {
  photo: Photo;
  lang: "it" | "en";
  onDownload?: () => void;
  onDelete: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  labels: {
    download: string;
    delete: string;
    accept: string;
    reject: string;
    pending: string;
  };
};

function PhotoCard({
  photo,
  lang,
  onDownload,
  onDelete,
  onAccept,
  onReject,
  labels,
}: PhotoCardProps) {
  if (!photo.url) return null;
  return (
    <figure className="photo-card">
      <div className="photo-frame">
        <img src={photo.url} alt={photo.fileName} loading="lazy" />
        {photo.status === "pending" && (
          <span className="photo-chip">{labels.pending}</span>
        )}
      </div>
      <figcaption className="photo-meta">
        <span className="photo-name" title={photo.fileName}>
          {photo.fileName}
        </span>
        <span className="photo-size">{formatBytes(photo.fileSize, lang)}</span>
      </figcaption>
      <div className="photo-actions">
        {photo.status === "pending" ? (
          <>
            <button type="button" className="btn btn-small btn-primary" onClick={onAccept}>
              {labels.accept}
            </button>
            <button type="button" className="btn btn-small btn-ghost" onClick={onReject}>
              {labels.reject}
            </button>
          </>
        ) : (            <button type="button" className="btn btn-small btn-primary" onClick={onDownload} disabled={!onDownload}>
            {labels.download}
          </button>
        )}
        <button type="button" className="btn btn-small btn-danger" onClick={onDelete}>
          {labels.delete}
        </button>
      </div>
    </figure>
  );
}

export function Receive() {
  const { t, lang } = useI18n();

  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === "manual" ? "manual" : "auto";
    } catch {
      return "auto";
    }
  });
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [extending, setExtending] = useState(false);
  const [extendedNote, setExtendedNote] = useState(false);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverError, setServerError] = useState(false);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  const errorBannerRef = useRef<HTMLDivElement>(null);

  const backend = useBackendMode();
  const session = useSessionInfo(backend, token);
  const photoData = usePhotosInfo(backend, token);

  // Tick every second for the countdown and lazy expiry.
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  // The stored token was purged (expired): start fresh.
  useEffect(() => {
    if (token && session === null) {
      setToken(null);
      setQrDataUrl(null);
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {
        // ignore
      }
    }
  }, [token, session]);

  // Render the QR code for the current session URL (local server URL when
  // the offline backend is active, the hosted app otherwise).
  useEffect(() => {
    if (!token) {
      setQrDataUrl(null);
      return;
    }
    if (!backend) return; // still probing: keep the previous QR
    let cancelled = false;
    QRCode.toDataURL(sessionUrl(backend, token), {
      margin: 4,
      width: 720,
      errorCorrectionLevel: "H",
      color: { dark: "#0b1220", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token, backend]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setErrorCode(null);
    try {
      const created = await createSession(backend, mode === "auto");
      try {
        localStorage.setItem(TOKEN_KEY, created.token);
        localStorage.setItem(MODE_KEY, mode);
      } catch {
        // ignore
      }
      setToken(created.token);
      setNow(Date.now());
    } catch (error) {
      setErrorCode(errorCodeOf(error));
    } finally {
      setCreating(false);
    }
  }, [backend, createSession, mode]);

  const handleClose = useCallback(async () => {
    if (!token) return;
    setErrorCode(null);
    try {
      await closeSession(backend, token);
      setConfirmClose(false);
      setNow(Date.now());
    } catch (error) {
      setErrorCode(errorCodeOf(error));
    }
  }, [backend, closeSession, token]);

  const handleExtend = useCallback(async () => {
    if (!token) return;
    setErrorCode(null);
    setExtending(true);
    try {
      await extendSession(backend, token);
      setNow(Date.now());
      setExtendedNote(true);
      window.setTimeout(() => setExtendedNote(false), 4000);
    } catch (error) {
      setErrorCode(errorCodeOf(error));
    } finally {
      setExtending(false);
    }
  }, [backend, extendSession, token]);

  const handleDownload = useCallback(async (photo: Photo) => {
    if (!photo.url) return;
    setErrorCode(null);
    setDownloadNote(null);
    try {
      const outcome = await downloadFile(
        photo.url,
        ensureExtension(photo.fileName, photo.mimeType),
        photo.mimeType
      );
      if (outcome !== "web") {
        // Native save confirmed: tell the user where the photo went.
        setDownloadNote(t("photo.saved"));
        window.setTimeout(() => setDownloadNote(null), 5000);
      }
    } catch (error) {
      // Surface why nothing was saved (denied permission, timeout, ...).
      const code = errorCodeOf(error);
      setErrorCode(code);
      // The banner sits above the photo grid: bring it into view so the
      // reason is never scrolled off-screen when the user taps "Scarica".
      window.requestAnimationFrame(() =>
        errorBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
      );
    }
  }, [t]);

  const handleStartServer = useCallback(async () => {
    setServerBusy(true);
    setServerError(false);
    setErrorCode(null);
    try {
      await startLocalServer();
      // A token from the cloud backend means nothing locally: start fresh.
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {
        // ignore
      }
      setToken(null);
      setQrDataUrl(null);
    } catch {
      setServerError(true);
    } finally {
      setServerBusy(false);
    }
  }, []);

  const handleStopServer = useCallback(async () => {
    setServerBusy(true);
    setServerError(false);
    try {
      await stopLocalServer();
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {
        // ignore
      }
      setToken(null);
      setQrDataUrl(null);
    } catch {
      setServerError(true);
    } finally {
      setServerBusy(false);
    }
  }, []);

  const handleNewSession = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
    setToken(null);
    setQrDataUrl(null);
    setConfirmClose(false);
  }, []);

  const runPhotoAction = useCallback(
    async (action: (photoId: string) => Promise<void>, photoId: string) => {
      setErrorCode(null);
      if (!token) return;
      try {
        await action(photoId);
      } catch (error) {
        setErrorCode(errorCodeOf(error));
      }
    },
    [token]
  );

  const photos = useMemo<Photo[]>(() => photoData?.photos ?? [], [photoData]);
  const pending = photos.filter((photo) => photo.status === "pending");
  const accepted = photos.filter((photo) => photo.status === "accepted");

  const status = session
    ? session.status === "active"
      ? photos.length > 0
        ? "active"
        : "waiting"
      : session.status
    : null;

  const remaining = session ? Math.max(0, session.expiresAt - now) : 0;
  const totalBytes = photos.reduce((sum, photo) => sum + photo.fileSize, 0);
  const stats = (photos.length === 1 ? t("receive.statsOne") : t("receive.stats"))
    .replace("{files}", String(photos.length))
    .replace("{size}", formatBytes(totalBytes, lang));

  const labels = {
    download: t("photo.download"),
    delete: t("photo.delete"),
    accept: t("photo.accept"),
    reject: t("photo.reject"),
    pending: t("photo.pending"),
  };

  return (
    <section className="page receive-page">
      <div className="page-head">
        <h1 className="page-title">{t("receive.title")}</h1>
        {status && <StatusBadge status={status} />}
      </div>

      {errorCode && (
        <div className="banner banner-error" role="alert" ref={errorBannerRef}>
          {hasKey(`errors.${errorCode}`)
            ? t(`errors.${errorCode}` as TKey)
            : t("errors.UNKNOWN")}
        </div>
      )}

      {serverError && (
        <div className="banner banner-error" role="alert">
          {t("server.startFailed")}
        </div>
      )}

      {isNativeApp() && (
        <div className="panel server-panel">
          <p className="panel-title">{t("server.title")}</p>
          {backend?.kind === "local" ? (
            <>
              <p className="hint-text small">
                {t("server.running")} <code>{localServerUrl(backend)}</code>
              </p>
              <p className="hint-text small">{t("server.qrHint")}</p>
              <button
                type="button"
                className="btn btn-ghost btn-block"
                onClick={handleStopServer}
                disabled={serverBusy}
              >
                {serverBusy ? t("common.loading") : t("server.stop")}
              </button>
            </>
          ) : (
            <>
              <p className="hint-text small">{t("server.hint")}</p>
              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={handleStartServer}
                disabled={serverBusy || !backend}
              >
                {serverBusy ? t("server.starting") : t("server.start")}
              </button>
            </>
          )}
        </div>
      )}

      {!token || !session ? (
        <>
          <div className="panel mode-panel">
            <p className="panel-title">{t("receive.modeTitle")}</p>
            <div className="segmented" role="radiogroup" aria-label={t("receive.modeTitle")}>
              <button
                type="button"
                role="radio"
                aria-checked={mode === "auto"}
                className={`segment ${mode === "auto" ? "segment-on" : ""}`}
                onClick={() => setMode("auto")}
              >
                <strong>{t("receive.modeAuto")}</strong>
                <small>{t("receive.modeAutoHint")}</small>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === "manual"}
                className={`segment ${mode === "manual" ? "segment-on" : ""}`}
                onClick={() => setMode("manual")}
              >
                <strong>{t("receive.modeManual")}</strong>
                <small>{t("receive.modeManualHint")}</small>
              </button>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={handleCreate}
            disabled={creating || (token !== null && session === undefined)}
          >
            {creating ? t("receive.generating") : t("receive.generate")}
          </button>

          {session === undefined && token && (
            <p className="hint-text">{t("common.loading")}</p>
          )}
        </>
      ) : (
        <>
          <div className="qr-card">
            {qrDataUrl ? (
              <img className="qr-image" src={qrDataUrl} alt={t("receive.codeLabel")} />
            ) : (
              <div className="qr-placeholder">{t("common.loading")}</div>
            )}
          </div>
          <p className="qr-help">{t("receive.subtitle")}</p>

          <div className="panel code-panel">
            <p className="panel-label">{t("receive.codeLabel")}</p>
            <code className="session-code">{token}</code>
            <p className="hint-text small">{t("receive.codeHelp")}</p>
          </div>

          <div className="session-meta">
            {session.status === "active" && (
              <span className="meta-chip">
                {t("receive.expiresIn")} <strong>{formatCountdown(remaining)}</strong>
              </span>
            )}
            <span className="meta-chip">{stats}</span>
            <span className="meta-chip">
              {session.autoAccept ? t("receive.modeAuto") : t("receive.modeManual")}
            </span>
            {backend?.kind === "local" && (
              <span className="meta-chip">{t("server.localChip")}</span>
            )}
          </div>

          {session.status === "active" && (
            <div className="stack-actions">
              <button
                type="button"
                className="btn btn-ghost btn-lg btn-block"
                onClick={handleExtend}
                disabled={extending}
              >
                {extending ? t("common.loading") : t("receive.extend")}
              </button>
              {extendedNote && (
                <p className="hint-text small success-text">{t("receive.extendDone")}</p>
              )}
            </div>
          )}

          {session.status === "expired" && (
            <div className="banner banner-warn" role="status">
              {t("receive.expiredNote")}
            </div>
          )}
          {session.status === "closed" && (
            <div className="banner banner-warn" role="status">
              {t("receive.closedNote")}
            </div>
          )}

          {session.status === "active" && (
            <>
              {pending.length > 0 && (
                <section className="photo-section">
                  <h2 className="section-title">{t("receive.pendingTitle")}</h2>
                  <div className="photo-grid">
                    {pending.map((photo) => (
                      <PhotoCard
                        key={photo.id}
                        photo={photo}
                        lang={lang}
                        labels={labels}
                        onAccept={() =>
                          runPhotoAction((photoId) => acceptPhoto(backend, token, photoId), photo.id)
                        }
                        onReject={() =>
                          runPhotoAction((photoId) => rejectPhoto(backend, token, photoId), photo.id)
                        }
                        onDelete={() =>
                          runPhotoAction((photoId) => deletePhoto(backend, token, photoId), photo.id)
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              <section className="photo-section">
                <h2 className="section-title">{t("receive.photosTitle")}</h2>
                {accepted.length === 0 ? (
                  <div className="panel empty-panel">
                    <p className="panel-title">{t("receive.empty")}</p>
                    <p className="panel-text muted">{t("receive.emptyHint")}</p>
                  </div>
                ) : (
                  <div className="photo-grid">
                    {accepted.map((photo) => (
                      <PhotoCard
                        key={photo.id}
                        photo={photo}
                        lang={lang}
                        labels={labels}
                        onDownload={() => handleDownload(photo)}
                        onDelete={() =>
                          runPhotoAction((photoId) => deletePhoto(backend, token, photoId), photo.id)
                        }
                      />
                    ))}
                  </div>
                )}
              </section>

              <div className="stack-actions">
                {confirmClose ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-danger btn-lg btn-block"
                      onClick={handleClose}
                    >
                      {t("receive.closeConfirm")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-block"
                      onClick={() => setConfirmClose(false)}
                    >
                      {t("receive.closeCancel")}
                    </button>
                    <p className="hint-text small danger-text">{t("receive.closeWarning")}</p>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-danger-outline btn-lg btn-block"
                    onClick={() => setConfirmClose(true)}
                  >
                    {t("receive.close")}
                  </button>
                )}
              </div>
            </>
          )}

          {session.status !== "active" && (
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              onClick={handleNewSession}
            >
              {t("receive.newSession")}
            </button>
          )}
        </>
      )}

      {downloadNote && (
        <div className="toast toast-success" role="status">
          {downloadNote}
        </div>
      )}
    </section>
  );
}
