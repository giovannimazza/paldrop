import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { hasKey, useI18n, type TKey } from "../i18n";
import { APP_BUILD } from "../lib/client";
import { Logo } from "./Logo";
import { OtaBanner } from "./OtaBanner";

type Status = "active" | "waiting" | "expired" | "closed";

const STATUS_KEY: Record<Status, TKey> = {
  active: "status.active",
  waiting: "status.waiting",
  expired: "status.expired",
  closed: "status.closed",
};

export function StatusBadge({ status }: { status: Status }) {
  const { t } = useI18n();
  return (
    <span className={`badge badge-${status}`}>
      <span className="badge-dot" aria-hidden="true" />
      {t(STATUS_KEY[status])}
    </span>
  );
}

export function ErrorPanel({ code }: { code: string }) {
  const { t } = useI18n();
  const rawKey = `errors.${code}`;
  const detail = hasKey(rawKey) ? t(rawKey as TKey) : t("errors.UNKNOWN");
  return (
    <div className="panel error-panel" role="alert">
      <p className="panel-title">{t("expired.message")}</p>
      <p className="panel-text muted">{detail}</p>
      <Link className="btn btn-primary btn-block" to="/">
        {t("expired.home")}
      </Link>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { lang, setLang, t } = useI18n();

  const toggleTheme = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = next;
    try {
      localStorage.setItem("paldrop.theme", next);
    } catch {
      // ignore
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand" aria-label="Paldrop">
          <Logo size={28} />
          <span className="brand-name">Paldrop</span>
        </Link>
        <div className="header-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setLang(lang === "it" ? "en" : "it")}
            aria-label={lang === "it" ? "Switch to English" : "Passa all’italiano"}
          >
            {lang === "it" ? "EN" : "IT"}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={t("nav.theme")}
          >
            <span aria-hidden="true">◑</span>
          </button>
        </div>
      </header>

      <main className="app-main">{children}</main>

      <OtaBanner />

      <footer className="app-footer">
        <Link to="/privacy">{t("nav.privacy")}</Link>
        <span className="footer-sep" aria-hidden="true">
          ·
        </span>
        <Link to="/terms">{t("nav.terms")}</Link>
        <span className="footer-sep" aria-hidden="true">
          ·
        </span>
        <a
          href="https://github.com/giovannimazza/paldrop"
          target="_blank"
          rel="noreferrer"
        >
          {t("nav.opensource")}
        </a>
        <span className="footer-sep" aria-hidden="true">
          ·
        </span>
        <span className="footer-build" title="build">{APP_BUILD}</span>
      </footer>
    </div>
  );
}
