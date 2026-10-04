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
  getLocalHotspot,
  isLoopbackBase,
  isNativeApp,
  localServerUrl,
  refreshBackendMode,
  rejectPhoto,
  sessionUrl,
  startLocalHotspot,
  startLocalServer,
  stopLocalHotspot,
  stopLocalServer,
  useBackendMode,
  usePhotosInfo,
  useSessionInfo,
  type HotspotState,
  type PhotoInfo,
} from "../lib/backend";

const TOKEN_KEY = "paldrop.receive.token";
const MODE_KEY = "paldrop.receive.mode";

type Mode = "auto" | "manual";

type Photo = PhotoInfo;type PhotoCardProps = {
  photo: Photo;
  lang: "it" | "en";
  saving?: boolean;
  saved?: boolean;
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
    saving: string;
    savedBadge: string;
  };
};

function PhotoCard({
  photo,
  lang,
  saving = false,
  saved = false,
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
        {saving && (
          <span className="photo-saving" role="status" aria-label={labels.saving}>
            <span className="spinner" aria-hidden="true" />
          </span>
        )}
        {saved && !saving && (
          <span className="photo-saved-check" role="img" aria-label={labels.savedBadge}>
            ✓
          </span>
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
        ) : (
          <button
            type="button"
            className="btn btn-small btn-primary"
            onClick={onDownload}
            disabled={!onDownload || saving}
          >
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

/** Renders a payload as a QR data URL (null payload clears the image). */
function useQrDataUrl(payload: string | null, width: number): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!payload) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(payload, {
      margin: 2,
      width,
      errorCorrectionLevel: "M",
      color: { dark: "#0b1220", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [payload, width]);
  return dataUrl;
}

/** Escapes a string for the WIFI: QR payload format. */
function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
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
  const [hotspot, setHotspot] = useState<HotspotState | null>(null);
  const [hotspotBusy, setHotspotBusy] = useState(false);
  const [hotspotError, setHotspotError] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});

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

  // A new session resets the per-photo save state.
  useEffect(() => {
    setSavingIds({});
    setSavedIds({});
  }, [token]);

  // The hotspot's AP interface may get its IP address a little later than
  // the "started" callback: while the advertised address is still this
  // device itself, keep re-detecting so the QR self-corrects.
  const addressPending = Boolean(hotspot) && isLoopbackBase(backend);
  useEffect(() => {
    if (!addressPending) return;
    const id = window.setInterval(() => {
      void refreshBackendMode().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(id);
  }, [addressPending]);

  // On Android, reflect a hotspot that is already running (it survives
  // WebView reloads) and adopt its URL as the local backend address.
  useEffect(() => {
    if (!isNativeApp()) return;
    let live = true;
    void getLocalHotspot().then((info) => {
      if (!live) return;
      if (info) {
        setHotspot(info);
        void refreshBackendMode();
      }
    });
    return () => {
      live = false;
    };
  }, []);

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

  const handleDownload = useCallback(
    async (photo: Photo) => {
      if (!photo.url || savingIds[photo.id]) return;
      setErrorCode(null);
      setDownloadNote(null);
      setSavingIds((prev) => ({ ...prev, [photo.id]: true }));
      try {
        const outcome = await downloadFile(
          photo.url,
          ensureExtension(photo.fileName, photo.mimeType),
          photo.mimeType
        );
        // Loader becomes the green check in the photo's top-right corner.
        setSavedIds((prev) => ({ ...prev, [photo.id]: true }));
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
      } finally {
        setSavingIds((prev) => {
          const next = { ...prev };
          delete next[photo.id];
          return next;
        });
      }
    },
    [savingIds, t]
  );

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

  const handleStartHotspot = useCallback(async () => {
    setHotspotBusy(true);
    setHotspotError(null);
    try {
      // Hotspot first: the server then reads its address on the freshly
      // created AP network instead of a stale/loopback one.
      const info = await startLocalHotspot();
      setHotspot(info);
      if (backend?.kind !== "local") await startLocalServer();
      // The phone's IP changes with the hotspot: re-read the server URL so
      // the session QR points at an address the sender can actually reach.
      await refreshBackendMode();
    } catch (error) {
      const code = errorCodeOf(error);
      setHotspotError(code);
    } finally {
      setHotspotBusy(false);
    }
  }, [backend]);

  const handleStopHotspot = useCallback(async () => {
    setHotspotBusy(true);
    setHotspotError(null);
    try {
      await stopLocalHotspot();
      setHotspot(null);
      await refreshBackendMode();
    } catch {
      setHotspotError("HOTSPOT_FAILED");
    } finally {
      setHotspotBusy(false);
    }
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
    saving: t("photo.saving"),
    savedBadge: t("photo.savedBadge"),
  };

  // QR codes for the hotspot flow: first join the phone's Wi-Fi network,
  // then open Paldrop through the local server.
  const hotspotWifiPayload = hotspot
    ? `WIFI:T:WPA;S:${escapeWifi(hotspot.ssid)};P:${escapeWifi(hotspot.passphrase)};;`
    : null;
  const hotspotAppPayload = hotspot
    ? backend?.kind === "local"
      ? token
        ? sessionUrl(backend, token)
        : localServerUrl(backend)
      : null
    : null;
  const hotspotWifiQr = useQrDataUrl(hotspotWifiPayload, 320);
  const hotspotAppQr = useQrDataUrl(hotspotAppPayload, 320);

  const hotspotErrorLabel = hotspotError
    ? hotspotError === "HOTSPOT_UNSUPPORTED"
      ? t("server.hotspotUnsupported")
      : hotspotError === "PERMISSION_DENIED"
        ? t("server.hotspotPermission")
        : t("server.hotspotFailed")
    : null;

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

          <div className="hotspot-block">
            <p className="panel-title">{t("server.hotspotTitle")}</p>
            <p className="hint-text small">{t("server.hotspotHint")}</p>
            {hotspotErrorLabel && (
              <div className="banner banner-warn" role="alert">
                {hotspotErrorLabel}
              </div>
            )}
            {hotspot ? (
              <>
                <div className="hotspot-meta">
                  <span className="meta-chip">
                    {t("server.hotspotNetwork")} <strong>{hotspot.ssid}</strong>
                  </span>
                  <span className="meta-chip">
                    {t("server.hotspotPassword")} <strong>{hotspot.passphrase}</strong>
                  </span>
                </div>
                <div className="hotspot-qrs">
                  {hotspotWifiQr && (
                    <figure className="hotspot-qr">
                      <img src={hotspotWifiQr} alt={t("server.hotspotStep1")} />
                      <figcaption>{t("server.hotspotStep1")}</figcaption>
                    </figure>
                  )}
                  {hotspotAppQr && !addressPending ? (
                    <figure className="hotspot-qr">
                      <img src={hotspotAppQr} alt={t("server.hotspotStep2")} />
                      <figcaption>{t("server.hotspotStep2")}</figcaption>
                    </figure>
                  ) : (
                    <p className="hint-text small">{t("server.hotspotNoAddress")}</p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={handleStopHotspot}
                  disabled={hotspotBusy}
                >
                  {hotspotBusy ? t("common.loading") : t("server.hotspotStop")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={handleStartHotspot}
                disabled={hotspotBusy || !backend}
              >
                {hotspotBusy ? t("common.loading") : t("server.hotspotStart")}
              </button>
            )}
          </div>
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
                        saving={!!savingIds[photo.id]}
                        saved={!!savedIds[photo.id]}
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
