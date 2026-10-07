import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { applyOta, getOtaState, subscribeOta, type OtaState } from "../lib/ota";

/**
 * Sits above the footer once a newer bundle has been downloaded. Applying it
 * reloads the WebView, so it never happens on its own: a reload during an
 * upload would drop the photos in flight.
 */
export function OtaBanner() {
  const { t } = useI18n();
  const [state, setState] = useState<OtaState>(getOtaState);
  const [applying, setApplying] = useState(false);

  useEffect(() => subscribeOta(setState), []);

  if (state.phase !== "ready" && state.phase !== "downloading") return null;

  return (
    <div className="ota-bar" role="status">
      <span className="ota-text">
        {state.phase === "downloading" ? t("ota.downloading") : t("ota.ready")}
      </span>
      {state.phase === "ready" && (
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={applying}
          onClick={() => {
            setApplying(true);
            void applyOta().catch(() => setApplying(false));
          }}
        >
          {applying ? t("ota.applying") : t("ota.apply")}
        </button>
      )}
    </div>
  );
}
