/**
 * Security rules (Faza 10.3, S-1): if the dashboard binds to a non-loopback
 * address, a security token is required. This is a hard startup check — if the
 * host is non-loopback and no token is configured, the dashboard refuses to
 * start with a clear error message.
 */

/** Returns true when the host is a loopback address. */
export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/**
 * Validates the security configuration (S-1): if the host is non-loopback,
 * a token must be set. Throws an error with a clear message when violated.
 */
export function validateSecurityConfig(
  host: string,
  token: string | null,
): void {
  if (isLoopbackHost(host)) return; // loopback: token optional
  if (token === null || token === "") {
    throw new Error(
      `Security rule S-1: the dashboard is bound to ${host} (non-loopback). ` +
        `A security token is required. Set a token in global config (security.token) ` +
        `or bind to a loopback address (127.0.0.1).`,
    );
  }
}
