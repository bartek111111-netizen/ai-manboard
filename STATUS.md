# STATUS

## Faza 2 — Abstrakcja engine + schemat llama-server — ✅ ZROBIONE

Działa: abstrakcja engine (PLAN §7): `packages/shared/engine/types.ts`
(interfejs `InferenceEngine` + typy: `ParamSchema`, `LaunchCommand`,
`RuntimeInfo`, `PreflightResult`, `BinaryCheckResult`) + registry
(`registerEngine`/`getEngine`/`listEngines`; moduły engine eksportowane
podsubpath `@ai-dashboard/shared/engine` — kod node'owy nie trafia do bundla
web); moduł `llama-server`: `schema.ts` (29 parametrów z tabeli §10.1, grupy
UI, polskie etykiety; bool-flagi z `offFlag`/`offValue`: `--no-slots`,
`--no-ui`, `--fit off`), `args.ts` (`buildLaunch`: reguła „flag tylko gdy
różni się od domyślnej", `--model/--host/--port` zawsze, `cwd` = katalog
modelu), `logpatterns.ts` (klasyfikacja: RADV=znane ostrzeżenie, OOM/CUDA/
Vulkan=error, ready-markery: `server is listening` / `all slots are idle`),
`probe.ts` (`/v1/models` = readiness; runtime: `/slots`, `/health`,
`/metrics` → `extras`), `index.ts` (`validate`: model/spec-model muszą istnieć,
port 1024–65535; `checkBinary`: exists → X_OK → `--version` exit 0 + linia
`version:` (llama.cpp loguje do **stderr**) → libvulkan przez `ldd`/`readelf`;
`preflight`: binarka → model → port (bind test) → gpu-layers>0 wymaga builda
Vulkan, brak `radv` w `--version` = ostrzeżenie GPU_MARKER, nie blokuje).
Warstwa 1 (schema-defaults) dołączyła do `buildEffective` (`source: 'schema'`).
API: `GET /api/v1/engines` (lista + `binary`/`binarySource`: engine → global),
`GET /engines/:id/schema`, `PUT /engines/:id` (walidacja binarki `ENGINE_BINARY_INVALID`
+ parametrów `VALIDATION_FAILED`, zapis `config/engines/<id>.json`). Testy:
snapshot komendy presetu „szybka" = komenda z §10.1 **do znaku** (`--model
/mnt/dane/Modele/llama-3-8b-instruct.Q8_0.gguf --host 127.0.0.1 --port 8081
--ctx-size 4096 --n-gpu-layers 32 --threads 8 --temp 0.7 --top-p 0.8 --top-k
20 --n-predict 512 --metrics --offline`); weryfikacja z realną binarką
(67672dc5): wszystkie emitowane flagi w `--help`, pełna grupa argumentów
parsuje się bez „unknown argument" (osiąga załadowanie modelu), `PUT` z
`~/llama.cpp/build/bin/llama-server` → `versionLine: version: 0.4.0-dev
(build 1316, commit 67672dc5)` + `vulkan: true`. 36/36 (shared) + 32/32
(server) zielone.

**Dalej:** Faza 3 — Model Management (discovery, metadata GGUF,
capabilities, ręczne dodawanie) + warstwa 6 (instance overrides) do
`buildEffective`.

## Faza 1 — Storage + Configuration — ✅ ZROBIONE

Działa: warstwa storage/configu (§9.3/§9.4): `ConfigStore` z atomowym zapisem
JSON (tmp → fsync → rename) + kopia `.bak` do `.backups/` + walidacja plików
(`CONFIG_INVALID`, koryguje brak `version` v0→v1, id bez `../`); seed
`global.json` przy pierwszym starcie (reguła §15: uszkodzony config = twardy
błąd startu, nigdy ciche nadpisanie); `layers.ts` — merge warstw
(global → engine → model → preset) z `source` per wartość (FC-5 "skąd");
API `GET /api/v1/config` (wszystkie warstwy + `effective` + stan watcha) i
`PUT /api/v1/config/global` (merge + walidacja + atomowy zapis); fs `watch`
(4 katalogi, debounce 250 ms) → reload z ostrzeżeniem w UI (P-12): sekcja
"Konfiguracja" na stronie statusu pokazuje home, aktywność watcha, ostatnią
zewnętrzną zmianę, licznik reloadów i błąd (jeśli był) — odświeżanie co 5 s.
Uwaga: zmiana `server.host/port` w `global.json` nie restartuje nasłuchu
(boot nadal z env; sekcja jest przechowywana i walidowana). Testy 24/24
(server) + 12/12 (shared) zielone; weryfikacja na żywo: seed, PUT, zewnętrzna
zmiana pliku → `reloadCount=1` + `effective` z poprawnymi `source`.

**Dalej:** Faza 2 — Abstrakcja engine + schemat llama-server
(`shared/engine`: interfejs §7.1, registry, `schema.ts` tabela §10.1,
`args.ts` buildLaunch) + warstwy 1 (schema-defaults) i 6 (instance) do
`buildEffective`.

## Faza 0 — Skeleton — ✅ ZROBIONE

Działa: monorepo (npm workspaces: `packages/shared`, `apps/server`, `apps/web`)
z TypeScript strict, ESLint + Prettier; serwer (Fastify: `GET /api/v1/status`,
`/healthz`, statyczny frontend po `npm run build`); web (React + routing hash +
layout + panel statusu API) z UI po polsku przez moduł i18n
(`apps/web/src/i18n` — słownik `pl`, funkcja `t()`). `npm run dev` zweryfikowane:
serwer `127.0.0.1:3100` + Vite `localhost:5173` (proxy `/api` działa; Vite 8
nasłuchuje tylko na IPv6/`localhost`). Testy 2/2 zielone, typecheck i lint czyste.

**Dalej:** Faza 1 — Storage + Configuration (config store z zapisem atomowym,
schematy `global.json`, warstwy merge, API `/config`).
