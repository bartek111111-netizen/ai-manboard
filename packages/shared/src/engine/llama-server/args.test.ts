import { describe, expect, it } from "vitest";
import { buildLlamaServerLaunch } from "./args.js";
import { LLAMA_SERVER_SCHEMA } from "./schema.js";

/** All schema defaults as a params object (represents "user provided every value"). */
function defaults(): Record<string, unknown> {
  return Object.fromEntries(LLAMA_SERVER_SCHEMA.map((p) => [p.key, p.default]));
}

describe("buildLlamaServerLaunch (user-set-params rule)", () => {
  it("sends only the params the user provided (no schema defaults merged)", () => {
    // The params object contains ONLY what the user set. Schema defaults are
    // NOT merged in — the server runs on its own defaults for unset params.
    const ctx = {
      binary: "llama-server",
      modelPath: "/mnt/dane/Modele/llama-3-8b-instruct.Q8_0.gguf",
      params: {
        "context-size": 4096,
        "gpu-layers": 32,
        threads: 8,
        temp: 0.7,
        "top-p": 0.8,
        "top-k": 20,
        "max-tokens": 512,
        host: "127.0.0.1",
        port: 8081,
        "ubatch-size": 1024,
        "cache-type-k": "q4_1",
      },
    };
    const cmd = buildLlamaServerLaunch(ctx);
    // Order follows LLAMA_SERVER_SCHEMA: model, ctx-size, cache-type-k, gpu-layers,
    // threads, ubatch-size, temp, top-p, top-k, n-predict, host, port.
    expect(cmd.args).toEqual([
      "--model",
      "/mnt/dane/Modele/llama-3-8b-instruct.Q8_0.gguf",
      "--ctx-size",
      "4096",
      "--cache-type-k",
      "q4_1",
      "--n-gpu-layers",
      "32",
      "--threads",
      "8",
      "--ubatch-size",
      "1024",
      "--temp",
      "0.7",
      "--top-p",
      "0.8",
      "--top-k",
      "20",
      "--n-predict",
      "512",
      "--host",
      "127.0.0.1",
      "--port",
      "8081",
    ]);
    // cwd defaults to the model file's directory; env is empty.
    expect(cmd.cwd).toBe("/mnt/dane/Modele");
    expect(cmd.env).toEqual({});
  });

  it("sends only --model when no params are provided (user set nothing)", () => {
    const cmd = buildLlamaServerLaunch({
      binary: "llama-server",
      modelPath: "/m/model.gguf",
      params: {},
    });
    expect(cmd.args).toEqual(["--model", "/m/model.gguf"]);
  });

  it("sends all params that are present in the params object", () => {
    // When the user provided every param (e.g. via the form), all are sent.
    const cmd = buildLlamaServerLaunch({
      binary: "llama-server",
      modelPath: "/m/model.gguf",
      params: { ...defaults(), model: undefined },
    });
    for (const flag of [
      "--ctx-size",
      "--n-gpu-layers",
      "--threads",
      "--temp",
      "--top-p",
      "--top-k",
      "--n-predict",
      "--ubatch-size",
      "--cache-type-k",
      "--cache-type-v",
    ]) {
      expect(cmd.args).toContain(flag);
    }
  });

  it('gpu-layers: number sent as-is, "all" accepted, "auto" sent if provided', () => {
    const base = {
      binary: "llama-server",
      modelPath: "/m/x.gguf",
      params: { model: undefined },
    };
    expect(
      buildLlamaServerLaunch({
        ...base,
        params: { ...base.params, "gpu-layers": 32 },
      }).args,
    ).toContain("--n-gpu-layers");
    expect(
      buildLlamaServerLaunch({
        ...base,
        params: { ...base.params, "gpu-layers": "all" },
      }).args,
    ).toContain("--n-gpu-layers");
    const all = buildLlamaServerLaunch({
      ...base,
      params: { ...base.params, "gpu-layers": "all" },
    }).args;
    expect(all[all.indexOf("--n-gpu-layers") + 1]).toBe("all");
    // "auto" is a value the user provided → sent (not omitted).
    const auto = buildLlamaServerLaunch({
      ...base,
      params: { ...base.params, "gpu-layers": "auto" },
    }).args;
    expect(auto).toContain("--n-gpu-layers");
    expect(auto[auto.indexOf("--n-gpu-layers") + 1]).toBe("auto");
    // Not provided at all → not sent.
    expect(
      buildLlamaServerLaunch({ ...base, params: { ...base.params } }).args,
    ).not.toContain("--n-gpu-layers");
  });

  it("bools: metrics flag when true; offline flag when true; fit → --fit off when false", () => {
    const base = { binary: "llama-server", modelPath: "/m/x.gguf" };
    const mk = (extra: Record<string, unknown>) =>
      buildLlamaServerLaunch({
        ...base,
        params: { model: undefined, ...extra },
      }).args;

    expect(mk({ "metrics-enabled": true })).toContain("--metrics"); // true → sent
    expect(mk({ "metrics-enabled": false })).not.toContain("--metrics"); // false → not sent
    expect(mk({ offline: true })).toContain("--offline"); // true → sent
    expect(mk({ offline: false })).not.toContain("--offline"); // false → not sent
    // fit: offValue param — true → nothing; false → --fit off
    expect(mk({ fit: true })).not.toContain("--fit");
    const fitArgs = mk({ fit: false });
    expect(fitArgs[fitArgs.indexOf("--fit") + 1]).toBe("off");
    // Not provided → not sent.
    expect(mk({})).not.toContain("--metrics");
    expect(mk({})).not.toContain("--offline");
  });

  it("slots-endpoint/web-ui: --no-slots / --no-ui when false (provided), nothing when true or absent", () => {
    const base = { binary: "llama-server", modelPath: "/m/x.gguf" };
    const mk = (extra: Record<string, unknown>) =>
      buildLlamaServerLaunch({
        ...base,
        params: { model: undefined, ...extra },
      }).args;

    expect(mk({ "slots-endpoint": true })).not.toContain("--no-slots"); // true → nothing
    expect(mk({ "slots-endpoint": false })).toContain("--no-slots"); // false → --no-slots
    expect(mk({})).not.toContain("--no-slots"); // absent → nothing
    expect(mk({ "web-ui": true })).not.toContain("--no-ui"); // true → nothing
    expect(mk({ "web-ui": false })).toContain("--no-ui"); // false → --no-ui
    expect(mk({})).not.toContain("--no-ui"); // absent → nothing
  });

  it("enum + path params: sent when provided, absent when not", () => {
    const base = { binary: "llama-server", modelPath: "/m/x.gguf" };
    const mk = (extra: Record<string, unknown>) =>
      buildLlamaServerLaunch({
        ...base,
        params: { model: undefined, ...extra },
      }).args;

    const loadMode = mk({ "load-mode": "mmap" });
    expect(loadMode[loadMode.indexOf("--load-mode") + 1]).toBe("mmap");
    const fa = mk({ "flash-attn": "on" });
    expect(fa[fa.indexOf("--flash-attn") + 1]).toBe("on");
    const spec = mk({
      "spec-model": "/m/draft.gguf",
      "spec-type": "draft-simple",
      "n-draft": 5,
    });
    expect(spec).toContain("--spec-draft-model");
    expect(spec[spec.indexOf("--spec-draft-model") + 1]).toBe("/m/draft.gguf");
    expect(spec[spec.indexOf("--spec-type") + 1]).toBe("draft-simple");
    expect(spec[spec.indexOf("--spec-draft-n-max") + 1]).toBe("5");
    // Not provided → not sent.
    expect(mk({})).not.toContain("--load-mode");
    expect(mk({})).not.toContain("--flash-attn");
  });

  it('empty strings (device, api-key) are "unset" and never sent', () => {
    const base = { binary: "llama-server", modelPath: "/m/x.gguf" };
    const args = buildLlamaServerLaunch({
      ...base,
      params: { model: undefined, device: "", "api-key": "" },
    }).args;
    expect(args).not.toContain("--device");
    expect(args).not.toContain("--api-key");
  });

  it("api-key sent when set; custom cwd/env pass through", () => {
    const cmd = buildLlamaServerLaunch({
      binary: "llama-server",
      modelPath: "/m/x.gguf",
      params: { model: undefined, "api-key": "sk-test" },
      cwd: "/custom",
      env: { EXTRA: "1" },
    });
    expect(cmd.args).toContain("--api-key");
    expect(cmd.args[cmd.args.indexOf("--api-key") + 1]).toBe("sk-test");
    expect(cmd.cwd).toBe("/custom");
    expect(cmd.env).toEqual({ EXTRA: "1" });
  });
});
