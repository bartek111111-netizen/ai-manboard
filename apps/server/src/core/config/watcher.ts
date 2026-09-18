/**
 * On-disk config watch (P-12, Faza 1.6): if the user edits a config file
 * while the dashboard runs, fs `watch` + debounce → reload + UI warning
 * (never silent). Own writes through the API also fire fs events; the
 * consumer compares a snapshot hash and ignores no-op events.
 */
import { watch, type FSWatcher } from "node:fs";
import type { ConfigStore } from "./store.js";

export interface ConfigChangeEvent {
  /** ISO timestamp of the dispatched (debounced) event. */
  changeAt: string;
}

export interface ConfigWatcherOptions {
  /** Debounce window in ms (default 250). */
  debounceMs?: number;
}

export class ConfigWatcher {
  private watchers: FSWatcher[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  constructor(
    private readonly store: ConfigStore,
    private readonly onChange: (event: ConfigChangeEvent) => void,
    options?: ConfigWatcherOptions,
  ) {
    this.debounceMs = options?.debounceMs ?? 250;
  }

  /** Starts non-recursive watchers on `config/` and each subdirectory. */
  start(): void {
    const dirs = [
      this.store.home.configDir,
      this.store.home.enginesDir,
      this.store.home.modelsDir,
      this.store.home.presetsDir,
    ];
    for (const dir of dirs) {
      // Node 26 fs.watch: listener is (eventType: 'change' | 'rename', filename).
      const watcher = watch(dir, () => this.schedule());
      watcher.on("error", (err: Error) => {
        console.error(
          `[dashboard] config watch error on ${dir}: ${err.message}`,
        );
      });
      this.watchers.push(watcher);
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }

  /** Collapses a burst of fs events into a single debounced callback. */
  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onChange({ changeAt: new Date().toISOString() });
    }, this.debounceMs);
  }
}
