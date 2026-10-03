import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useParams } from "react-router-dom";
import { hasKey, useI18n, type TKey } from "../i18n";
import { ErrorPanel, StatusBadge } from "../components/Layout";
import { errorCodeOf, formatBytes, formatCountdown } from "../lib/client";
import { uploadFile, useBackendMode, useSessionInfo } from "../lib/backend";

type Phase = "idle" | "sending" | "done";

export function Send() {
  const { token = "" } = useParams<{ token: string }>();
  const { t, lang } = useI18n();

  const backend = useBackendMode();
  const session = useSessionInfo(backend, token);

  const [selected, setSelected] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Object URLs for previews, revoked whenever the selection changes.
  const previews = useMemo(
    () => selected.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [selected]
  );
  useEffect(() => {
    return () => previews.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [previews]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const totalBytes = selected.reduce((sum, file) => sum + file.size, 0);
  const remaining = session ? Math.max(0, session.expiresAt - now) : 0;

  const addFiles = (files: File[]) => {
    if (files.length === 0 || !session) return;
    const room = session.maxPhotos - selected.length;
    if (room <= 0) {
      setErrorCode("LIMIT_PHOTO_COUNT");
      return;
    }
    const accepted = files.slice(0, room);
    const nextBytes = totalBytes + accepted.reduce((sum, file) => sum + file.size, 0);
    if (nextBytes > session.maxTotalBytes) {
      setErrorCode("LIMIT_TOTAL_BYTES");
      return;
    }
    setErrorCode(null);
    setSelected((current) => [...current, ...accepted]);
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const removeAt = (index: number) => {
    setSelected((current) => current.filter((_, i) => i !== index));
  };

  const send = async () => {
    if (selected.length === 0 || phase === "sending") return;
    setPhase("sending");
    setErrorCode(null);
    setProgress(0);

    const total = selected.reduce((sum, file) => sum + file.size, 0);
    let doneBytes = 0;

    try {
      for (const file of selected) {
        await uploadFile({
          mode: backend,
          token,
          file,
          onProgress: (fraction) => {
            const current = doneBytes + file.size * fraction;
            setProgress(Math.min(99, Math.round((current / total) * 100)));
          },
        });
        doneBytes += file.size;
        setProgress(Math.round((doneBytes / total) * 100));
      }
      setSentCount(selected.length);
      setSelected([]);
      setPhase("done");
    } catch (error) {
      setErrorCode(errorCodeOf(error));
      setPhase("idle");
      setProgress(0);
    }
  };

  if (session === undefined) {
    return (
      <section className="page center-page">
        <p className="hint-text">{t("common.loading")}</p>
      </section>
    );
  }

  if (session === null) {
    return <ErrorPanel code="SESSION_NOT_FOUND" />;
  }
  if (session.status !== "active") {
    return (
      <ErrorPanel
        code={session.status === "closed" ? "SESSION_CLOSED" : "SESSION_EXPIRED"}
      />
    );
  }

  const detail = errorCode
    ? hasKey(`errors.${errorCode}`)
      ? t(`errors.${errorCode}` as TKey)
      : t("errors.UNKNOWN")
    : null;

  return (
    <section className="page send-page">
      <div className="page-head">
        <h1 className="page-title">{t("send.title")}</h1>
        <StatusBadge status="active" />
      </div>
      <p className="hint-text">{t("send.subtitle")}</p>

      <div className="session-meta">
        <span className="meta-chip">
          {t("send.sessionValidFor")}{" "}
          <strong>{formatCountdown(remaining)}</strong>
        </span>
        <span className="meta-chip">
          {session.fileCount}/{session.maxPhotos} ·{" "}
          {formatBytes(session.totalBytesUploaded, lang)}/
          {formatBytes(session.maxTotalBytes, lang)}
        </span>
      </div>

      {detail && (
        <div className="banner banner-error" role="alert">
          {detail}
        </div>
      )}

      {phase === "done" ? (
        <div className="panel success-panel" role="status">
          <span className="success-mark" aria-hidden="true">
            ✓
          </span>
          <p className="panel-title">
            {sentCount === 1 ? t("send.doneOne") : t("send.doneMany")}
          </p>
          {!session.autoAccept && (
            <p className="panel-text muted">{t("send.waitApproval")}</p>
          )}
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={() => setPhase("idle")}
          >
            {t("send.sendMore")}
          </button>
        </div>
      ) : (
        <>
          <div className="cta-row">
            <button
              type="button"
              className="btn btn-secondary btn-lg btn-grow"
              onClick={() => pickRef.current?.click()}
              disabled={phase === "sending"}
            >
              {t("send.select")}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-lg btn-grow"
              onClick={() => cameraRef.current?.click()}
              disabled={phase === "sending"}
            >
              {t("send.capture")}
            </button>
          </div>

          <input
            ref={pickRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={onPick}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={onPick}
          />

          <section className="photo-section">
            <h2 className="section-title">
              {selected.length > 0
                ? `${t("send.selected")} (${selected.length} · ${formatBytes(totalBytes, lang)})`
                : t("send.empty")}
            </h2>
            {previews.length > 0 && (
              <div className="preview-grid">
                {previews.map((preview, index) => (
                  <figure className="preview-card" key={preview.url}>
                    <img src={preview.url} alt={preview.file.name} />
                    <button
                      type="button"
                      className="preview-remove"
                      onClick={() => removeAt(index)}
                      aria-label={t("send.remove")}
                      disabled={phase === "sending"}
                    >
                      ✕
                    </button>
                  </figure>
                ))}
              </div>
            )}
          </section>

          <p className="hint-text small">{t("send.limitHint")}</p>
          {!session.autoAccept && selected.length > 0 && (
            <p className="hint-text small">{t("send.waitApproval")}</p>
          )}

          {phase === "sending" ? (
            <div className="progress-wrap" aria-live="polite">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="progress-label">
                {t("send.progress")} {progress}%
              </span>
              <span className="hint-text small">{t("send.sending")}</span>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              onClick={send}
              disabled={selected.length === 0}
            >
              {selected.length === 0
                ? t("send.send")
                : `${t("send.send")} (${selected.length})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
