import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ConfigWatchState } from "@ai-dashboard/shared";
import { buildApp } from "../../app.js";
import { ensureHome, resolveHome } from "../../core/config/paths.js";
import { ConfigStore } from "../../core/config/store.js";

async function tempApp() {
  const dir = mkdtempSync(join(tmpdir(), "ai-dashboard-models-"));
  const home = resolveHome(join(dir, ".ai-dashboard"));
  ensureHome(home);
  const store = new ConfigStore(home);
  const configState: ConfigWatchState = {
    home: home.root,
    watchActive: true,
    lastExternalChangeAt: null,
    reloadCount: 0,
    lastReloadError: null,
  };
  const app = await buildApp({ store, getConfigState: () => configState });
  return { app, dir };
}

describe("models endpoints (PLAN §14.1)", () => {
  it("GET /api/v1/models returns an empty list initially", async () => {
    const { app } = await tempApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/models" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ models: [] });
    await app.close();
  });

  it("POST /api/v1/models adds a model, then GET/:id, PATCH, DELETE", async () => {
    const { app, dir } = await tempApp();
    const file = join(dir, "my-model.gguf");
    writeFileSync(file, "gguf-bytes");

    const add = await app.inject({
      method: "POST",
      url: "/api/v1/models",
      payload: { path: file, engineId: "llama-server" },
    });
    expect(add.statusCode).toBe(201);
    const added = add.json();
    expect(added.origin).toBe("manual");
    expect(added.path).toBe(file);

    const get = await app.inject({
      method: "GET",
      url: `/api/v1/models/${added.id}`,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().id).toBe(added.id);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/models/${added.id}`,
      payload: { capabilities: { text: true, vision: true } },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().capabilities.source).toBe("manual");

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/models/${added.id}`,
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);

    const after = await app.inject({ method: "GET", url: "/api/v1/models" });
    expect(after.json().models).toEqual([]);
    await app.close();
  });

  it("POST /api/v1/models rejects a non-existent file", async () => {
    const { app } = await tempApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/models",
      payload: { path: "/no/such/file.gguf", engineId: "llama-server" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it("GET /api/v1/models/:id returns 404 for an unknown id", async () => {
    const { app } = await tempApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/models/unknown-id",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("POST /api/v1/models/discover returns added/removed/total", async () => {
    const { app } = await tempApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/models/discover",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("added");
    expect(body).toHaveProperty("removed");
    expect(body).toHaveProperty("total");
    await app.close();
  });

  it("PATCH /api/v1/models/:id/last-used records the last used preset", async () => {
    const { app, dir } = await tempApp();
    const file = join(dir, "my-model.gguf");
    writeFileSync(file, "gguf-bytes");

    const add = await app.inject({
      method: "POST",
      url: "/api/v1/models",
      payload: { path: file, engineId: "llama-server" },
    });
    const id = add.json().id as string;

    const setLast = await app.inject({
      method: "PATCH",
      url: `/api/v1/models/${id}/last-used`,
      payload: { preset: "gpu" },
    });
    expect(setLast.statusCode).toBe(200);
    expect(setLast.json().lastUsedPreset).toBe("gpu");

    // The value is persisted to the model config and returned by GET.
    const get = await app.inject({ method: "GET", url: `/api/v1/models/${id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json().lastUsedPreset).toBe("gpu");

    // GET /models surfaces it in the list view too.
    const list = await app.inject({ method: "GET", url: "/api/v1/models" });
    const [row] = list.json().models as Array<{ lastUsedPreset?: string }>;
    expect(row.lastUsedPreset).toBe("gpu");

    await app.close();
  });
});
