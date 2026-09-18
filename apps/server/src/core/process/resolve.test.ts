import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultGlobalConfig,
  type InstanceState,
  type ModelConfig,
  type Preset,
} from "@ai-dashboard/shared";
import { listEngines } from "@ai-dashboard/shared/engine";
import { ensureHome, resolveHome } from "../config/paths.js";
import { ConfigStore } from "../config/store.js";
import { InstanceResolver, resolveInstanceId } from "./resolve.js";

function tempHome(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ai-dashboard-${name}-`));
  process.env.AI_DASHBOARD_HOME = dir;
  return dir;
}
function clearHome(): void {
  delete process.env.AI_DASHBOARD_HOME;
}

const MODEL_ID = "smollm2-a1b2c3d4";

function seededStore(home: string): { store: ConfigStore; modelFile: string } {
  const dir = resolveHome(home);
  ensureHome(dir);
  const store = new ConfigStore(dir);

  const modelFile = join(home, "model.gguf");
  writeFileSync(modelFile, "gguf");

  const model: ModelConfig = {
    version: 1,
    engineId: "llama-server",
    tags: [],
    capabilities: {},
    params: { model: modelFile },
  };
  store.writeModel(MODEL_ID, model);
  const preset: Preset = { version: 1, name: "test", port: 8081, params: {} };
  store.writePreset(MODEL_ID, "test", preset);
  const global = defaultGlobalConfig();
  global.engines = { "llama-server": { binary: "/usr/bin/llama-server" } };
  store.writeGlobal(global);
  return { store, modelFile };
}

describe("resolveInstanceId", () => {
  it("splits <modelId>--<presetName> on the first --", () => {
    expect(resolveInstanceId("smollm2-a1b2c3d4--test")).toEqual({
      modelId: "smollm2-a1b2c3d4",
      presetName: "test",
    });
  });
  it("throws on an id without a separator", () => {
    expect(() => resolveInstanceId("no-separator")).toThrowError();
  });
});

/** A mock registry that returns null (no instance) for all `get` calls. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock signature
const mockRegistry = {
  get: (_instanceId: string): { port: number; state: InstanceState } | null =>
    null,
};

/** Deterministic port probe: nothing on the system (isolates from the real host). */
const freeProbe = async (): Promise<boolean> => false;

describe("InstanceResolver", () => {
  afterEach(clearHome);

  it("resolves a pinned-port preset into a launch command on that port", async () => {
    const home = tempHome("resolve-pin");
    const { store } = seededStore(home);
    const resolver = new InstanceResolver({
      store,
      engines: listEngines(),
      takenPorts: () => [],
      registry: mockRegistry,
      portInUse: freeProbe,
    });
    const inst = await resolver.resolve(`${MODEL_ID}--test`);
    expect(inst.port).toBe(8081);
    expect(inst.base).toBe("http://127.0.0.1:8081");
    expect(inst.engine.id).toBe("llama-server");
    expect(inst.launch.binary).toBe("/usr/bin/llama-server");
    const args = inst.launch.args;
    const portIdx = args.indexOf("--port");
    expect(portIdx).toBeGreaterThanOrEqual(0);
    expect(args[portIdx + 1]).toBe("8081");
    expect(args).toContain("--model");
  });

  it("sends only user-set params, never schema defaults (regression: --n-cpu-moe -1 crash)", async () => {
    // The user did NOT set n-cpu-moe / load-mode / seed / n-predict, so the
    // schema defaults must NOT leak into the launch command. Sending
    // `--n-cpu-moe -1` (the schema default) made the llama-server abort with
    // "invalid value"; `--metrics`/`--host`/`--port` must still be present.
    const home = tempHome("resolve-no-defaults");
    const { store } = seededStore(home);
    const resolver = new InstanceResolver({
      store,
      engines: listEngines(),
      takenPorts: () => [],
      registry: mockRegistry,
      portInUse: freeProbe,
    });
    const inst = await resolver.resolve(`${MODEL_ID}--test`);
    const args = inst.launch.args;
    for (const forbidden of [
      "--n-cpu-moe",
      "--load-mode",
      "--seed",
      "--n-predict",
      "--batch-size",
      "--min-p",
    ]) {
      expect(args).not.toContain(forbidden);
    }
    expect(args).toContain("--metrics");
    expect(args).toContain("--host");
    expect(args).toContain("--port");
    expect(args).toContain("--model");
  });

  it("sends a user-set param that equals its schema default (source is the preset, not the schema)", async () => {
    const home = tempHome("resolve-set-default");
    const { store } = seededStore(home);
    const preset: Preset = {
      version: 1,
      name: "explicit",
      port: 8081,
      params: { threads: 8 },
    };
    store.writePreset(MODEL_ID, "explicit", preset);
    const resolver = new InstanceResolver({
      store,
      engines: listEngines(),
      takenPorts: () => [],
      registry: mockRegistry,
      portInUse: freeProbe,
    });
    const inst = await resolver.resolve(`${MODEL_ID}--explicit`);
    expect(inst.launch.args).toContain("--threads");
  });

  it("allocates a free port from the range when the preset has none", async () => {
    const home = tempHome("resolve-alloc");
    const { store } = seededStore(home);
    const preset: Preset = {
      version: 1,
      name: "noport",
      port: undefined,
      params: {},
    };
    store.writePreset(MODEL_ID, "noport", preset);
    const resolver = new InstanceResolver({
      store,
      engines: listEngines(),
      takenPorts: () => [],
      registry: mockRegistry,
      portInUse: freeProbe,
    });
    const inst = await resolver.resolve(`${MODEL_ID}--noport`);
    expect(inst.port).toBeGreaterThanOrEqual(8080);
    expect(inst.port).toBeLessThanOrEqual(8099);
  });

  it("skips ports already taken by other instances", async () => {
    const home = tempHome("resolve-skip");
    const { store } = seededStore(home);
    const preset: Preset = { version: 1, name: "noport", params: {} };
    store.writePreset(MODEL_ID, "noport", preset);
    const resolver = new InstanceResolver({
      store,
      engines: listEngines(),
      takenPorts: () => [8080],
      registry: mockRegistry,
      portInUse: freeProbe,
    });
    const inst = await resolver.resolve(`${MODEL_ID}--noport`);
    expect(inst.port).toBe(8081); // 8080 taken → next free
  });

  it("throws PRESET_NOT_FOUND when the preset does not exist", async () => {
    const home = tempHome("resolve-missing");
    const { store } = seededStore(home);
    const resolver = new InstanceResolver({
      store,
      engines: listEngines(),
      takenPorts: () => [],
      registry: mockRegistry,
      portInUse: freeProbe,
    });
    await expect(resolver.resolve(`${MODEL_ID}--ghost`)).rejects.toThrowError(
      /preset not found/i,
    );
  });

  it("auto-allocates a free port when the pinned port is already taken (registry)", async () => {
    const home = tempHome("resolve-conflict");
    const { store } = seededStore(home);
    const preset: Preset = { version: 1, name: "busy", port: 8085, params: {} };
    store.writePreset(MODEL_ID, "busy", preset);
    const resolver = new InstanceResolver({
      store,
      engines: listEngines(),
      takenPorts: () => [8085],
      registry: mockRegistry,
      portInUse: freeProbe,
    });
    const inst = await resolver.resolve(`${MODEL_ID}--busy`);
    expect(inst.port).toBe(8080); // 8085 taken → first free in range
  });

  it("auto-allocates when the pinned port is held on the system (not in registry)", async () => {
    const home = tempHome("resolve-sysprobe");
    const { store } = seededStore(home);
    const preset: Preset = {
      version: 1,
      name: "sysbusy",
      port: 8082,
      params: {},
    };
    store.writePreset(MODEL_ID, "sysbusy", preset);
    const resolver = new InstanceResolver({
      store,
      engines: listEngines(),
      takenPorts: () => [],
      registry: mockRegistry,
      portInUse: async (p) => p === 8082,
    });
    const inst = await resolver.resolve(`${MODEL_ID}--sysbusy`);
    expect(inst.port).toBe(8080); // 8082 held externally → first free in range
  });

  it("throws PORT_IN_USE when no port in the range is free", async () => {
    const home = tempHome("resolve-exhausted");
    const { store } = seededStore(home);
    const global = store.readGlobal();
    const all = Array.from(
      { length: global.portRange.end - global.portRange.start + 1 },
      (_, i) => global.portRange.start + i,
    );
    const resolver = new InstanceResolver({
      store,
      engines: listEngines(),
      takenPorts: () => all,
      registry: mockRegistry,
      portInUse: freeProbe,
    });
    await expect(resolver.resolve(`${MODEL_ID}--test`)).rejects.toThrowError(
      /no free port/,
    );
  });

  it("lists known instance ids", async () => {
    const home = tempHome("resolve-list");
    const { store } = seededStore(home);
    const resolver = new InstanceResolver({
      store,
      engines: listEngines(),
      takenPorts: () => [],
      registry: mockRegistry,
    });
    expect(resolver.listIds()).toContain(`${MODEL_ID}--test`);
  });
});
