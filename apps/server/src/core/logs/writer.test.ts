import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LogWriter } from "./writer.js";

/** A throwaway logs/ root under /tmp. */
function tempLogs(
  opts: Partial<{ retentionFiles: number; maxFileBytes: number }> = {},
): LogWriter {
  const dir = mkdtempSync(join(tmpdir(), "ai-dashboard-logs-"));
  return new LogWriter({
    logsDir: dir,
    retentionFiles: opts.retentionFiles ?? 10,
    maxFileBytes: opts.maxFileBytes ?? 10 * 1024 * 1024,
  });
}

describe("LogWriter (PLAN §13, FMK-3)", () => {
  it("start() creates a per-instance log file; append() writes lines", () => {
    const writer = tempLogs();
    const file = writer.start("m--szybka", "1720000000");
    expect(file.endsWith(".log")).toBe(true);
    expect(existsSync(file)).toBe(true);
    writer.append(file, "server is listening on :8081");
    writer.append(file, "loaded model in 120 ms");
    const content = readFileSync(file, "utf8");
    expect(content).toContain("server is listening on :8081");
    expect(content).toContain("loaded model in 120 ms");
  });

  it("prune() keeps only the newest retentionFiles files (readable per-start names)", () => {
    const writer = tempLogs({ retentionFiles: 3 });
    // Five starts in DISTINCT minutes → each file gets its own readable
    // `<preset>-<YYYY-MM-DD_HH-mm-ss>.log` stamp (no collision counter).
    const created: string[] = [];
    for (const ts of [
      1720000000000, 1720000060000, 1720000120000, 1720000180000, 1720000240000,
    ]) {
      created.push(writer.start("m--szybka", String(ts)));
    }
    // The new naming is human-readable: preset + a sortable date stamp.
    const name = (p: string): string => p.split("/").pop()!;
    expect(name(created[0])).toMatch(
      /^szybka-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log$/,
    );
    const files = readdirSync(writer.instanceDir("m--szybka")).filter((f) =>
      f.endsWith(".log"),
    );
    // 5 files created → keep the newest 3.
    expect(files).toHaveLength(3);
    // The three newest (last created) survive; the two oldest are pruned.
    expect(files.sort()).toEqual(created.slice(2).map(name).sort());
    expect(files).not.toContain(name(created[0]));
    expect(files).not.toContain(name(created[1]));
  });

  it("append() truncates a file that would exceed maxFileBytes", () => {
    const writer = tempLogs({ maxFileBytes: 64 });
    const file = writer.start("m--big", "1720000000");
    writer.append(file, "x".repeat(40));
    writer.append(file, "y".repeat(40)); // would exceed 64 bytes → truncate first
    const content = readFileSync(file, "utf8");
    expect(content).toContain("[log truncated");
    // After truncation the cap holds the marker + the appended line, not 80 chars of x/y.
    expect(content.length).toBeLessThan(40 + 40 + 40);
  });

  it("is idempotent about a missing instance dir (prune before any start)", () => {
    const writer = tempLogs();
    // prune with no files yet must not throw
    expect(() => writer.prune("never-started")).not.toThrow();
  });
});
