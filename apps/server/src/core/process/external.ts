/**
 * External-instance detection — finds engine processes (e.g. `llama-server`)
 * running on the host that the dashboard did NOT launch, and captures their
 * settings (the full command line), port, memory and start time.
 *
 * How it works (PLAN §16.4, "external" section):
 *  1. Scan `/proc/<pid>/cmdline` for processes whose `argv[0]` is one of the
 *     registered engine binaries.
 *  2. Exclude the PIDs the dashboard manages itself (the registry) — what
 *     remains were launched from outside (a script, a terminal, …).
 *  3. Enrich each with `/v1/models` (model name / context / quant), RSS, the
 *     uptime, and the system GPU.
 *
 * The `/proc` read and the `ps` call are isolated so they can be injected in
 * tests (the real app runs on the host, where `/proc` is visible).
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { execSync } from "node:child_process";

export interface ExternalProcessInfo {
  pid: number;
  /** The full `argv` of the process. */
  cmdline: string[];
  /** Parsed `--key → value` args (both `--k=v` and `--k v` forms). */
  args: Record<string, string>;
  modelPath: string | null;
  port: number | null;
  host: string;
}

/**
 * Parses an engine `argv` into a `--key → value` map. Handles both
 * `--key=value` and `--key value` (the value is the next token, when it is not
 * another flag). The binary path (`argv[0]`) is skipped.
 */
export function parseCliArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 1; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const eq = tok.indexOf("=");
    if (eq >= 0) {
      args[tok.slice(2, eq)] = tok.slice(eq + 1);
    } else {
      const key = tok.slice(2);
      const val = argv[i + 1];
      if (val !== undefined && !val.startsWith("--")) {
        args[key] = val;
        i++;
      }
    }
  }
  return args;
}

/**
 * Scans the process table for engine processes. `binaryBases` are the basenames
 * of the registered engine binaries (e.g. `llama-server`); a process matches
 * when its `argv[0]` basename is in that set. `procRoot` is overridable for
 * tests (defaults to the real `/proc`).
 */
export function scanEngineProcesses(
  binaryBases: string[],
  procRoot = "/proc",
): ExternalProcessInfo[] {
  const baseSet = new Set(binaryBases.map((b) => b.replace(/\.exe$/i, "")));
  let dirs: string[];
  try {
    dirs = readdirSync(procRoot);
  } catch {
    return [];
  }
  const out: ExternalProcessInfo[] = [];
  for (const dir of dirs) {
    if (!/^\d+$/.test(dir)) continue;
    let raw: string;
    try {
      raw = readFileSync(`${procRoot}/${dir}/cmdline`, "utf8");
    } catch {
      continue;
    }
    const cmdline = raw.split("\0").filter((s) => s.length > 0);
    const base = basename(cmdline[0] ?? "").replace(/\.exe$/i, "");
    if (cmdline.length < 2 || !baseSet.has(base)) continue;
    const args = parseCliArgs(cmdline);
    out.push({
      pid: Number(dir),
      cmdline,
      args,
      modelPath: args.model ?? null,
      port:
        args.port !== undefined && Number.isFinite(Number(args.port))
          ? Number(args.port)
          : null,
      host: args.host ?? "127.0.0.1",
    });
  }
  return out;
}

/** Reads the process's RSS in MB from `/proc/<pid>/status` (`VmRSS`); null when absent. */
export function readRssMB(pid: number, procRoot = "/proc"): number | null {
  try {
    const status = readFileSync(`${procRoot}/${pid}/status`, "utf8");
    const m = status.match(/VmRSS:\s+(\d+)\s+kB/);
    return m ? Math.round(Number(m[1]) / 1024) : null;
  } catch {
    return null;
  }
}

/** The process's elapsed seconds via `ps -o etimes=`; null when `ps` is unavailable. */
export function readUptimeSec(
  pid: number,
  exec: (cmd: string) => string = defaultExec,
): number | null {
  try {
    const out = exec(`ps -o etimes= -p ${pid}`).trim();
    const n = Number(out);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function defaultExec(cmd: string): string {
  return execSync(cmd, { timeout: 3000 }).toString();
}

/**
 * A detected external instance: the process info + the captured settings (args)
 * + the enrichment (model from `/v1/models`, memory, GPU) + the dashboard match
 * (the registered instance it corresponds to, when it can be identified).
 */
export interface ExternalInstanceView {
  detected: "external";
  pid: number;
  cmdline: string[];
  /** The captured `--key → value` settings. */
  params: Record<string, string>;
  modelPath: string | null;
  port: number | null;
  host: string;
  rssMB: number | null;
  uptimeSec: number | null;
  /** Enrichment from `/v1/models` (the live server's self-report). */
  modelName: string | null;
  contextSize: number | null;
  quantization: string | null;
  gpu: unknown | null;
  /** The registered instance it maps to (null when not recognized). */
  instanceId: string | null;
  modelId: string | null;
  preset: string | null;
}
