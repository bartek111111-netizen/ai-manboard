import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ConfigWatchState } from "@ai-dashboard/shared";
import { buildApp } from "../../app.js";
import { ensureHome, resolveHome } from "../../core/config/paths.js";
import { ConfigStore } from "../../core/config/store.js";
import { ProcessManager } from "../../core/process/manager.js";
import { PidRegistry } from "../../core/process/registry.js";
import { SseHub } from "../../core/sse/hub.js";

interface SseApp {
  app: ReturnType<typeof buildApp> extends Promise<infer T> ? T : never;
  hub: SseHub;
  url: (path: string) => string;
  close: () => Promise<void>;
}

async function tempSseApp(): Promise<SseApp> {
  const dir = mkdtempSync(join(tmpdir(), "ai-dashboard-sse-"));
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
  const registry = new PidRegistry(home);
  const hub = new SseHub();
  const manager = new ProcessManager({
    registry,
    ringLines: 100,
    stopTimeoutSec: 1,
    onLogLine: (id, line) => hub.publishLog(id, line),
    onStateChange: (id, state) => hub.publishState(id, state),
  });
  const app = await buildApp({
    store,
    getConfigState: () => configState,
    sse: hub,
    manager,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw new Error("no server address");
  const port = address.port;
  return {
    app,
    hub,
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
    close: async () => {
      await app.close();
    },
  };
}

/**
 * Opens an SSE connection and resolves with the body once an `event:` frame
 * arrives (after `publish` is invoked). Returns the raw SSE text.
 */
function readSse(
  url: string,
  publish: () => void,
  timeoutMs = 4000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`SSE timeout. url=${url}`)),
      timeoutMs,
    );
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => {
        body += chunk.toString();
        if (body.includes("event:")) {
          clearTimeout(timer);
          req.destroy();
          resolve(body);
        }
      });
      res.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    // Publish after the connection is established (the response callback has fired).
    setTimeout(publish, 50);
  });
}

describe("SSE endpoints (PLAN §14.1, Faza 6.2)", () => {
  it("streams live log lines on /stream/:instanceId/logs", async () => {
    const { url, hub, close } = await tempSseApp();
    const instanceId = "smollm2-test--fast";
    const body = await readSse(url(`/api/v1/stream/${instanceId}/logs`), () => {
      // The process manager publishes log lines via onLogLine → hub; in the
      // test we publish directly to the hub (the SSE handler subscribes to it).
      hub.publishLog(instanceId, {
        ts: "2025-01-01T00:00:00.000Z",
        level: "info",
        source: "stdout",
        line: "server started",
      });
    });
    expect(body).toContain("event: log");
    expect(body).toContain("server started");
    await close();
  });

  it("streams state events on /stream/events", async () => {
    const { url, hub, close } = await tempSseApp();
    const body = await readSse(url("/api/v1/stream/events"), () => {
      hub.publishState("smollm2-test--fast", "running");
    });
    expect(body).toContain("event: state");
    expect(body).toContain("running");
    await close();
  });
});
