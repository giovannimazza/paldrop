import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { hasKey, useI18n, type TKey } from "../i18n";
import { StatusBadge } from "../components/Layout";
import {
  absoluteSessionUrl,
  appBaseUrl,
  downloadFile,
  ensureExtension,
  errorCodeOf,
  formatBytes,
  formatCountdown,
} from "../lib/client";

const TOKEN_KEY = "paldrop.receive.token";
const MODE_KEY = "paldrop.receive.mode";

type Mode = "auto" | "manual";

type Photo = {
  id: Id<"photos">;
  fileName: string;
  mimeType: string;
  fileSize: number;
  status: "pending" | "accepted" | "rejected";
  uploadedAt: number;
  url: string | null;
};

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

  const session = useQuery(
    api.sessions.getSessionByToken,
    token ? { token } : "skip"
  );
  const photoData = useQuery(api.photos.listPhotos, token ? { token } : "skip");

  const createSession = useMutation(api.sessions.createSession);
  const closeSession = useMutation(api.sessions.closeSession);
  const acceptPhoto = useMutation(api.photos.acceptPhoto);
  const rejectPhoto = useMutation(api.photos.rejectPhoto);
  const deletePhoto = useMutation(api.photos.deletePhoto);

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

  // Render the QR code for the current session URL.
  useEffect(() => {
    if (!token) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(absoluteSessionUrl(token), {
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
  }, [token]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setErrorCode(null);
    try {
      const created = await createSession({
        autoAccept: mode === "auto",
        origin: appBaseUrl(),
      });
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
  }, [createSession, mode]);

  const handleClose = useCallback(async () => {
    if (!token) return;
    setErrorCode(null);
    try {
      await closeSession({ token });
      setConfirmClose(false);
      setNow(Date.now());
    } catch (error) {
      setErrorCode(errorCodeOf(error));
    }
  }, [closeSession, token]);

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
    async (action: Promise<unknown>) => {
      setErrorCode(null);
      try {
        await action;
      } catch (error) {
        setErrorCode(errorCodeOf(error));
      }
    },
    []
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
        <div className="banner banner-error" role="alert">
          {hasKey(`errors.${errorCode}`)
            ? t(`errors.${errorCode}` as TKey)
            : t("errors.UNKNOWN")}
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
          </div>

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
                        onAccept={() => runPhotoAction(acceptPhoto({ token, photoId: photo.id }))}
                        onReject={() => runPhotoAction(rejectPhoto({ token, photoId: photo.id }))}
                        onDelete={() => runPhotoAction(deletePhoto({ token, photoId: photo.id }))}
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
                        onDownload={() =>
                          downloadFile(
                            photo.url as string,
                            ensureExtension(photo.fileName, photo.mimeType)
                          )
                        }
                        onDelete={() => runPhotoAction(deletePhoto({ token, photoId: photo.id }))}
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
    </section>
  );
}
