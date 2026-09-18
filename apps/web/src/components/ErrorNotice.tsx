import { t } from "../i18n";
import { errorAction } from "../ui/errors";

/**
 * Error notice (Faza 7.4, §17): shows the error message + an actionable
 * suggestion for known error codes.
 */
export function ErrorNotice({
  message,
  code,
}: {
  message: string | null;
  code?: string | null;
}) {
  if (!message) return null;
  const action = errorAction(code);
  return (
    <div className="error-notice">
      <p className="status-error">{message}</p>
      {action && (
        <p className="error-action">
          {t("errActionPrefix")}: {action}
        </p>
      )}
    </div>
  );
}
