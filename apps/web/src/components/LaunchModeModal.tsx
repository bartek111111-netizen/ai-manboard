/**
 * LaunchModeModal — the small context window shown when the user clicks
 * Start (or Restart). It lets the user choose how the engine is tied to the
 * dashboard:
 * - "Zostaje w tle" (background): the model keeps running after the dashboard
 *   closes / restarts.
 * - "Znika z dashboardem" (session): the model stops together with the
 *   dashboard.
 */
import { t } from "../i18n";
import type { LaunchMode } from "../api/client";

export function LaunchModeModal({
  onSelect,
  onClose,
}: {
  onSelect: (mode: LaunchMode) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
        <h2>{t("launchModeTitle")}</h2>
        <p className="launch-mode-intro">{t("launchModeIntro")}</p>

        <button
          type="button"
          className="launch-mode-option"
          onClick={() => onSelect("background")}
        >
          <span className="launch-mode-title">
            🟢 {t("launchModeBackground")}
          </span>
          <span className="launch-mode-desc">
            {t("launchModeBackgroundDesc")}
          </span>
        </button>
        <button
          type="button"
          className="launch-mode-option"
          onClick={() => onSelect("session")}
        >
          <span className="launch-mode-title">⚪ {t("launchModeSession")}</span>
          <span className="launch-mode-desc">{t("launchModeSessionDesc")}</span>
        </button>

        <button
          type="button"
          className="btn small launch-mode-cancel"
          onClick={onClose}
        >
          {t("cancelBtn")}
        </button>
      </div>
    </div>
  );
}
