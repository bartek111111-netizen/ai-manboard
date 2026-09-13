# STATUS

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
