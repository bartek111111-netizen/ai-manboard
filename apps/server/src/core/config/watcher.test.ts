import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureHome, resolveHome } from "./paths.js";
import { ConfigStore } from "./store.js";
import { ConfigWatcher } from "./watcher.js";

describe("ConfigWatcher (Faza 1.6: fs watch + debounce, P-12)", () => {
  it("fires the callback after a debounce window following an on-disk change", async () => {
    const root = mkdtempSync(join(tmpdir(), "ai-dashboard-watch-"));
    const home = resolveHome(root);
    ensureHome(home);
    const store = new ConfigStore(home);
    store.readGlobal(); // seed

    const events: string[] = [];
    const watcher = new ConfigWatcher(
      store,
      (event) => events.push(event.changeAt),
      { debounceMs: 100 },
    );
    watcher.start();
    // inotify registers asynchronously — give it a moment before the "user" edit.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // External change (as if the user edited the file with their editor).
    writeFileSync(
      join(home.modelsDir, "ext-model.json"),
      JSON.stringify({
        version: 1,
        tags: [],
        capabilities: {},
        params: {},
      }),
    );

    // Wait past the debounce window.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(events.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(events[0]))).toBe(false);

    // Debounce: a burst of events collapses into one callback.
    const before = events.length;
    writeFileSync(join(home.modelsDir, "burst-a.json"), "{}");
    writeFileSync(join(home.modelsDir, "burst-b.json"), "{}");
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(events.length - before).toBe(1);

    watcher.stop();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = events.length;
    writeFileSync(join(home.modelsDir, "post-stop.json"), "{}");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(events.length).toBe(after); // stopped watcher stays silent
  }, 10000);
});
