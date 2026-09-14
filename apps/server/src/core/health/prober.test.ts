import { describe, expect, it, vi } from 'vitest';
import type { RuntimeInfo } from '@ai-dashboard/shared';
import { HealthProber, PROBER_DEFAULTS, type ProbeSource } from './prober.js';

function sourceOf(ready: () => boolean, runtime: () => RuntimeInfo | null = () => ({ extras: {} })): ProbeSource {
  return {
    isReady: async () => ready(),
    runtime: async () => runtime(),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('HealthProber', () => {
  describe('waitReady (readiness, start)', () => {
    it('resolves ok on the first probe when the backend is ready', async () => {
      const prober = new HealthProber({ startupIntervalMs: 5, startupTimeoutMs: 50 });
      const outcome = await prober.waitReady(sourceOf(() => true), 'http://127.0.0.1:8080');
      expect(outcome.ok).toBe(true);
      expect(outcome.attempts).toBe(1);
      expect(typeof outcome.elapsedMs).toBe('number');
    });

    it('times out when the backend never answers', async () => {
      const prober = new HealthProber({ startupIntervalMs: 5, startupTimeoutMs: 30 });
      const outcome = await prober.waitReady(sourceOf(() => false), 'http://127.0.0.1:8080');
      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe('timeout');
      expect(outcome.attempts).toBeGreaterThan(1);
    });

    it('waits until the backend becomes ready (eventual success)', async () => {
      const prober = new HealthProber({ startupIntervalMs: 5, startupTimeoutMs: 200 });
      let n = 0;
      const outcome = await prober.waitReady(
        sourceOf(() => {
          n += 1;
          return n >= 3;
        }),
        'http://127.0.0.1:8080',
      );
      expect(outcome.ok).toBe(true);
      expect(outcome.attempts).toBe(3);
    });
  });

  describe('startRuntime (continuous)', () => {
    it('fires onHang after runtimeFailThreshold consecutive failures', async () => {
      const prober = new HealthProber({ runtimeIntervalMs: 10, runtimeFailThreshold: 3 });
      let hung = 0;
      const handle = prober.startRuntime(sourceOf(() => false), 'http://x', {
        onHang: () => {
          hung += 1;
        },
      });
      await vi.waitFor(() => expect(hung).toBe(1));
      expect(hung).toBe(1);
      handle.stop();
    });

    it('resets the failure counter on a ready response (no hang on intermittent fails)', async () => {
      const prober = new HealthProber({ runtimeIntervalMs: 10, runtimeFailThreshold: 3 });
      let hung = 0;
      let n = 0;
      const handle = prober.startRuntime(
        sourceOf(() => {
          n += 1;
          return n % 3 !== 0; // fails once every three ticks — never 3 in a row
        }),
        'http://x',
        { onHang: () => { hung += 1; } },
      );
      await sleep(150);
      expect(hung).toBe(0);
      handle.stop();
    });

    it('reports runtime data to onTick when ready', async () => {
      const prober = new HealthProber({ runtimeIntervalMs: 5, runtimeFailThreshold: 3 });
      const ticks: Array<{ ready: boolean; runtime: RuntimeInfo | null }> = [];
      const handle = prober.startRuntime(
        sourceOf(() => true, () => ({ slots: { total: 1, used: 0 }, extras: {} })),
        'http://x',
        {
          onHang: () => {},
          onTick: (ready, runtime) => {
            ticks.push({ ready, runtime });
          },
        },
      );
      await vi.waitFor(() => expect(ticks.length).toBeGreaterThan(0));
      expect(ticks[0].ready).toBe(true);
      expect(ticks[0].runtime?.slots).toEqual({ total: 1, used: 0 });
      handle.stop();
    });

    it('stop() prevents onHang even when the backend keeps failing', async () => {
      const prober = new HealthProber({ runtimeIntervalMs: 10, runtimeFailThreshold: 3 });
      let hung = 0;
      const handle = prober.startRuntime(sourceOf(() => false), 'http://x', {
        onHang: () => {
          hung += 1;
        },
      });
      await sleep(15); // ~1 tick
      handle.stop();
      await sleep(120);
      expect(hung).toBe(0);
    });
  });

  describe('defaults', () => {
    it('defaults mirror global.monitoring (5 s runtime, 120 s startup, 3× fail)', () => {
      const prober = new HealthProber();
      expect(prober.options.runtimeIntervalMs).toBe(5000);
      expect(prober.options.startupTimeoutMs).toBe(120_000);
      expect(prober.options.runtimeFailThreshold).toBe(3);
      expect(PROBER_DEFAULTS.runtimeIntervalMs).toBe(5000);
    });
  });
});
