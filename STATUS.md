# STATUS

## Faza 5 — Health + lifecycle start/stop/restart — ✅ ZROBIONE

Działa: health + pełny lifecycle instancji (PLAN §22 5.1–5.5, §11.2, §5.3)
— start/stop/restart z prawdziwą binarką. HealthProber (5.1):
`apps/server/src/core/health/prober.ts` — `ProbeSource` (inżektowalny:
`isReady` + `runtime`), `waitReady(source, base)` = sonda readiness w tle
(interwał 2 s, budżet 120 s, `PROBER_DEFAULTS`), zwraca `ok` / `timeout`;
`startRuntime(source, base, {onHang})` = sonda **ciągła** (interwał 5 s),
3 kolejne niepowodzenia → `onHang` (wykrywanie hanga), sukces resetuje
licznik, `stop()` idempotentny. Czysty (brak HTTP wprost — testowany na
dummym). Resolver (5.2): `core/process/resolve.ts` — `InstanceResolver`
(`modelId--presetName` → `readModel`/`readPreset` 404, engine, `buildEffective`
warstwy 1–5, binary z `global.engines` po `expandHome`, port = `preset.port`
albo `allocatePort`, `host` z paramów, `engine.buildLaunch`); `resolveInstanceId`
dzieli po **pierwszym** `--`. Lifecycle (5.2): `core/process/lifecycle.ts` —
`LifecycleManager` (`listInstances`/`getState`/`start`/`stop`/`restart`/`shutdown`)
łączy resolver + `ProcessManager` + prober i **steruje FSM**: `start` = walidacja
(`engine.validate` → `VALIDATION_FAILED` 400, `engine.preflight` → `PREFLIGHT_FAILED`
400) → `manager.spawn` (stan `starting`) → tło `driveStartup`: probe OK →
`starting`→`running` (event `probe-ok`) + start pętli runtime (hang → `running`→`error`),
timeout → `starting`→`error` + `terminate` (SIGTERM→grace→SIGKILL, watchdog z
`forcedState` — celowe SIGKILL ≠ crash); `stop` = grace `manager.stop` (live) albo
`terminate` instancji `error` z żywym dzieckiem; `restart` = `stop`+`start`.
Detekcja błędów startu (5.3): `diagnose(instanceId)` → `{state, exitCode, signal,
logTail, errorLines}` (exit/signal z rejestru, tail z `LogWriter.readTail`
(dysk, przeżywa zrzut ringa po exit), `errorLines` = linie z
`engine.classifyLog(level='error')`); `LogWriter.latestFile`/`readTail` (nowszy
plik `logs/<id>/*.log`). API (5.4): `api/handlers/instances.ts` —
`makeInstanceHandlers(lifecycle)`: `GET /api/v1/instances` (lista),
`POST /api/v1/instances/:id/start` (`starting`), `…/stop` (grace → `stopped`),
`…/restart`; zarejestrowane w `app.ts` tylko gdy `lifecycle` w opcjach
(`tempApp()` bez niego nadal działa); boot `index.ts` buduje `PidRegistry`+
`LogWriter`+`ProcessManager`+`HealthProber`+`LifecycleManager` (engines z
`listEngines()`) i wiesza `lifecycle.shutdown()` na SIGINT/SIGTERM. E2E (5.5):
`tools/e2e/run-e2e.sh` (+ `run-e2e.ts`, tsx) — **prawdziwa** `llama-server`
(`~/llama.cpp/build/bin/llama-server`) + mały gguf
(`.e2e-models/SmolLM2-135M-Instruct-Q2_K.gguf`, 85 MB): start → sonda readiness
(`GET /v1/models`) → **running po 3.0 s** → stop → `stopped`, pełny lifecycle w
3.1 s, brak procesów zombie. **Uwaga zakresu:** warstwa 6 (instance overrides)
NIE w MVP — `start` używa warstw 1–5 (`buildEffective` bez warstwy 6); pełne DTO
instancji (`GET /instances/:id`, metrics, logs) = Faza 6.3. Testy (5.x):
**60 (shared) + 109 (server) = 169/169 zielone**; prober (8: readiness ok/timeout,
runtime hang 3×, stop), resolve (8: port pinned/alokacja/skip-taken, 404,
PORT_IN_USE, listIds), lifecycle (6: start→running→stop, drugi start 409, restart,
timeout→error, `diagnose` tail/error-patterns, lista), instances API (4: list,
start→running→stop→restart, 404 unknown, 409 live).

**Dalej:** Faza 6 — API + UI: `GET /instances/:id` (pełne DTO §14.2) + metrics +
logs, SSE (eventy FSM + tail logów), token/security, `InstancePanel` (start/stop/
restart + endpoint + PID + uptime) w web.

