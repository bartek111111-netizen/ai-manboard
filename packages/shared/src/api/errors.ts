/**
 * Unified error model (PLAN §14, §21): `AppError { code, message, details }`.
 * Handlers never throw raw exceptions — the Fastify error handler converts
 * AppError into the standard `{"error": {...}}` envelope.
 */

/** MVP error codes (PLAN §14.1). */
export const APP_ERROR_CODES = [
  "PORT_IN_USE",
  "MODEL_NOT_FOUND",
  "ENGINE_NOT_FOUND",
  "PRESET_NOT_FOUND",
  "INSTANCE_NOT_FOUND",
  "INVALID_STATE",
  "VALIDATION_FAILED",
  "CONFIG_INVALID",
  "CONFIG_WRITE_FAILED",
  "PROCESS_SPAWN_FAILED",
  "STARTUP_TIMEOUT",
  "HEALTH_FAILED",
  "PID_REUSED",
  "ENGINE_BINARY_INVALID",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number] | string;

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    /** HTTP status for this error (default 400). */
    public readonly status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }

  /** Body for the `{"error": {...}}` response envelope. */
  toBody(): {
    error: {
      code: AppErrorCode;
      message: string;
      details?: Record<string, unknown>;
    };
  } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}
