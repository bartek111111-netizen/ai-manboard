/**
 * The llama-server engine module (PLAN §7.1, §10) — Faza 2.
 * Combines: schema (data), args (command builder), probe (runtime),
 * logpatterns (classification), plus validation, preflight and binary checks.
 */
import { accessSync, constants, existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { ResolvedConfig } from "../../config/types.js";
import type {
  BinaryCheckResult,
  Capability,
  InferenceEngine,
  InstanceView,
  LaunchCommand,
  LaunchContext,
  LogClassification,
  ModelInfo,
  PreflightIssue,
  PreflightResult,
  RuntimeInfo,
} from "../types.js";
import { buildLlamaServerLaunch } from "./args.js";
import { classifyLlamaServerLog } from "./logpatterns.js";
import { fetchLlamaServerRuntimeInfo, isLlamaServerReady } from "./probe.js";
import { LLAMA_SERVER_SCHEMA } from "./schema.js";

export { LLAMA_SERVER_SCHEMA } from "./schema.js";
export { buildLlamaServerLaunch } from "./args.js";
export { classifyLlamaServerLog } from "./logpatterns.js";
export { fetchLlamaServerRuntimeInfo, isLlamaServerReady } from "./probe.js";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child: ChildProcess = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    };
    child.on("error", (err) => {
      finish(-1);
      if (err?.message) stderr += `\n${err.message}`;
    });
    child.on("close", (code) => {
      finish(code ?? -1);
    });
  });
}

/** True when `ldd <binary>` shows a libvulkan linkage (readelf fallback). */
async function detectsVulkanLinkage(binary: string): Promise<boolean> {
  const ldd = await runCommand("ldd", [binary], 5_000);
  if (ldd.exitCode === 0 && /libvulkan/i.test(ldd.stdout + ldd.stderr))
    return true;
  const readelf = await runCommand("readelf", ["-d", binary], 5_000);
  return (
    readelf.exitCode === 0 && /libvulkan/i.test(readelf.stdout + readelf.stderr)
  );
}

/** Binds a TCP listener; resolves true when the port was free. */
function portIsFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => {
      resolve(false);
    });
    srv.once("listening", () => {
      srv.close(() => resolve(true));
    });
    srv.listen({ host, port });
  });
}

function valueOf(cfg: ResolvedConfig, key: string): unknown {
  return cfg[key]?.value;
}

/**
 * Heuristic model capabilities (§10, FM-6): filename/architecture markers.
 * `text` is implicit (a GGUF LLM is always text-capable).
 */
export function detectLlamaServerCapabilities(model: ModelInfo): Capability[] {
  const capabilities: Capability[] = ["text"];
  const haystack = `${model.path} ${model.architecture ?? ""}`.toLowerCase();
  if (/(vision|vlm|vl-|llava|clip|siglip)/.test(haystack))
    capabilities.push("vision");
  if (/(whisper|stt|tts|audio|gummy)/.test(haystack))
    capabilities.push("audio");
  if (/(thinking|reason|think|qwq|r1|open-|instruct)/.test(haystack))
    capabilities.push("thinking");
  if (/(tool|function|mcp|function-calling)/.test(haystack))
    capabilities.push("tool-calling");
  return capabilities;
}

export class LlamaServerEngine implements InferenceEngine {
  readonly id = "llama-server";
  readonly displayName = "llama-server (llama.cpp)";
  readonly description =
    "Wzorcowy serwer llama.cpp: GGUF, Vulkan/CPU, API zgodne z OpenAI.";
  readonly filePatterns = ["*.gguf"];
  readonly schema = LLAMA_SERVER_SCHEMA;

  detectCapabilities(model: ModelInfo): Capability[] {
    return detectLlamaServerCapabilities(model);
  }

  async buildLaunch(ctx: LaunchContext): Promise<LaunchCommand> {
    return buildLlamaServerLaunch(ctx);
  }

  async isReady(instance: InstanceView, base: string): Promise<boolean> {
    return isLlamaServerReady(instance, base);
  }

  async fetchRuntimeInfo(base: string): Promise<RuntimeInfo | null> {
    return fetchLlamaServerRuntimeInfo(base);
  }

  classifyLog(line: string): LogClassification {
    return classifyLlamaServerLog(line);
  }

