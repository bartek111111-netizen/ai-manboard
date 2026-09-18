/**
 * Bearer-token auth (Faza 6.4, S-2, S-7, PLAN §16):
 * - REST routes: `Authorization: Bearer <token>`.
 * - SSE routes: `?token=` (browser EventSource cannot set headers).
 * - The token is stored as SHA-256 in `security.token` (raw shown once, at
 *   first set). `null` = off (the middleware is a no-op).
 * - `/healthz` + the static web are exempt (liveness / UI shell).
 */
import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { AppError } from "@ai-dashboard/shared";

/** SHA-256 of a token (hex). Used to compare against the stored hash. */
export function sha256(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A Fastify `onRequest` hook that enforces the bearer token (when configured).
 * Returns a no-op function when the token is not set (auth is off).
 */
export function makeAuthMiddleware(
  getTokenHash: () => string | null,
): (request: FastifyRequest) => Promise<void> {
  return async (request) => {
    const configured = getTokenHash();
    if (!configured) return; // auth off (no token set)
    // Exempt: liveness + the web shell (no auth needed).
    const url = request.url;
    if (url.startsWith("/healthz") || url === "/" || url.startsWith("/assets/"))
      return;
    // Extract the token: Bearer header (REST) or ?token= (SSE).
    const authHeader = request.headers.authorization;
    const token =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length)
        : extractQueryToken(url);
    if (!token) {
      throw new AppError(
        "UNAUTHORIZED",
        "authentication required",
        undefined,
        401,
      );
    }
    const hash = sha256(token);
    if (hash !== configured) {
      throw new AppError("UNAUTHORIZED", "invalid token", undefined, 401);
    }
  };
}

/** Extracts `?token=<value>` from the URL (for SSE). */
function extractQueryToken(url: string): string | null {
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) return null;
  const query = url.slice(queryIndex + 1);
  const params = new URLSearchParams(query);
  return params.get("token");
}
