# AI Model Dashboard

A local AI model management dashboard for discovering, configuring, launching, and monitoring local inference servers.

The goal of **AI Model Dashboard** is to replace a collection of shell scripts and manual commands with a convenient web interface for managing local AI models and inference backends.

The project is written in **TypeScript** and uses **Vite** for the frontend build tooling.

## Features

The dashboard is designed to provide:

- 📦 Local model discovery and management
- 📁 Configurable model directories
- ⚙️ Model and inference parameter configuration
- 🧠 Model capability definitions:
  - Text
  - Vision
  - Audio
  - Tool calling
  - Thinking / reasoning
  - Image generation
- 🚀 Start, stop, and restart inference servers
- 📊 Server status and health monitoring
- 📝 stdout / stderr and server logs
- 💻 Resource and process information
- 🔌 API status and connectivity monitoring
- 💾 Saved model configurations and presets
- 🔧 Backend-specific configuration
- 🧩 Extensible inference backend architecture

## Supported Backends

The initial backend target is:

- **llama.cpp / llama-server**

The architecture is designed to allow additional inference backends to be added in the future without coupling the entire application to a single inference engine.

## Architecture

The project is structured around a separation between:

```text
Frontend
   │
   ▼
Backend / Application API
   │
   ▼
Inference Backend Abstraction
   │
   ├── llama.cpp
   ├── future backend
   └── future backend
```

This allows the dashboard to manage different inference engines through a common interface while keeping backend-specific functionality isolated.

## Tech Stack

- **TypeScript**
- **Vite**
- Modern web frontend
- Local backend / process management
- llama.cpp / llama-server

## Repository Layout

An npm-workspaces monorepo:

```text
packages/shared   # config layers, engine abstraction, schemas (isomorphic: Node + browser)
apps/server       # Fastify API + process management (Node.js)
apps/web          # React frontend (Vite, hash routing, UI in Polish via i18n)
```

## Configuration

All state lives under `~/.ai-dashboard/` (override with the `AI_DASHBOARD_HOME`
environment variable):

```text
config/global.json                  # global defaults (server, port range, engine binaries)
config/engines/<engine>.json        # per-engine config (binary path, params)
config/models/<model>.json          # per-model config
config/presets/<model>/<preset>.json# saved presets (model + port + params)
state/                              # runtime state (instances, PIDs)
logs/                               # model logs
.backups/                           # .bak copies from atomic writes
```

The effective configuration is a merge of six layers, highest wins, with
per-value source tracking:

**schema defaults → global → engine → model → preset → instance**

## Engine Abstraction

Inference engines are plugins behind a single `InferenceEngine` interface
(`packages/shared/src/engine`). Each engine provides:

- a **declarative parameter schema** (grouped params with types, defaults and
  flags — UI forms are generated from it, no per-backend form code),
- a **command builder** (`buildLaunch`: effective config → exact CLI command),
- validation and **preflight** (binary check, model file, port, GPU/Vulkan),
- readiness probing and runtime info,
- **log classification** (known warnings, error patterns, ready markers).

The first engine is `llama-server`; new backends register themselves in the
engine registry without touching the core.

## Process Management

Each running model is a **child process** of the dashboard (process isolation,
PLAN §11.5 / TT-9): it gets its own `stdio` pipes, so its console output never
leaks into the dashboard. State is a finite-state machine
(`packages/shared/src/process/states.ts`) with the states
`starting / running / stopping / stopped / error / crashed / unknown`; any
(state, event) pair not in the transition table is rejected as `INVALID_STATE`,
so an illegal operation can never reach a process.

`apps/server/src/core/process/manager.ts` (`ProcessManager`) owns the lifecycle:

- **spawn** — launches the `LaunchCommand`, records the PID (state → `starting`),
  captures stdout/stderr into an in-memory **ring buffer** (last `ringLines`) and
  a per-start log file, and wires the child's `exit` to a **watchdog** — so a crash
  updates the registry/state automatically (event-driven, no polling).
- **stop (grace)** — `SIGTERM` → wait `stopTimeoutSec` (10 s) → `SIGKILL`.

