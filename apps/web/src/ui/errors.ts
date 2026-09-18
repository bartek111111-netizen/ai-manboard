import { ApiError } from "../api/client";
import { t } from "../i18n";

/** Extracts `{ message, code }` from an unknown error (for ErrorNotice). */
export function errInfo(err: unknown): { message: string; code?: string } {
  if (err instanceof ApiError) {
    return { message: err.message, code: err.code };
  }
  return { message: String(err) };
}

/**
 * Maps an API error code to an actionable suggestion in PL (Faza 7.4, §17).
 * Returns null when no specific action applies (the message alone is enough).
 */
export function errorAction(code?: string | null): string | null {
  switch (code) {
    case "MODEL_NOT_FOUND":
      return t("errActionModelNotFound");
    case "INSTANCE_LIVE":
      return t("errActionInstanceLive");
    case "ENGINE_BINARY_INVALID":
      return t("errActionEngineBinary");
    case "UNAUTHORIZED":
      return t("errActionUnauthorized");
    default:
      return null;
  }
}