## Faza 4 — Process Manager + FSM — ✅ ZROBIONE

Działa: rdzeń zarządzania procesami (PLAN §22 4.1–4.5, §11.2–11.5, TT-9).
FSM (4.1, §11.2): `packages/shared/src/process/states.ts` — stany `starting /
running / stopping / stopped / error / crashed / unknown`, tabela
`TRANSITIONS`, `transition(state, event)` rzuca `AppError('INVALID_STATE')` na
parę spoza tabeli (bez try/catch w UI), `canTransition()`, `STABLE_STATES`
(`stopped/error/crashed`), `isLive()` (`starting/running/stopping` = trzyma
dziecko), `STATE_LABELS` po polsku (startuje/uruchomiony/zatrzymywanie/…/kraksza/
nieznany), `STATE_COLORS` → `var(--state-<s>)`. **Uwaga umieszczenia:** FSM celowo
w **shared** (nie w serverze jak w §19) — czysta logika FSM ma być współdzielona
przez FE `StatusBadge` i SSE. Manager (4.1, §11.5): `apps/server/src/core/process/
manager.ts` — `ProcessManager` per `instanceId`: `spawn(instanceId, cmd, port)`
startuje `LaunchCommand` z `stdio: ['pipe','pipe','pipe']` (własne stdio — wyjście
procesu nie wycieka do konsoli dashboardu, TT-9), zapisuje PID w rejestrze (stan
`starting`), `error` (binary brak → `error`), strumienie stdout/stderr → ring
buffer + plik na dysku (linijki z buforem nieukończonego wiersza, `flushPartial`
na końcu); `stop()` = **grace**: `SIGTERM` → czekam `stopTimeoutSec` (10 s, opcja
managera — nie w `GlobalConfig`) → `SIGKILL`; watchdog (4.2, event `exit` —
event-driven, nie polling) sam aktualizuje FSM + rejestr: czysty (code 0, bez
sygnału) → `stopped`, nieczysty → `crashed`, a gdy `stop` w toku → `stopped`;
`lastExitCode`/`lastSignal` do rejestru; `awaitExit()` do czekania.
PID registry (4.2, §11.3): `core/process/registry.ts` — `PidRegistry`,
`state/registry.json` `{instances: {<id>:{instanceId,pid,port,state,startedAt,
lastExitCode,lastSignal?}}}`, **zapis atomowy przy każdym przejściu** (tmp+fsync+
rename), uszkodzony plik → traktowany pusty (reconcile odbuduje, bez crasha boota),
`takenPorts()` = porty żywych instancji. Porty (4.3, §11.4): `core/process/ports.ts`
— `allocatePort` (pierwszy wolny w `global.portRange`, poza `taken`), `assertPortFree`
(pinned kolizja → głośne `PORT_IN_USE` ze `suggestion`), `assertValidPort` (S-9
1024–65535 → `VALIDATION_FAILED`). Logi (4.4, §13): `core/logs/ringbuffer.ts` —
`RingBuffer<T>` (fixed-size, O(1) push, `lines(limit)` = najnowsze N), `core/logs/
writer.ts` — `LogWriter` per-start `logs/<instanceId>/<epoch-ms>.log` + `prune`
(utrzymuje `retentionFiles`=10, najnowsze) + cap ~10 MB per plik (truncate z
markerem `[log truncated…`). Testy (4.5): **60 (shared) + 83 (server) = 143/143
zielone**; FSM (każde legalne przejście + guard INVALID_STATE), registry (atomic
set/update/remove/takenPorts + SAFE_ID), ports (alokacja/kolizja/valid), ringbuffer
(FIFO wrap + newest-N), writer (start/append/prune/truncate), **manager (spawn/kill
dummy `node -e setTimeout` → starting→stopped, watchdog `process.exit(3)` → crashed,
czysty exit(0) → stopped z `lastExitCode`, brak binary → error, logi stdout/stderr
do ring + dysku)**.

**Dalej:** Faza 5 — Health + lifecycle: `prober.ts` (readiness `/v1/models`,
runtime `/slots`/`/health`/`/metrics`), lifecycle start/stop/restart połączony z
FSM + managerem, warstwa 6 (instance overrides) do `buildEffective`
(`state/instances/`) — warstwy 1–5 już działają.

## Faza 3 — Model Management — ✅ ZROBIONE