The **PID registry** (`state/registry.json`) is written atomically on every state
transition (tmp + fsync + rename), so a dashboard restart can tell `crashed` /
`stopped` / `unknown` apart from the stored `lastExitCode` / signal. Ports are
auto-allocated as the first free in `global.portRange` (`ports.ts`); a pinned
collision is a loud `PORT_IN_USE` with a free-port suggestion. Per-instance logs
live under `logs/<instanceId>/`, keeping the newest `retentionFiles` (10) per
start and capping each file (~10 MB) with a truncation marker.

## Roadmap / Status

Development proceeds in phases defined in **`PLAN.md`** (source of truth);
progress is tracked in **`STATUS.md`**. Completed so far:

- **Faza 0** — skeleton (monorepo, dev tooling, i18n PL)
- **Faza 1** — config store (atomic writes), 6-layer merge with `source` per
  value, `/config` API, config file watch → reload
- **Faza 2** — engine abstraction + `llama-server` module (31-param schema,
  `buildLaunch`, preflight, `checkBinary`, `/engines` API)
- **Faza 3** — model management: directory discovery (cached, differential),
  GGUF metadata reader (header only), capabilities (heuristic + manual override),
  manual add/remove, `/models` API
- **Faza 4** — process manager + FSM: state machine (`INVALID_STATE` guard),
  `ProcessManager` (spawn with isolated stdio, grace `SIGTERM`→`SIGKILL`),
  PID registry (atomic on every transition) + `exit` watchdog, port allocation /
  collisions, per-instance logs (ring buffer + retention + truncation)
- **Faza 5** — health + lifecycle: readiness + runtime probes (`HealthProber`),
  `LifecycleManager` (start/stop/restart driving the FSM), startup-error
  detection (exit code, log tail, error patterns), `/instances` API, E2E with a
  real `llama-server` + small GGUF
- **Faza 6** — supplementary API + SSE + auth: preset CRUD (list/put/delete/
  duplicate), SSE hub (`stream/:id/logs` + `stream/events`), full instance DTO
  (`GET /instances/:id` + metrics + logs), bearer-token auth (S-2, `?token=` for
  SSE)
- **Faza 7** — frontend: models + start/stop — model list (table + preset select +
  actions), instance panel (start/stop/restart + PID + uptime + endpoint, SSE live
  state), preset CRUD (new/duplicate/delete + port edit), error notices (message +
  action), onboarding wizard (binary + model dirs, [Sprawdź] preflight, [Pomiń])
- **Faza 8** — logs + monitoring: `LogViewer` (SSE live logs + level/search filters +
  auto-scroll), `MetricsPanel` (runtime: slots, tokens/s, model, context + process
  CPU/RSS), `fetchRuntimeInfo` for llama-server (`/v1/models`, `/slots`, `/health`,
  `/metrics`)

Next: config editor + dashboard (per `PLAN.md` Faza 9 — `SchemaForm` from engine
schema, preset editing, global `Settings`), then reconciler + E2E (Faza 10).

## Development

Install dependencies:

```bash
npm install
```

Start the development server (dashboard server + Vite):

```bash
npm run dev
```

- Dashboard server: `127.0.0.1:3100`
- Web dev server: `localhost:5173` (Vite; proxies `/api` → `3100`)
- The server honors `AI_DASHBOARD_HOME` for an isolated config directory
  (used by tests and for trying the app with a fresh state)

Build the project:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Type-check and lint:

```bash
npm run typecheck
npm run lint
```

> Available scripts may change as development progresses.

## Requirements

- **Node.js** (server: current LTS+)
- **llama.cpp** build with a working `llama-server` binary (`--version`
  exits 0); for GPU usage the build must link **libvulkan**
  (`llama.cpp` compiled with `-DGGML_VULKAN=1`, detected via `ldd`).
  CPU-only usage works with any build.

## Goals

The long-term goal is to provide a single interface for managing a local AI environment:

- discover models
- configure models
- select inference parameters
- launch inference servers
- monitor running models
- inspect logs and errors
- manage multiple inference backends
- create reusable model presets

The dashboard should make running local AI models as convenient as managing applications through a normal desktop/web interface, without requiring users to maintain large collections of shell scripts.

## License

License to be determined.