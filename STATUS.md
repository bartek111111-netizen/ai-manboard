# STATUS

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