Działa: zarządzanie modelami (PLAN §8, §14.1, checklist §22 3.1–3.6). Discovery
(FM-2): `core/model/discover.ts` — rekurencyjne skanowanie `global.modelDirs`
(głębokość ≤ 4, `scanDir`), dopasowanie `filePatterns` engine (`matchesPattern`,
glob `*`/`?`); cache `state/models-cache.json` (path → mtime/size/modelId/engineId,
zapis atomowy) → rescan differential: nowe pliki tworzą configi (origin `discover`,
`params.model = path`, displayName = basename), zniknięte pliki tylko raportowane
(`removed`), nigdy auto-usuwanie (S-5). Model ID (3.1/§8.1): `core/model/ids.ts`
— `modelIdFor(path) = slugify(basename) + '-' + hash8(sha1(ścieżka bezwz.))`
(SAFE_ID, bez `../`); plik modelu nieprzerzucany. Reader metadanych GGUF (FM-5,
3.2): `core/model/gguf.ts` — czyta **tylko** nagłówek + pary KV metadanych (w GGUF
są tuż po nagłówku, przed tabelą tensorów), więc nie dotyka wielogigabajtowych
payloadi; format wg oficjalnej specyfikacji (gguf.md v3): magic `47 47 55 46`,
version u32, counts u64, **stringi = u64 len + bajty**, typy wartości 0–12
(8=STRING, 9=ARRAY [u32 elem_type + u64 len], 10=UINT64 …); zwraca
`general.architecture` + `<arch>.context_length` / `.block_size` /
`<arch>.attention.head_count` (przedrostek arch podpinany dynamicznie).
Zweryfikowany na realnych plikach: `Qwen3.8-27B` → arch `qwen35`, ctx 262144,
heads 24; `Qwen3.6-35B` → arch `qwen35moe`, ctx 262144, heads 16;
`mmproj-Qwen3.8-27B` → arch `clip` (bez ctx/heads); vocab `gemma-4` → arch `gemma4`.
Capabilities (3.3, FM-6): `core/model/capabilities.ts` — źródło 1 heurystyka
(`engine.detectCapabilities` z arch + nazwy pliku, słabe), źródło 2 ręczne
(`resolveCapabilities`; `capabilitiesManual=true` + niepuste flags = autorytatywne,
zawsze wygrywa; `source: 'manual'|'heuristic'`). Rejestr (3.4, FM-3/5/6/8):
`core/model/registry.ts` — `ModelRegistry` buduje `ModelView` (id, path, engineId,
displayName, description?, tags, capabilities, gguf, sizeBytes, fileExists, origin);
ręczne dodawanie (FM-3, jedyne wejście ścieżki) z walidacją (plik istnieje
`MODEL_NOT_FOUND`=404, pasuje do `filePatterns` `VALIDATION_FAILED`=400, engine
znany `ENGINE_NOT_FOUND`=404, idempotentne — re-add zwraca istniejące); usuwanie
(FM-8) usuwa config + katalog presetów, **nigdy plik** (S-5); edycja (FM-5/6) merge
displayName/description/tags/params + capabilities (ustawia `capabilitiesManual`).
API (3.5, §14.1): `GET /api/v1/models`, `POST /api/v1/models/discover`,
`POST /api/v1/models` (201), `GET/PATCH/DELETE /api/v1/models/:modelId`
(`makeModelHandlers(store)`; `ModelRegistry` + `listEngines()`). Walidacja
configu: `validateModelConfig` odrzuca nie-boolean `capabilitiesManual` i
`origin` spoza `'discover'|'manual'`. Testy (3.6): **58/58 (server) + 37/37
(shared) zielone**; discovery na tmp foldery, gguf reader na buforach wg specyfikacji
+ realne pliki, registry (add/get/update/remove), API (pełny lifecycle 201→GET→
PATCH→DELETE, discover added/removed/total).

**Dalej:** Faza 4 — Process Manager + FSM (§22 4.1–4.5): `states.ts` (FSM §11.2) +
`manager.ts` (spawn/kill grace), PID registry + watchdog, `ports.ts` (alokacja +
kolizje), logi (ring buffer + retention), testy FSM/spawn/registry. Tu wraca też
warstwa 6 (instance overrides) do `buildEffective` (`state/instances/`) — warstwy
1–5 już działają.

## Faza 2 — Abstrakcja engine + schemat llama-server — ✅ ZROBIONE

Działa: abstrakcja engine (PLAN §7): `packages/shared/engine/types.ts`
(interfejs `InferenceEngine` + typy: `ParamSchema`, `LaunchCommand`,
`RuntimeInfo`, `PreflightResult`, `BinaryCheckResult`) + registry
(`registerEngine`/`getEngine`/`listEngines`; moduły engine eksportowane
podsubpath `@ai-dashboard/shared/engine` — kod node'owy nie trafia do bundla
web); moduł `llama-server`: `schema.ts` (31 parametrów z tabeli §10.1, grupy
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

**Dalej:** Faza 3 — Model Management (discovery, metadane GGUF,
capabilities, ręczne dodawanie). Warstwy 1–5 działają w `buildEffective`;
warstwa 6 (instance overrides) dołączy w Fazie 4 razem z proces managerem
(`state/instances/`).

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
