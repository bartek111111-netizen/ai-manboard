import { mkdtempSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LaunchCommand } from "@ai-dashboard/shared";
import {
  ensureHome,
  resolveHome,
  type DashboardHome,
} from "../config/paths.js";
import { LogWriter } from "../logs/writer.js";
import { ProcessManager } from "./manager.js";
import { PidRegistry } from "./registry.js";

/** A throwaway `~/.ai-dashboard` under /tmp, with a manager wired to it. */
function tempManager(stopTimeoutSec = 3): {
  manager: ProcessManager;
  registry: PidRegistry;
  home: DashboardHome;
} {
  const root = mkdtempSync(join(tmpdir(), "ai-dashboard-manager-"));
  const home = resolveHome(root);
  ensureHome(home);
  const registry = new PidRegistry(home);
  const logs = new LogWriter({
    logsDir: home.logsDir,
    retentionFiles: 10,
    maxFileBytes: 10 * 1024 * 1024,
  });
  const manager = new ProcessManager({
    registry,
    logs,
    stopTimeoutSec,
    ringLines: 100,
  });
  return { manager, registry, home };
}

/** Runs `node -e <code>` as the dummy instance process (cross-platform). */
const dummy = (cwd: string, code: string): LaunchCommand => ({
  binary: process.execPath,
  args: ["-e", code],
  cwd,
  env: {},
});

