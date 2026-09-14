import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LogWriter } from './writer.js';

/** A throwaway logs/ root under /tmp. */
function tempLogs(opts: Partial<{ retentionFiles: number; maxFileBytes: number }> = {}): LogWriter {
  const dir = mkdtempSync(join(tmpdir(), 'ai-dashboard-logs-'));
  return new LogWriter({
    logsDir: dir,
    retentionFiles: opts.retentionFiles ?? 10,
    maxFileBytes: opts.maxFileBytes ?? 10 * 1024 * 1024,
  });
}

describe('LogWriter (PLAN §13, FMK-3)', () => {
  it('start() creates a per-instance log file; append() writes lines', () => {
    const writer = tempLogs();
    const file = writer.start('m--szybka', '1720000000');
    expect(file.endsWith('.log')).toBe(true);
    expect(existsSync(file)).toBe(true);
    writer.append(file, 'server is listening on :8081');
    writer.append(file, 'loaded model in 120 ms');
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('server is listening on :8081');
    expect(content).toContain('loaded model in 120 ms');
  });

  it('prune() keeps only the newest retentionFiles files', () => {
    const writer = tempLogs({ retentionFiles: 3 });
    // Simulate several past starts (zero-padded, so lexicographic = time order).
    for (const ts of ['1720000001', '1720000002', '1720000003', '1720000004', '1720000005']) {
      writer.start('m--szybka', ts);
    }
    const files = readdirSync(writer.instanceDir('m--szybka')).filter((f) => f.endsWith('.log'));
    // 5 files created → keep the newest 3.
    expect(files).toHaveLength(3);
    expect(files).toEqual(['1720000003.log', '1720000004.log', '1720000005.log']);
  });

  it('append() truncates a file that would exceed maxFileBytes', () => {
    const writer = tempLogs({ maxFileBytes: 64 });
    const file = writer.start('m--big', '1720000000');
    writer.append(file, 'x'.repeat(40));
    writer.append(file, 'y'.repeat(40)); // would exceed 64 bytes → truncate first
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('[log truncated');
    // After truncation the cap holds the marker + the appended line, not 80 chars of x/y.
    expect(content.length).toBeLessThan(40 + 40 + 40);
  });

  it('is idempotent about a missing instance dir (prune before any start)', () => {
    const writer = tempLogs();
    // prune with no files yet must not throw
    expect(() => writer.prune('never-started')).not.toThrow();
  });
});
