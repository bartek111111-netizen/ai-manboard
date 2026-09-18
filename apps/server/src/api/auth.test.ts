import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ConfigWatchState } from "@ai-dashboard/shared";
import { sha256 } from "./auth.js";
import { buildApp } from "../app.js";
import { ensureHome, resolveHome } from "../core/config/paths.js";
import { ConfigStore } from "../core/config/store.js";

const TOKEN = "secret-token-123";
const HASH = sha256(TOKEN);

async function tempApp(tokenHash: string | null) {
  const dir = mkdtempSync(join(tmpdir(), "ai-dashboard-auth-"));
  const home = resolveHome(join(dir, ".ai-dashboard"));
  ensureHome(home);
  const store = new ConfigStore(home);
  const configState: ConfigWatchState = {
    home: home.root,
    watchActive: true,
    lastExternalChangeAt: null,
    reloadCount: 0,
    lastReloadError: null,
  };
  const app = await buildApp({
    store,
    getConfigState: () => configState,
    getTokenHash: () => tokenHash,
  });
  return { app, dir };
}

describe("bearer-token auth (S-2, Faza 6.4)", () => {
  it("sha256 produces a stable 64-char hex hash", () => {
    expect(HASH).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256(TOKEN)).toBe(HASH);
    expect(sha256("other")).not.toBe(HASH);
  });

  it("401 when the token is not sent (auth on)", async () => {
    const { app } = await tempApp(HASH);
    const res = await app.inject({ method: "GET", url: "/api/v1/models" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("401 when the token is wrong", async () => {
    const { app } = await tempApp(HASH);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/models",
      headers: { authorization: `Bearer wrong-token` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("200 when the token is correct", async () => {
    const { app } = await tempApp(HASH);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/models",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("models");
    await app.close();
  });

  it("SSE ?token= works (query param, S-7)", async () => {
    const { app } = await tempApp(HASH);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/config?token=${encodeURIComponent(TOKEN)}`,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("auth is a no-op when no token is configured (S-2 off)", async () => {
    const { app } = await tempApp(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/models" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("/healthz is exempt (liveness)", async () => {
    const { app } = await tempApp(HASH);
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