/** Polls until `predicate` is true or `timeoutMs` elapses. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("ProcessManager (PLAN §11.5, §11.2, TT-9)", () => {
  it("spawn → starting; stop → stopped (grace), and the child is gone", async () => {
    const { manager, registry, home } = tempManager();
    const pid = await manager.spawn(
      "m--x",
      dummy(home.root, "setTimeout(()=>{},60000)"),
      8081,
    );
    expect(pid).toBeGreaterThan(0);
    expect(manager.getState("m--x")).toBe("starting");
    expect(registry.get("m--x")?.state).toBe("starting");

    await manager.stop("m--x");
    expect(manager.getState("m--x")).toBe("stopped");
    expect(registry.get("m--x")?.state).toBe("stopped");
    // The child no longer exists (ESRCH on a kill probe).
    let dead = true;
    try {
      process.kill(pid, 0);
      dead = false;
    } catch {
      /* ESRCH = gone */
    }
    expect(dead).toBe(true);
  });

  it("watchdog: a process that exits abnormally (code ≠ 0) → crashed", async () => {
    const { manager, registry, home } = tempManager();
    await manager.spawn("m--crash", dummy(home.root, "process.exit(3)"), 8081);
    await manager.awaitExit("m--crash", 5000);
    expect(manager.getState("m--crash")).toBe("crashed");
    expect(registry.get("m--crash")?.lastExitCode).toBe(3);
  });

  it("records lastExitCode and lands on stopped for a clean self-exit", async () => {
    const { manager, registry, home } = tempManager();
    await manager.spawn("m--clean", dummy(home.root, "process.exit(0)"), 8081);
    await manager.awaitExit("m--clean", 5000);
    expect(manager.getState("m--clean")).toBe("stopped");
    expect(registry.get("m--clean")?.lastExitCode).toBe(0);
  });

  it("spawn failure (missing binary) settles on error", async () => {
    const { manager, home } = tempManager();
    await manager.spawn(
      "m--bad",
      { binary: "/nonexistent/binary", args: [], cwd: home.root, env: {} },
      8081,
    );
    await manager.awaitExit("m--bad", 4000);
    expect(["error", "crashed"]).toContain(manager.getState("m--bad"));
  });

  it("captures stdout/stderr into the ring buffer and the disk log", async () => {
    const { manager, home } = tempManager();
    await manager.spawn(
      "m--logs",
      dummy(
        home.root,
        "console.log('hello'); console.error('oops'); setTimeout(()=>{},3000)",
      ),
      8081,
    );
    await waitFor(() => manager.getLogs("m--logs").length >= 2, 4000);
    const lines = manager.getLogs("m--logs").map((l) => l.line);
    expect(lines).toContain("hello");
    expect(lines).toContain("oops");
    await manager.stop("m--logs");
  });

  it("background mode: the engine writes to the log file and the file-tail feeds the ring", async () => {
    const { manager, registry, home } = tempManager();
    await manager.spawn(
      "m--bg",
      dummy(
        home.root,
        "console.log('bg-1'); console.log('bg-2'); setTimeout(()=>{},4000)",
      ),
      8081,
      "background",
    );
    // The file-tail (500ms poll) picks the lines up into the ring.
    await waitFor(() => manager.getLogs("m--bg").length >= 2, 4000);
    const lines = manager.getLogs("m--bg").map((l) => l.line);
    expect(lines).toContain("bg-1");
    expect(lines).toContain("bg-2");
    expect(registry.get("m--bg")?.mode).toBe("background");
    await manager.stop("m--bg");
  });

  it("session mode: the engine writes to the dashboard pipes (and the file is appended)", async () => {
    const { manager, registry, home } = tempManager();
    await manager.spawn(
      "m--sess",
      dummy(home.root, "console.log('sess-1'); setTimeout(()=>{},4000)"),
      8081,
      "session",
    );
    await waitFor(() => manager.getLogs("m--sess").length >= 1, 4000);
    const lines = manager.getLogs("m--sess").map((l) => l.line);
    expect(lines).toContain("sess-1");
    expect(registry.get("m--sess")?.mode).toBe("session");
    await manager.stop("m--sess");
  });

  it("background mode: the child writes to the log file (its stdio is a file, not a pipe)", async () => {
    // Linux-only: the survival hinges on the child's stdout being the log FILE
    // (not the dashboard's pipe) — so a dashboard exit can't SIGPIPE it — and
    // on the child being detached (own process group, so Ctrl-C can't reach it).
    if (process.platform !== "linux") return;
    const { manager, home } = tempManager();
    const pid = await manager.spawn(
      "m--survive",
      dummy(home.root, "setTimeout(()=>{},60000)"),
      8081,
      "background",
    );
    // Let the child fully spawn (so /proc/<pid>/fd/1 exists).
    await waitFor(() => {
      try {
        readlinkSync(`/proc/${pid}/fd/1`);
        return true;
      } catch {
        return false;
      }
    }, 2000);
    const stdoutTarget = readlinkSync(`/proc/${pid}/fd/1`);
    // Its stdout is the log file (a real path under the logs dir), not a pipe.
    expect(stdoutTarget).not.toContain("/pipe:");
    expect(stdoutTarget).toContain(".log");
    await manager.stop("m--survive");
  });

  it("adopts a background instance's log file after a dashboard restart (new manager tails the file)", async () => {
    const { manager, registry, home } = tempManager();
    const published: string[] = [];
    // "Dashboard" #1: spawn a long-running background engine that keeps logging.
    const pid = await manager.spawn(
      "m--adopt",
      dummy(
        home.root,
        "let n=0; setInterval(()=>{console.log('tick-'+(++n));},200); setTimeout(()=>{},60000);",
      ),
      8081,
      "background",
    );
    expect(pid).toBeGreaterThan(0);
    await waitFor(() => manager.getLogs("m--adopt").length >= 2, 5000);

    // "Dashboard restart": a brand-new manager (fresh in-memory state) over
    // the same home. The registry entry is still `starting`/`running` and the
    // PID is alive — reconcile settles it back to `running` on boot.
    const manager2 = new ProcessManager({
      registry,
      logs: new LogWriter({
        logsDir: home.logsDir,
        retentionFiles: 10,
        maxFileBytes: 10 * 1024 * 1024,
      }),
      ringLines: 100,
      onLogLine: (_id, line) => published.push(line.line),
    });
    expect(manager2.getLogs("m--adopt")).toEqual([]); // fresh process: no ring yet
    const attached = manager2.adoptLogTails(registry);
    expect(attached).toContain("m--adopt");
    // The ring is seeded from the file AND keeps streaming new lines — that
    // is what feeds the Logi tab (SSE replay + live lines) after a restart.
    await waitFor(() => manager2.getLogs("m--adopt").length >= 3, 5000);
    const lines = manager2.getLogs("m--adopt").map((l) => l.line);
    expect(lines.some((l) => l.startsWith("tick-"))).toBe(true);
    // The onLogLine hook fires too (the SSE publisher subscribes to it).
    expect(published.some((l) => l.startsWith("tick-"))).toBe(true);
    await manager.stop("m--adopt"); // the FIRST manager still owns the child
  });

  it("session mode: the child writes to the dashboard pipes (its stdio is a pipe)", async () => {
    if (process.platform !== "linux") return;
    const { manager, home } = tempManager();
    const pid = await manager.spawn(
      "m--sess2",
      dummy(home.root, "setTimeout(()=>{},60000)"),
      8081,
      "session",
    );
    await waitFor(() => {
      try {
        readlinkSync(`/proc/${pid}/fd/1`);
        return true;
      } catch {
        return false;
      }
    }, 2000);
    const stdoutTarget = readlinkSync(`/proc/${pid}/fd/1`);
    // Its stdout is the dashboard's pipe/socket, NOT the log file.
    expect(stdoutTarget).not.toContain(".log");
    await manager.stop("m--sess2");
  });
});
