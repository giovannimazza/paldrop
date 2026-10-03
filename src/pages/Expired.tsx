import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { Logo } from "../components/Logo";

export function Expired() {
  const { t } = useI18n();
  return (
    <section className="page center-page">
      <div className="panel error-panel" role="alert">
        <Logo size={56} />
        <p className="panel-title">{t("expired.message")}</p>
        <Link className="btn btn-primary btn-block" to="/">
          {t("expired.home")}
        </Link>
      </div>
    </section>
  );
}
