import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { isValidCode, normalizeCode } from "../lib/client";
import { Logo } from "../components/Logo";

export function Home() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [showManual, setShowManual] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeCode(code);
    if (!isValidCode(normalized)) {
      setError(true);
      return;
    }
    setError(false);
    navigate(`/r/${normalized}`);
  };

  return (
    <section className="page home-page">
      <div className="hero">
        <Logo size={72} />
        <h1 className="hero-title">Paldrop</h1>
        <p className="hero-tagline">{t("app.tagline")}</p>
      </div>

      <div className="cta-stack">
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          onClick={() => navigate("/receive")}
        >
          {t("home.receive")}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-lg btn-block"
          onClick={() => setShowManual((value) => !value)}
          aria-expanded={showManual}
        >
          {t("home.send")}
        </button>
      </div>

      <p className="hint-text">{t("home.receiveHint")}</p>

      {showManual && (
        <form className="panel code-panel" onSubmit={submitCode}>
          <p className="panel-title">{t("home.manualTitle")}</p>
          <input
            className="input code-input"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={64}
            placeholder={t("home.manualPlaceholder")}
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setError(false);
            }}
            aria-label={t("home.manualPlaceholder")}
          />
          {error && (
            <p className="field-error" role="alert">
              {t("home.manualError")}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block">
            {t("home.manualOpen")}
          </button>
          <p className="hint-text small">{t("home.manualHelp")}</p>
        </form>
      )}
    </section>
  );
}