  /**
   * Engine-specific validation (beyond the schema types): the model file
   * and any speculative (draft) model must exist on disk.
   */
  validate(_model: ModelInfo, cfg: ResolvedConfig): string[] {
    const problems: string[] = [];
    const modelPath = valueOf(cfg, "model");
    if (
      typeof modelPath === "string" &&
      modelPath.length > 0 &&
      !existsSync(modelPath)
    ) {
      problems.push(`model: the file does not exist: ${modelPath}`);
    }
    const specModel = valueOf(cfg, "spec-model");
    if (
      typeof specModel === "string" &&
      specModel.length > 0 &&
      !existsSync(specModel)
    ) {
      problems.push(`spec-model: the draft model does not exist: ${specModel}`);
    }
    const port = valueOf(cfg, "port");
    if (typeof port === "number" && (port < 1024 || port > 65535)) {
      problems.push("port: must be in the range 1024–65535");
    }
    return problems;
  }

  /**
   * Binary check (ONB-2): exists, executable, `--version` exit 0 with a
   * `version:` line, and libvulkan linkage (`ldd`/`readelf`).
   */
  async checkBinary(binary: string): Promise<BinaryCheckResult> {
    const result: BinaryCheckResult = {
      binary,
      exists: false,
      executable: false,
      versionOk: false,
      vulkan: false,
      errors: [],
    };
    result.exists = existsSync(binary);
    if (!result.exists) {
      result.errors.push(`the binary does not exist: ${binary}`);
      return result;
    }
    try {
      accessSync(binary, constants.X_OK);
      result.executable = true;
    } catch {
      result.errors.push(`the binary is not executable: ${binary}`);
      return result;
    }
    const version = await runCommand(binary, ["--version"], 5_000);
    if (version.exitCode !== 0) {
      result.errors.push(
        `--version failed (exit ${version.exitCode}): ${version.stderr.trim().slice(0, 200)}`,
      );
      return result;
    }
    result.versionOk = true;
    // llama.cpp logs (including the version line) to stderr.
    const line = (version.stdout + "\n" + version.stderr)
      .split("\n")
      .find((l) => /version/i.test(l));
    if (line) result.versionLine = line.trim();
    result.vulkan = await detectsVulkanLinkage(binary);
    return result;
  }

  /**
   * Environment check before launch (PLAN §10.5):
   * 1. binary exists + executable + `--version` ok,
   * 2. port free (bind test),
   * 3. model file exists,
   * 4. if `gpu-layers > 0` — the build must be Vulkan; a missing RADV marker
   *    in `--version` output is a warning only (never blocks launch).
   */
  async preflight(ctx: LaunchContext): Promise<PreflightResult> {
    const errors: PreflightIssue[] = [];
    const warnings: PreflightIssue[] = [];

    const check = await this.checkBinary(ctx.binary);
    if (check.errors.length > 0) {
      errors.push({
        code: "ENGINE_BINARY_INVALID",
        message: check.errors.join("; "),
      });
    }
    const vulkan = check.vulkan;

    if (!existsSync(ctx.modelPath)) {
      errors.push({
        code: "MODEL_NOT_FOUND",
        message: `the model file does not exist: ${ctx.modelPath}`,
      });
    }

    const port = Number(ctx.params.port);
    const host =
      typeof ctx.params.host === "string" ? ctx.params.host : "127.0.0.1";
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push({
        code: "VALIDATION_FAILED",
        message: `port: invalid value (${String(ctx.params.port)})`,
      });
    } else if (!(await portIsFree(host, port))) {
      errors.push({
        code: "PORT_IN_USE",
        message: `the port is already in use: ${host}:${port}`,
      });
    }

    const gpu = ctx.params["gpu-layers"];
    const wantsGpu = (typeof gpu === "number" && gpu > 0) || gpu === "all";
    if (wantsGpu && !vulkan) {
      errors.push({
        code: "ENGINE_BINARY_INVALID",
        message:
          "the binary does not look like a Vulkan build (-DGGML_VULKAN=1) — " +
          "change the path in Settings, or set gpu-layers=0 (CPU)",
      });
    }
    if (
      typeof gpu === "number" &&
      gpu > 0 &&
      !/radv/i.test(check.versionLine ?? "")
    ) {
      warnings.push({
        code: "GPU_MARKER",
        message:
          "no `radv` marker in the `--version` output — the GPU device may not have been " +
          "detected (informational, does not block launch)",
      });
    }

    return { ok: errors.length === 0, errors, warnings };
  }
}
