/**
 * E2E (PLAN §23, Faza 5.5): the full lifecycle with a REAL `llama-server`
 * binary and a small GGUF model.
 *
 *   start → readiness probe → running → stop
 *
 * Drives the same `LifecycleManager` the dashboard boots (spawn + real HTTP
 * readiness probe against the running llama-server). No fakes, no mocks:
 * if the model fails to load, the readiness probe times out and the script
 * reports `error` (exit 1) with the diagnostic.
 *
 * Config (env, all optional):
 *   E2E_LLAMA_SERVER_BIN  path to llama-server   (default /home/bat/llama.cpp/build/bin/llama-server)
 *   E2E_MODEL_PATH        the small GGUF model   (default .e2e-models/SmolLM2-135M-Instruct-Q2_K.gguf)
 *   E2E_PORT              pinned port            (default 8901)
 *   E2E_TIMEOUT_SEC       readiness budget       (default 120)
 */
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultGlobalConfig } from "@ai-dashboard/shared";
import { listEngines } from "@ai-dashboard/shared/engine";
import {
  ensureHome,
  resolveHome,
} from "../../apps/server/src/core/config/paths.js";
import { ConfigStore } from "../../apps/server/src/core/config/store.js";
import { HealthProber } from "../../apps/server/src/core/health/prober.js";
import { LogWriter } from "../../apps/server/src/core/logs/writer.js";
import { LifecycleManager } from "../../apps/server/src/core/process/lifecycle.js";
import { ProcessManager } from "../../apps/server/src/core/process/manager.js";
import { PidRegistry } from "../../apps/server/src/core/process/registry.js";

const MODEL_ID = "e2e-model";
const PRESET = "e2e";
const INSTANCE = `${MODEL_ID}--${PRESET}`;

function main(): void {
  const repoRoot = process.cwd();
  const binary =
    process.env.E2E_LLAMA_SERVER_BIN ??
    "/home/bat/llama.cpp/build/bin/llama-server";
  const modelPath = resolve(
    repoRoot,
    process.env.E2E_MODEL_PATH ?? ".e2e-models/SmolLM2-135M-Instruct-Q2_K.gguf",
  );
  const port = Number(process.env.E2E_PORT ?? "8901");
  const timeoutSec = Number(process.env.E2E_TIMEOUT_SEC ?? "120");

  console.log("[e2e] binary      :", binary);
  console.log("[e2e] model       :", modelPath);
  console.log("[e2e] port        :", port);
  if (!existsSync(binary))
    throw new Error(`llama-server binary not found: ${binary}`);
  if (!existsSync(modelPath)) throw new Error(`model not found: ${modelPath}`);

  const home = mkdtempSync(join(tmpdir(), "ai-dashboard-e2e-"));
  process.env.AI_DASHBOARD_HOME = home;
  const dir = resolveHome(home);
  ensureHome(dir);
  const store = new ConfigStore(dir);

  // Layers 3–5: engine binary + model + pinned-port preset (MVP: layers 1–5).
  const global = defaultGlobalConfig();
  global.engines = { "llama-server": { binary } };
  store.writeGlobal(global);
  store.writeModel(MODEL_ID, {
    version: 1,
    engineId: "llama-server",
    tags: [],
    capabilities: {},
    params: { model: modelPath },
  });
  store.writePreset(MODEL_ID, PRESET, {
    version: 1,
    name: PRESET,
    port,
    params: {},
  });

  const registry = new PidRegistry(dir);
  const logs = new LogWriter({
    logsDir: `${home}/logs`,
    retentionFiles: 10,
    maxFileBytes: 10_000_000,
  });
  const manager = new ProcessManager({
    registry,
    logs,
    ringLines: 1000,
    stopTimeoutSec: 10,
  });
  const prober = new HealthProber({ startupTimeoutMs: timeoutSec * 1000 });
  const lifecycle = new LifecycleManager({
    store,
    engines: listEngines(),
    manager,
    registry,
    prober,
    logs,
  });

  const done = (code: number): void => {
    process.env.AI_DASHBOARD_HOME = "";
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    process.exit(code);
  };

  void (async () => {
    const t0 = Date.now();
    console.log(`[e2e] start (${INSTANCE})`);
    await lifecycle.start(INSTANCE);
    console.log(
      `[e2e] spawned: state=${lifecycle.getState(INSTANCE)} (probe running)`,
    );

    // Poll the FSM until it settles to running / error within the budget.
    let state = lifecycle.getState(INSTANCE);
    while (state === "starting" && Date.now() - t0 < timeoutSec * 1000 + 5000) {
      await new Promise((r) => setTimeout(r, 1000));
      state = lifecycle.getState(INSTANCE);
    }

    if (state !== "running") {
      const diag = lifecycle.diagnose(INSTANCE);
      console.error(
        `[e2e] FAILED: instance did not reach running (state=${state})`,
      );
      console.error("[e2e] diagnostic:", JSON.stringify(diag, null, 2));
      await lifecycle.stop(INSTANCE).catch(() => undefined);
      done(1);
      return;
    }

    const upSec = (Date.now() - t0) / 1000;
    console.log(`[e2e] RUNNING after ${upSec.toFixed(1)} s`);

    console.log("[e2e] stop");
    await lifecycle.stop(INSTANCE);
    console.log(`[e2e] stopped: state=${lifecycle.getState(INSTANCE)}`);
    console.log(
      `[e2e] OK: full lifecycle (start → running → stop) in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
    );
    done(0);
  })().catch((err) => {
    console.error("[e2e] error:", err instanceof Error ? err.message : err);
    done(1);
  });
}

main();
