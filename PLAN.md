# AI Model Dashboard — Kompletny plan implementacji

> Status: plan z sesji planowania (v1.0). Dokument jest autorytatywnym źródłem
> dla kolejnych sesji implementacyjnych: otwarcie projektu + lektura tego pliku
> powinna pozwolić na rozpoczęcie kodowania bez ponownego projektowania.
>
> Stan projektu na dzień planowania: **pusty katalog** (greenfield). Nie istniał
> wcześniej żaden codebase do analizy — architektura zaprojektowana od zera.

---

## 1. Cel projektu

Zbudowanie lokalnej aplikacji **AI Model Dashboard** — pojedynego miejsca do:

1. przeglądania lokalnych modeli AI,
2. konfigurowania parametrów uruchamiania,
3. uruchamiania / zatrzymywania / restartowania modeli,
4. monitorowania stanu, logów i zasobów.

Aplikacja **zastępuje ręczne uruchamianie modeli przez skrypty/shell**.

Wersja 1 (MVP) obsługuje backend **llama.cpp / `llama-server`**, ale architektura
jest **rozszerzalna**: dodanie kolejnego inference engine (np. Ollama, vLLM,
text-generation-webui, kobold) nie powinno wymagać przebudowy aplikacji —
nowy engine to nowy moduł implementujący wspólny interfejs (patrz §7).

---

## 2. Wymagania funkcjonalne

### 2.1 Zarządzanie modelami (Model Management)

| ID | Wymaganie |
|----|-----------|
| FM-1 | Konfiguracja katalogów, w których znajdują się modele (lista ścieżek, edycja z UI) |
| FM-2 | Automatyczne wykrywanie plików modeli w katalogach (wg wzorca plików danego engine, np. `*.gguf`) |
| FM-3 | Ręczne dodawanie modelu (ścieżka do pliku, engine, opcjonalna nazwa) |
| FM-4 | Wylistowanie modeli z danymi: nazwa, ścieżka, rozmiar, engine, capabilities, status |
| FM-5 | Metadane modelu: odczyt automatyczny (nawigacja po nagłówku GGUF: arch, context_length, block_size, quant) + ręczne pola (opis, tagi) |
| FM-6 | **Capabilities** modelu: `text`, `vision`, `audio`, `tool-calling`, `thinking` (reasoning), `image-generation`, + otwarta lista do rozszerzenia. Źródła: heurystyka z metadanych/nazwy + **ręczna edycja/przejęcie przez użytkownika** (heurystyki są słabe — override jest częścią MVP) |
| FM-7 | Wybór modelu do uruchomienia i przejście do jego konfiguracji jednym kliknięciem |
| FM-8 | Usunięcie modelu z dashboardu (bez usuwania pliku) — czyszczenie konfiguracji/presetów/instancji |

### 2.2 Konfiguracja uruchamiania

| ID | Wymaganie |
|----|-----------|
| FC-1 | Dla każdego modelu parametry backendu ustawiane w UI (formularz generowany **deklaratywnie ze schematu** engine — patrz §7.2) |
| FC-2 | Dla `llama-server` parametry MVP: model path, context size, GPU layers, CPU threads, batch / ubatch, KV cache (type K/V), speculative decoding (draft model, liczba draft tokenów, typ), temperature, top-p, top-k, min-p, seed, parallel slots, port, host, max tokens, + inne istotne (flash attention, load mode (mmap/mlock/dio), device, API key serwera) — pełna lista: §10.1 (w tym buildzie brak flagi rozmiaru KV cache i log level) |
| FC-3 | Lista parametrów **nie jest zakodowana sztywno w UI** — pochodzi ze schemaru engine (dane, nie kod UI). Rozwój backendu = rozszerzenie schemaru |
| FC-4 | Walidacja konfiguracji przed startem (reguły typu, zakresy, zależności, istnienie ścieżek) + komunikaty błędów |
| FC-5 | Widoczność: skąd pochodzi wartość (domyślna / globalna / engine / model / preset / override) i możliwość resetu do domyślnej |

### 2.3 Uruchamianie procesów

| ID | Wymaganie |
|----|-----------|
| FP-1 | Start / stop / restart instancji z UI |
| FP-2 | Sprawdzenie, czy proces działa (PID żywy) |
| FP-3 | Widoczność PID, portu, czasu działania (uptime) |
| FP-4 | Wykrywanie błędów podczas uruchamiania: kod wyjścia, tail stderr, wzorce błędów w logach |
| FP-5 | Automatyczne wykrywanie, czy backend odpowiada (HTTP probe) |
| FP-6 | **Stan** instancji: `stopped`, `starting`, `running`, `stopping`, `crashed`, `error`, `unknown` — wyraźnie pokazany w UI (badge + kolory) |
| FP-7 | Odzyskiwanie stanu po restarcie dashboardu (reconcile z rejestrem PID + sondy portów) |

### 2.4 Monitoring

| ID | Wymaganie |
|----|-----------|
| FMK-1 | Status procesu i podstawowe informacje o backendzie (engine, wersja binarki, port, endpoint) |
| FMK-2 | stdout / stderr na żywo (SSE), z filtrowaniem poziomów |
| FMK-3 | Logi trwale na dysku + bufor w pamięci (ograniczona historia) |
| FMK-4 | Wykorzystanie zasobów, **jeśli można je wiarygodnie uzyskać**: CPU/RAM procesu (platformowo), GPU AMD/Vulkan: sysfs (`/sys/class/drm/`) + `amdgpu_top` (jeśli zainstalowane) — opcjonalnie, graceful degradation |
| FMK-5 | Endpoint/API modelu (URL `http://host:port/v1/...`) z przyciskiem kopiuj |
| FMK-6 | Dane z API backendu (jeśli dostępne): `llama-server` → `/metrics` (OpenMetrics), `/slots`, `/health` (potwierdzone w buildzie 67672dc5 — §10.3) — adapter engine zamienia na ujednolicone `RuntimeInfo` |
| FMK-7 | Wykrywanie awarii podczas działania: zgon procesu → `crashed`; proces żywy ale nie odpowiada → `error` |

### 2.5 Zarządzanie konfiguracją

| ID | Wymaganie |
|----|-----------|
| CFG-1 | Warstwy: **globalna** → **engine** → **model** → **preset** → **override instancji** (patrz §9) |
| CFG-2 | Globalne: katalogi modeli, ścieżki binarek engine, zakres portów, domyślne timeouty, security |
| CFG-3 | Ustawienia engine: ścieżka binarki `llama-server`, domyślne parametry |
| CFG-4 | Ustawienia modelu: per-modelowe domyślne parametry + metadane + capabilities |
| CFG-5 | **Presety/profiles** per model: dowolna liczba nazwanych konfiguracji (np. `szybka`, `reasoning`, `duzy-context`, `eksperymentalna`), każdy z własnym portem; CRUD z UI |
| CFG-6 | Preset może definiować pełną lub częściową konfigurację (partial overrides) |
| ONB-1 | **Pierwsze uruchomienie (onboarding)**: jeśli ścieżka binarki engine / katalogi modeli nie były wcześniej ustawione — kreator: (a) wybór ścieżki binarki `llama-server` (file picker; walidacja: plik istnieje, jest wykonywalny, `--help` się uruchamia; przy `gpu-layers > 0` dodatkowo check, czy to build z Vulkan — §10.5), (b) wybór katalogów modeli (file picker, można dodać wiele); wyniki zapisywane w configu |
| ONB-2 | Ścieżka binarki i katalogi modeli edytowalne w Ustawieniach w dowolnym momencie (dodanie kolejnych katalogów, zmiana binarki) — ta sama walidacja co ONB-1 |
| ONB-3 | Modele dodawane ręcznie w dowolnym momencie (file picker na plik `.gguf`, FM-3) — niezależnie od katalogów modeli |

### 2.6 Architektura / rozszerzalność

| ID | Wymaganie |
|----|-----------|
| FA-1 | Abstrakcja: `Backend (InferenceEngine) → Model → Configuration → Process Manager → Health Check → API/Monitoring` |
| FA-2 | Frontend nie zna `llama.cpp` — komunikuje się wyłącznie przez API dashboardu i schematy engine |
| FA-3 | Nowy engine = nowy moduł kodu (interfejs + schemat parametrów + budownik komendy + probe + wzorce logów) + rejestracja w registry; **bez zmian w UI i w proces managerze** |
| FA-4 | Wszystkie komponenty (config, discovery, process, health, API) testowalne w izolacji |

---

## 3. Wymagania techniczne

| ID | Wymaganie |
|----|-----------|
| TT-1 | Single-user, lokalna aplikacja (desktop). Uruchamiana ręcznie (autostart poza MVP, §27) |
| TT-2 | Praca z procesami systemowymi: spawn, PID, kill (SIGTERM/SIGKILL / `taskkill`), odzyskiwanie po restarcie dashboardu |
| TT-3 | Komunikacja frontend ↔ backend: **REST** (komendy, CRUD) + **SSE** (logi na żywo, zmiany stanu) |
| TT-4 | Przechowywanie: pliki JSON na dysku (konfiguracja + stan + logi) — transparentne, edytowalne ręcznie, git-friendly |
| TT-5 | API bindowane na **loopback** (`127.0.0.1`) domyślnie; opcjonalny token auth |
| TT-6 | Dashboard nie modyfikuje plików modeli (read-only). Pliki modeli nigdy nie są przenoszone/usuwane przez aplikację |
| TT-7 | Platforma: **Linux** (decyzja §27.1); GPU: **AMD + Vulkan** (nie ROCm — §27.2): ścieżki, kill (SIGTERM/SIGKILL), monitoring GPU przez sysfs / `amdgpu_top` |
| TT-8 | Zero zewnętrznych baz danych w MVP; pliki JSON z atomowymi zapisami (tmp + rename) |
| TT-9 | Błędy procesu modelu nigdy nie zabijają dashboardu (izolacja: model = child process, dashboard = supervisor) |
| TT-10 | Każda sesja implementacyjna kończy się działającym inkrementem (fazy §22 są self-contained) |

---

## 4. Założenia (base assumptions)

Założenia, które plan traktuje jako pewne; te wymagające potwierdzenia użytkownika
są jednocześnie w §27 (otwarte pytania):

- **A1.** Użytkownik jest single-user, aplikacja działa lokalnie (bez sieci LAN).
- **A2.** Modele to pliki na lokalnym dysku (MVP bez modeli zdalnych/HTTP).
- **A3.** `llama-server` jest dostarczony jako **build z Vulkan** (llama.cpp
  skompilowany z `-DGGML_VULKAN=1`, AMD); ścieżka wybrana przez użytkownika
  w kreatorze pierwszego uruchomienia (ONB-1) lub później w ustawieniach —
  nie instalujemy ani nie budujemy llama.cpp. Użytkownik ma już build
  (potwierdzony `--version`, 2026-07): `~/llama.cpp/build/bin/llama-server`,
  wersja 0.4.0-dev (build 1316, commit 67672dc5), GNU 16.2.1, Linux x86_64.
- **A4.** Dashboard jest **supervisorem procesów**: startuje je jako child processes.
  (Alternatywa systemd/scheduled task — §25 ADR-5.)
- **A5.** Język UI: polski (API/identyfikatory — angielski).
- **A6.** Stos technologiczny: **Node.js + TypeScript** (backend), **React + Vite + TS**
  (frontend) — uzasadnienie w §6 i ADR-1/ADR-3.
- **A7.** Jedna instancja = para `(model, preset)` z przypisanym portem. Ten sam model
  może działać równolegle pod różnymi presetami (różne porty).
- **A8.** MVP: brak autostartu dashboardu; monitoring GPU opcjonalny
  (AMD: sysfs / `amdgpu_top`); brak dynamicznego ładowania pluginów
  (engines = moduły kodu w repo).

---

## 5. Architektura ogólna

### 5.1 Widok z lotu ptaka

```
┌────────────────────────────────────────────────────────────────────┐
│                  WARSTWA UŻYTKOWNIKA (FRONTEND)                    │
│   przeglądarka (React SPA) — localhost:3100 (konfigurowalny)        │
└──────────────┬─────────────────────────────────────┬───────────────┘
               │ REST (komendy, CRUD)               │ SSE (logi, zdarzenia)
┌──────────────▼─────────────────────────────────────▼───────────────┐
│                     SERVER (Node.js + TypeScript)                  │
│                                                                    │
│  ┌──────────┐  ┌──────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │  API     │  │ ConfigStore  │  │ Model       │  │ Process    │  │
│  │ router   │  │ (warstwy,    │  │ Registry    │  │ Manager    │  │
│  │ handlers │  │  merge,      │  │ (discovery, │  │ (spawn,    │  │
│  │ SSE hub  │  │  walidacja)  │  │  metadata,  │  │  PID       │  │
│  └────┬─────┘  └──────┬───────┘  │  caps)      │  │  registry, │  │
│       │               │          └──────┬──────┘  │  stany)    │  │
│       │               │                 │          └─────┬─────┘  │
│  ┌────▼───────────────▼─────────────────▼─────────────────▼─────┐  │
│  │                IN-PROCESS CORE                               │  │
│  │                                                              │  │
│  │  ┌────────────────┐        ┌─────────────────┐               │  │
│  │  │ EngineRegistry │        │ HealthProber    │               │  │
│  │  │ (interfejs     │        │ (readiness +    │               │  │
│  │  │  InferenceEng.)│        │  runtime probe) │               │  │
│  │  └───────┬────────┘        └───────┬─────────┘               │  │
│  └──────────┼─────────────────────────┼─────────────────────────┘  │
│             │                         │                             │
└─────────────┼─────────────────────────┼────────────────────────────┘
              │ buildLaunchCommand()    │ HTTP probe
     ┌────────▼────────┐          ┌─────▼──────────┐
     │  ENGINE MODULE  │          │  LLAMA-SERVER  │
     │  (np. llama-    │          │  (proces AI)   │
     │  server)        │          │  :8081/v1/...  │
     └────────┬────────┘          └────────────────┘
              │ child_process.spawn
     ┌────────▼────────┐
     │  PROCES MODELU  │  (stdout/stderr → Logs → SSE)
     └─────────────────┘
```

### 5.2 Warstwy (zgodnie z wymaganiem FA-1)

| Warstwa | Odpowiednik w kodzie | Rola |
|---|---|---|
| **Backend / Inference Engine** | `engines/llama-server/` (+ przyszłe) | Wie, jak: wykryć modele, zbudować komendę, sondować, odczytać dane, rozpoznać błędy. Deklaruje schemat parametrów |
| **Model** | `core/model/` | Rejestr modeli (autodetekcja + ręczne), metadane, capabilities |
| **Configuration** | `core/config/` | Warstwy global/engine/model/preset/override, merge, walidacja, atomowe zapisy |
| **Process Manager** | `core/process/` | Lifecycle: start/stop/restart, PID registry, maszyna stanów, reconcile |
| **Health Check** | `core/health/` | Readiness probe (start) + runtime probe (ciągły), timeouty, wykrywanie hangów |
| **API / Monitoring** | `api/` + `core/metrics/` + `core/logs/` | REST+SSE, zbieranie metryk (backend API + proces + GPU), ring-buffer logów |

Kluczowa cecha: **Engine nie zna Process Managera** — dostaje gotowy LaunchCommand
i zwraca dane; Process Manager nie zna konkretnych engine'ów. Frontend nie zna
Engine'ów — widzi ujednolicone API i schematy.

### 5.3 Toki danych (happy path "start modelu")

1. UI: `POST /api/v1/instances/:id/start`
2. API → ConfigStore: merge warstw → resolved config; walidacja (schemat + engine.validate)
3. API → ProcessManager: port wolny? tak → spawn(binarka, args) z pipes
4. ProcessManager: stan `starting`, zapis w PID registry, otwarcie logów
5. HealthProber: co 2 s `GET /v1/models` (do timeoutu startowego)
6. Probe OK → stan `running`; event SSE → UI (badge zielone, endpoint URL, metryki)
7. Czynne: runtime probe co 5 s + tail logów (SSE) + metryki (z `/metrics`, proces, GPU)

---

## 6. Wybór technologii — co i dlaczego (streszczenie, ADR w §25)

| Obszar | Wybór | Dlaczego (jedno zdanie) |
|---|---|---|
| Runtime backendu | **Node.js ≥ 20 LTS** | Jedyny język łączący spawn/monitoring procesów, HTTP (REST+SSE), filesystem i UI — bez mostków; `child_process` natywny |
| Język | **TypeScript** (cały projekt) | Jeden język frontend/backend, typy wspólne (schematy, API DTO) współdzielone |
| HTTP server | **Fastify** | Streaming/SSE z pierwszorzędną obsługą, gotowe routingi, lekki; `express`/własny router = mniej narzędzi |
| Frontend | **React 18 + Vite + TS + react-router (hash)** | Ekosystem TS, szybki build, routing bez konfiguracji serwera (hash = działa z pliku/static) |
| Styling | **Vanilla CSS (design tokens) + komponenty własne** | Brak frameworka UI (np. MUI) = mniejsza powierzchnia, pełna kontrola, look "praktyczny, nie ozdobny" |
| Stan w UI | **fetch + SSE + React hooks (bez Redux)** | Aplikacja ma 3 widoki; Redux byłby zbędny |
| Storage | **Pliki JSON** (atomowe zapisy) | Transparentne, edytowalne w edytorze, zero zależności DB; §25 ADR-4 |
| Procesy | **`child_process` + własna PID registry** | Bez zewnętrznych supervisorów (PM2/systemd) — dashboard jest supervisorem (ADR-5) |
| Monitoring zasobów | **`systeminformation` (npm)** | Cross-platform CPU/RAM per PID bez natywnych zależności |
| GPU AMD (opcja) | **sysfs** (`/sys/class/drm/`, driver `amdgpu`) + **`amdgpu_top`** (spawn, opcjonalnie) | Dostępność wykrywana przy starcie; brak = graceful degradation (brak ROCm — tylko Vulkan/sysfs) |
| Testy | **Vitest** (unit) + skrypt E2E (bash/node) | Szybkie unit testy TS; E2E z prawdziwą binarką i małym modelem |

Środowisko: `npm workspaces` (monorepo: `apps/server`, `apps/web`, `packages/shared`).

---

## 7. System backendów / inference engine (abstrakcja)

### 7.1 Interfejs `InferenceEngine` (TypeScript)

```ts
// packages/shared/engine/types.ts
export interface InferenceEngine {
  id: string;                    // "llama-server"
  displayName: string;
  description: string;

  /** Wzorce plików przy autodetekcji, np. ["*.gguf"] */
  filePatterns: string[];

  /** Deklaratywny schemat parametrów — UI generuje formularz z tego (dane, nie kod UI) */
  schema: ParamSchema[];

  /** Heurystyczne capabilities modelu (nadpisywane ręcznie) */
  detectCapabilities(model: ModelInfo): Capability[];

  /** Buduje gotową do spawn komendę z resolved configu */
  buildLaunch(ctx: LaunchContext): Promise<LaunchCommand>;

  /** Czy backend odpowiada i jest gotowy? (readiness probe) */
  isReady(instance: InstanceView, base: string): Promise<boolean>;

  /** Dodatkowe dane z API backendu → ujednolicone RuntimeInfo (np. /metrics, /slots) */
  fetchRuntimeInfo(base: string): Promise<RuntimeInfo | null>;

  /** Klasyfikacja linii logu: poziom + znacznik błędu (dla detekcji crashów/OOM) */
  classifyLog(line: string): LogClassification;

  /** Engine-specific walidacja (poza typami z schematu), np. draft model musi istnieć */
  validate(model: ModelInfo, cfg: ResolvedConfig): string[];

  /** Opcjonalnie: weryfikacja środowiska przed startem (GPU, binarka) */
  preflight?(ctx: LaunchContext): Promise<PreflightResult>;
}

export interface LaunchCommand {
  binary: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface RuntimeInfo {
  backendVersion?: string;
  modelLoaded?: string;
  contextSize?: number;
  slots?: { total: number; used: number };
  tokensPerSec?: number;
  gpu?: { memoryUsedMB?: number; memoryTotalMB?: number; utilization?: number };
  extras: Record<string, unknown>;   // surowe, engine-specific pola
}

export type Capability =
  | 'text' | 'vision' | 'audio' | 'tool-calling'
  | 'thinking' | 'image-generation' | string;   // string = rozszerzalna lista
```

### 7.2 Schemat parametrów (klucz do FC-3 / FA-2)

Parametry to **dane** (`schema.ts` w module engine), nie komponenty UI:

```ts
interface ParamSchema {
  key: string;                  // "context-size"
  label: string;                // "Rozmiar kontekstu"
  type: 'int' | 'float' | 'string' | 'bool' | 'enum' | 'path-model' | 'path-file';
  flag?: string;                // mapowanie na flagę binarki (np. "--ctx-size")
  default: unknown;
  min?: number; max?: number;
  choices?: { value: unknown; label: string }[];   // dla enum
  group: string;                // "model" | "performance" | "sampling" | "speculative" | "server" | "advanced"
  description?: string;
  advanced?: boolean;           // chowany w sekcji "Zaawansowane" (collapsed)
  requiresEngineFeature?: string; // np. "gpu" — ukryty/pominięty jeśli feature niedostępne
}
```

Konsekwencje:
- `SchemaForm` (frontend) renderuje grupy, typy, waliduje — **zero kodu pod konkretny parametr**.
- Nowy parametr w nowym buildzie llama.cpp = dodanie obiektu do `schema.ts` + ewentualnie
  wpisu w mapowaniu `args.ts`. UI się sam zaadaptuje.
- Te same schematy walidują konfigurację po stronie serwera (wspólny moduł w `packages/shared`).

### 7.3 Registry i dodawanie engine'a

`engines/index.ts` rejestruje moduły: `registerEngine(new LlamaServerEngine())`.
Nowy engine (kolejna sesja, np. Ollama) = nowy folder:

```
engines/ollama/
├── index.ts        # implementacja InferenceEngine
├── schema.ts       # parametry (dane)
├── args.ts         # buildLaunch
├── probe.ts        # isReady + fetchRuntimeInfo
└── logpatterns.ts  # classifyLog
```

+ 1 linia w `engines/index.ts`. Nic więcej się nie zmienia (UI, config, process manager).

---

## 8. Model Management

### 8.1 Discovery (FM-2)

- Konfiguracja: `global.json → modelDirs: string[]` (FM-1).
- Skan: rekurencyjnie po `modelDirs`, głębokość ≤ 4, wzorce engine (`*.gguf` dla llama.cpp;
  każdy engine deklaruje `filePatterns`).
- Trigger: `POST /models/discover` z UI + opcjonalnie na starcie dashboardu.
- Cache: wyniki skanowania w `state/models-cache.json` (ścieżki + mtime); rescan tylko
  różnicowo (nowe/usunięte pliki).
- Zmiana modelu: model = plik; identyfikator = `slug(nazwa pliku) + '-' + hash8(sha1(ścieżki))`
  (stabilne, unikalne, odczytalne).

### 8.2 Metadane (FM-5)

- **GGUF metadata reader** (własny, minimalny): odczyt nagłówka pliku GGUF:
  magic (`GGUF`), version, tensor/metadata counts, pary klucz-wartość typów
  `string`/`int`/`float`/`bool`/`array`. Klucze interesujące:
  `general.architecture` (np. `llama`, `qwen2_vision`), `llama.context_length`,
  `llama.block_size`, `llama.attention.head_count` — zapis w metadanych modelu.
  (Czytanie tylko nagłówka = szybkie i bezpieczne; parsowanie tensorów poza zakresem.)
- Ręczne pola: `displayName`, `description`, `tags` (edycja z UI, `PATCH /models/:id`).

### 8.3 Capabilities (FM-6)

- Źródło 1 (heurystyka, `engine.detectCapabilities`): z architektury GGUF i nazwy pliku
  (np. `qwen2_vision` → `vision`; `whisper`/`wav2vec` → `audio`; nazwa zawiera
  `thinking`/`reason` → `thinking`). **Słabe — to sugestia, nie fakt.**
- Źródło 2 (autorytet): ręczna edycja w UI (checkboxy per model, `PATCH /models/:id`).
  Ręczna wartość zawsze wygrywa (flaga `capabilities.manual = true`).
- Wyświetlane jako ikony/etykiety w liście i szczegółach.

### 8.4 Ręczne dodanie (FM-3)

`POST /models { path, engineId, displayName?, capabilities? }`:
- walidacja: plik istnieje, pasuje do `filePatterns` engine'a; ścieżka dowolna
  lokalna (file picker, uprawnienia użytkownika) — to **jedyne** wejście ścieżki w API
  (S-4); pozostałe endpointy używają `modelId` z rejestru.

---

## 9. System konfiguracji (warstwy)

### 9.1 Warstwy i priorytety

Każdy parametr instancji jest wyliczany jako merge warstw (wzrastający priorytet):

```
1. domyślna ze schematu engine        (schema.ts → default)
2. globalne                           (global.json → defaults)
3. engine                             (config/engines/<engine>.json)
4. model                              (config/models/<modelId>.json)
5. preset                             (config/presets/<modelId>/<preset>.json)
6. override instancji                 (state/instances/<instanceId>.json — runtime overrides z formularza startu)
```

Wynik merge = `ResolvedConfig` z metadatą źródła per wartość
(`{ value, source: 'schema' | 'global' | 'engine' | 'model' | 'preset' | 'instance' }`)
— UI pokazuje "skąd" (FC-5) i oferuje reset.

### 9.2 Presety (CFG-5, CFG-6)

- Preset = nazwany, częściowy zestaw parametrów + własny port:

```json
{
  "name": "szybka",
  "description": "Szybkie odpowiedzi, niski kontekst",
  "port": 8081,
  "params": {
    "context-size": 4096,
    "gpu-layers": 32,
    "threads": 8,
    "temp": 0.7,
    "top-p": 0.8,
    "top-k": 20,
    "max-tokens": 512
  }
}
```

- CRUD: `GET/PUT/DELETE /models/:id/presets/:name`; duplikacja
  (`POST .../duplicate`) = szybka droga do "eksperymentalna" z istniejącego.
- `default` preset jest tworzony automatycznie przy pierwszym dodaniu modelu
  (z domyślami schematu + auto-przypisanym portem z zakresu).
- Preset nie jest instancją: preset definiuje **konfigurację**, instancja to
  **slot uruchomienia** (model+preset+port) ze stanem (§11).

### 9.3 Pliki konfiguracyjne (layout)

```
~/.ai-dashboard/                     # AI_DASHBOARD_HOME (env) — domyślnie ~/.ai-dashboard
├── config/
│   ├── global.json                  # katalogi modeli, binarki, porty, timeouty, security, monitoring
│   ├── engines/
│   │   └── llama-server.json        # binary: "~/llama.cpp/build/bin/llama-server", params: {...}
│   ├── models/
│   │   └── <modelId>.json           # metadane ręczne + capabilities + params modelu
│   └── presets/
│       └── <modelId>/
│           ├── szybka.json
│           ├── reasoning.json
│           └── duzy-context.json
├── state/
│   ├── registry.json                # aktywne instancje: PID, port, stan, start time
│   ├── instances/
│   │   └── <instanceId>/
│   │       ├── instance.json        # resolved config ostatniego startu + overrides
│   │       └── launch.json          # faktyczna komenda (binarka+args) — debug
│   ├── models-cache.json            # cache skanowania
│   └── probe.json                   # ostatnie wyniki sond (debug)
├── logs/
│   └── <instanceId>/
│       └── 2026-07-09T17-45-00.log  # stdout+stderr per start (rotacja: maxLines/retention)
├── internal.log                     # log wewnętrzny dashboardu (boot, błędy handlerów)
└── .backups/                        # .bak ostatniej wersji plików config (zapis atomowy)
```

- Zapisy: **atomowe** (tmp + `rename`) + kopię `.bak` przed nadpisaniem plików `config/`.
- Schematy plików z polami `version: 1` — przyszłe migracje.
- Domyślna ścieżka: `~/.ai-dashboard` (Linux); override: env `AI_DASHBOARD_HOME`
  + parametr CLI.

### 9.4 `global.json` (przykład)

```json
{
  "version": 1,
  "modelDirs": ["/mnt/dane/Modele"],
  "portRange": { "start": 8080, "end": 8099 },
  "engines": {
    "llama-server": { "binary": "~/llama.cpp/build/bin/llama-server" }
  },
  "server": { "host": "127.0.0.1", "port": 3100 },
  "security": { "token": null },
  "monitoring": { "probeIntervalSec": 5, "startupTimeoutSec": 120 },
  "logs": { "ringLines": 1000, "retentionFiles": 10 }
}
```

---

## 10. `llama.cpp` / `llama-server` — szczegóły pierwszego engine'a

### 10.1 Parametry (MVP) i mapowanie na flagi

| Param (key) | Grupa | Typ | Domyślne (build) | Flaga (**potwierdzone** `--help`, 67672dc5) |
|---|---|---|---|---|
| `model` | model | path-model | — | `-m, --model` |
| `context-size` | model | int | 0 (= z modelu) | `-c, --ctx-size` |
| `gpu-layers` | performance | int \| `auto` \| `all` | auto | `-ngl, --gpu-layers, --n-gpu-layers` |
| `threads` | performance | int | -1 (= nproc) | `-t, --threads` |
| `batch-size` | performance | int | 2048 | `-b, --batch-size` |
| `ubatch-size` | performance | int | 512 | `-ub, --ubatch-size` |
| `parallel` | server | int | -1 (= auto) | `-np, --parallel` |
| `cache-type-k` / `cache-type-v` | model (KV cache) | enum (f16, f32, q8_0, ...) | f16 | `-ctk` / `-ctv` |
| `load-mode` | performance | enum (auto, mmap, mlock, dio, ...) | auto | `-lm, --load-mode` (zastępuje DEPRECATED `--mmap`/`--mlock`) |
| `flash-attn` | performance | enum (on/off/auto) | auto | `-fa, --flash-attn` |
| `device` | performance | string (`dev1,dev2,...`) | auto | `-dev, --device` (lista: `--list-devices`) |
| `fit` | performance | bool | true | `--fit` (auto-fit do VRAM; `--fit-target`, `--fitc`) |
| `spec-model` | speculative | path-model | — | `--spec-draft-model` (`-md`) |
| `n-draft` | speculative | int | 3 | `--spec-draft-n-max` (`--draft-max`) |
| `spec-type` | speculative | enum (none, draft-*, ngram-*) | none | `--spec-type` |
| `seed` | sampling | int | -1 (random) | `-s, --seed` |
| `temp` | sampling | float | 0.80 | `--temp, --temperature` |
| `top-p` | sampling | float | 0.95 | `--top-p` |
| `top-k` | sampling | int | 40 | `--top-k` |
| `min-p` | sampling | float | 0.05 | `--min-p` |
| `typical-p` | sampling | float | 1.0 (= disabled) | `--typical-p` (istnieje w tym buildzie) |
| `max-tokens` | sampling | int | -1 (= infinite) | `-n, --n-predict` |
| `api-key` | server | string (wiele, CSV) | — | `--api-key` (+ `--api-key-file`) |
| `metrics-enabled` | server | bool | false (build) → dashboard: **true** | `--metrics` |
| `slots-endpoint` | server | bool | true | `--slots` (endpoint `GET /slots`) |
| `web-ui` | server | bool | true | `--no-ui` / `--no-webui` (deaktywacja) |
| `reasoning-format` | advanced | enum (none, deepseek, deepseek-legacy) | auto | `--reasoning-format` (+ `--reasoning`, `--reasoning-budget`) |
| `offline` | server | bool | — | `--offline` (blokuje sieć — polecam przy starcie z dashboardu) |
| `host` | server | string | 127.0.0.1 | `--host` |
| `port` | server | int | 8080 | `--port` |

> **Zadanie 2.4 ZROBIONE (2026-07)**: tablica powyżej = potwierdzone
> `--help` z builda użytkownika (`~/llama.cpp/build/bin/llama-server`,
> 0.4.0-dev, commit 67672dc5; Vulkan/RADV aktywny — warning RADV = normalne,
> §10.4).
>
> **Zasady implementacji** (`schema.ts` / `args.ts`):
> - Wartości `0` / `-1` / `auto` = „niech llama.cpp zdecyduje" (ctx z modelu,
>   threads=nproc, parallel auto, n-predict infinite) — UI: opcja „auto"
>   = nie wysyłaj flagi.
> - **Zmiany nazw** vs. starsze buildy: `--spec-draft-model` (nie
>   `--spec-model`), `--spec-draft-n-max`/`--draft-max` (nie `--n-draft`),
>   `--no-ui` (nie `--no-web`), `-np` (nie `-P`), `--ctx-size` (nie
>   `--context-size`).
> - **DEPRECATED** w tym buildzie: `--mmap`/`--mlock` → `--load-mode`;
>   `--draft*` → `--spec-draft-*`. Nie używać.
> - Nie istnieją: `--cache-n-ctx`, `--n-total` (usunięte z planu).
> - **Nowe samplery/flagi** (advanced, poza MVP formularzem): penalties
>   (`--repeat-penalty`, `--presence-penalty`, `--frequency-penalty`),
>   `--dry-*`, `--mirostat*`, `--dynatemp-*`, `--adaptive-*`,
>   `--grammar`/`--json-schema`, `--jinja`/`--chat-template`,
>   `--cache-prompt` (domyślnie on), `--sleep-idle-seconds`,
>   `--threads-http`, `--timeout`, `--sse-ping-interval`, `--lora`,
>   `-tb` (threads-batch), `--keep`, `--numa`, RoPE/YaRN.
> - **GPU/offload**: `--device` (wybór urządzeń) + `--split-mode` /
>   `--tensor-split` / `--main-gpu` (wiele GPU); `--fit` (domyślnie on)
>   auto-dopasowuje do VRAM. `--list-devices` = lista urządzeń (exit) →
>   picker w UI (ONB-1, §20.0) + preflight (§10.5).
> - Dashboard wysyła: `--metrics` (build: domyślnie off; **wykrywane z `--help`** —
>   brak w buildzie = pominięta, P-14) + `--offline` (brak dostępu do sieci);
>   `--slots` działa domyślnie (flaga tylko przy zmianie).
> - **Reguła wysyłania** (`args.ts`): wysyłane tylko parametry ≠ domyślne schematu
>   + zawsze `--host`, `--port`, `--metrics` (jeśli build wspiera), `--offline`;
>   resztę decyduje llama.cpp (wspiera `--fit`).
>

Przykład gotowej komendy (preset `szybka` §9.2; reguła wysyłania powyżej):

```
llama-server \
  --model /mnt/dane/Modele/llama-3-8b-instruct.Q8_0.gguf \
  --host 127.0.0.1 --port 8081 \
  --ctx-size 4096 --n-gpu-layers 32 --threads 8 \
  --temp 0.7 --top-p 0.8 --top-k 20 \
  --n-predict 512 \
  --metrics --offline
```

### 10.2 Readiness probe (FP-5)

- `isReady()`: `GET http://<host>:<port>/v1/models` (timeout 2 s) → 200 = gotowy.
- Start: co 2 s do `startupTimeoutSec` (domyślnie 120 s; per-model override:
  `config/models/<id>.json` → `"monitoring": { "startupTimeoutSec": 600 }` —
  duże modele ładują się dłużej).
- Log parsing jest **dopełnieniem** (wcześniejsza detekcja błędów), nie
  autorytetem: readiness = wyłącznie wynik HTTP probe.

### 10.3 Monitoring z API backendu (FMK-6)

`fetchRuntimeInfo()` odczytuje (każde opcjonalnie, null = niedostępne):

| Endpoint | Dane |
|---|---|
| `GET /v1/models` | model załadowany (readiness) |
| `GET /metrics` | OpenMetrics: tokens, sloty, kolejki, tokens/s (wymaga `--metrics`) |
| `GET /slots` | sloty: używane/wolne, wykorzystanie (domyślnie włączone) |
| `GET /health` | health publiczny, bez klucza — sonda runtime |

> **Potwierdzone w buildzie 67672dc5** (rejestracja tras `tools/server/server.cpp`):
> `/state` i `/parallel_info` **nie istnieją** w tym buildzie.

Ujednolicone `RuntimeInfo` (§7.1) — UI renderuje generic; engine-specific surowce
trafiają do `extras` (debug UI).

### 10.4 Wzorce błędów w logach (`logpatterns.ts`)

- `classifyLog()`: regexy per poziom:
  - error: `out of memory`, `OOM`, `CUDA error`, `Vulkan: failed`,
    `no Vulkan devices found`, `failed to load`, `error loading`,
    `could not allocate`, `invalid model`
  - warn: `warning`, `slow`, `fallback`
  - **known-warning (info, NIE błąd)**: `radv is not a conformant Vulkan
    implementation, testing use only` — standardowy komunikat tego buildu dla
    sterownika RADV (Mesa, open-source Vulkan dla AMD); pojawia się przy
    KAŻDYM starcie (nawet `--version`); = GPU wykryte, Vulkan zainicjowane.
    W UI: szare/info, nie czerwone; dodatkowo = pozytywny marker "GPU OK"
  - ready-marker (informacyjny): `server is listening`, `all slots are idle`, `loaded`
- Zastosowanie: (1) wczesne wykrywanie błędu podczas `starting` (proces żywy ale
  loguje błąd → stan `error` + komunikat), (2) kolorowanie/wiadomości w UI,
  (3) `crashed` = kod wyjścia ≠ 0 LUB sygnał LUB zgon bez kodu.

### 10.5 Preflight (opcjonalny, `preflight()`)

Przed startem: binarka istnieje i jest wykonywalna; `--version` → exit 0 +
linia `version:` (ten build dodatkowo wypisuje `WARNING: radv is not a
conformant...` — **normalne**, §10.4 known-warning); port wolny (bind-test
lub `net` check); ścieżka modelu istnieje. Jeśli `gpu-layers > 0`:
- **check Vulkan build**: czy binarka łączy się z `libvulkan`
  (`ldd` / `readelf -d`) — brak = `ENGINE_BINARY_INVALID` (komunikat:
  "binarka nie wygląda na build z Vulkan (-DGGML_VULKAN=1)" — zmień ścieżkę
  w Ustawieniach lub ustaw `gpu-layers=0`); start **zablokowany**;
- **check GPU (RADV)**: marker `radv` w wyjściu `--version` = sterownik
  wykrył urządzenie (u użytkownika: potwierdzony, §27.2); dodatkowo
  opcjonalnie sysfs `/sys/class/drm/` — wynik **nie blokuje** startu
  (ostrzeżenie w UI).

---

## 11. Process Management

### 11.1 Model instancji (A7)

- **Instance** = para `(modelId, presetName)` + port. ID:
  `<modelId>--<presetName>` (slugowane).
- Jeden aktywny instance per para; ten sam model = wiele instancji (różne presety,
  różne porty) — np. `...--szybka` na 8081 i `...--reasoning` na 8082 równolegle.
- Instance `stopped` może istnieć bez procesu (saved config, np. z presetu) —
  start/stop dotyczy instancji, presetu nie rusza.
- `instance.json` trzyma resolved config + overrides; `launch.json` — faktyczną
  komendę (debug: "co dokładnie się uruchomiło").

### 11.2 Maszyna stanów (FP-6)

```
                    ┌──────────┐
            start  │          │  timeout startu /
          ┌───────▶│ starting │  proces wyszedł wcześnie
          │         │          │  (exit ≠ 0) / błąd w logach
  ┌───────┘         └──────┬───┘
  │                        │ probe OK (HTTP 200)
  │                        ▼
  │  ┌────────────────────────────────────────┐
  │  │              running                  │
  │  │  (probe co 5 s; logi; metryki)        │
  │  └──────┬──────────────────────┬─────────┘
  │         │ stop (grace)         │ 3× probe fail (proces żywy, hang)
  │         ▼                      ▼
  │  ┌────────────┐  ┌──────────────────────┐
  └─▶│ stopping  │  │ error (backend nie    │
    │  SIGTERM→  │  │ odpowiada; restart /  │
    │  timeout→  │  │ stop z UI)            │
    │  SIGKILL   │  └──────────┬─────────────┘
    └─────┬──────┘             ▲
          │                    │
          ▼                    │ (restart / stop)
  ┌──────────────┐             │
  │   stopped    │             │
  └──────────────┘             │
                               │
  crashed: proces ZGINĄŁ (exit ≠ 0 / sygnał) z runningu → automatycznie
  unknown: po starcie dashboardu BRAK JAKICHKOLWIEK DOWODÓW
            (PID martwy, port martwy, w registry ani exit code, ani czysty
            stop — np. dashboard SIGKILL'owany i model umarł później)
            → do decyzji użytkownika (resolve, §11.3 krok 4)
```

- Przejścia są jedyne; nieoczekiwane kombinacje (np. `start` z `running`)
  = błąd API `INVALID_STATE`.
- `restart` = `stop` (grace) → `start` z tym samym resolved configiem.
- Grace stop: SIGTERM (Linux/WSL) / `taskkill` (Windows) → wait `stopTimeoutSec`
  (domyślnie 10 s) → SIGKILL / `taskkill /f`.

### 11.3 PID registry i reconcile (FP-7, A4)

`state/registry.json`:

```json
{
  "instances": {
    "llama-3-8b-instruct--szybka": {
      "instanceId": "llama-3-8b-instruct--szybka",
      "pid": 42424,
      "port": 8081,
      "state": "running",
      "startedAt": "2026-07-09T17:45:00Z",
      "lastExitCode": null
    }
  }
}
```

- Zapis **przy każdym** przejściu stanu (atomowo).
- **Reconcile przy starcie dashboardu** (per zarejestrowana instancja):
  1. PID żyje?
     - **Nie** → wg dowodów w registry: `lastExitCode` ≠ 0 / sygnał → `crashed`;
       czysty stop (zapisany) → `stopped`; **żaden dowód** (np. dashboard
       SIGKILL'owany + model umarł później) → `unknown`
       (krok 4: [Adoptuj] / [Zatrzymaj] / [Oznacz jako stopped]).
  2. PID żyje → sonda `GET /v1/models` na port:
     - odpowiada → `running` (przywrócone),
     - nie odpowiada (grace 15 s) → `error` (backend żywy, nie odpowiada),
     - port zajęty przez **inną** instancję → `unknown` + ostrzeżenie w UI.
  3. Opcjonalna weryfikacja PID reuse: porównanie czasu startu procesu
     (Linux: `/proc/<pid>/stat` starttime; Windows: `GetProcessTimes`) z
     `startedAt` — rozbieżność = PID reuse → `unknown`.
  4. `unknown` → UI prosi: [Adoptuj — to nasz backend] / [Zatrzymaj (kill PID)] /
     [Oznacz jako stopped].

### 11.4 Porty

- Zakres z `global.json` (`portRange`). Auto-allokacja: pierwszy wolny w zakresie
  (sprawdzenie: net check + lista zarejestrowanych).
- Preset może pinować port. Kolizja przy starcie = błąd `PORT_IN_USE` (z podpowiedzią
  dostępnego portu). Żadna cisza: konflikty nigdy nie są rozwiązywane cicho.

### 11.5 Izolacja (TT-9)

- Model = child process dashboardu; crash modelu nie zabija dashboardu.
- `spawn` z własnym `stdio` (pipes) — wyjścia modelu nie idą do konsoli dashboardu.
- Watchdog: jeśli proces wyszedł, `registry.json` i stan są aktualizowane
  automatycznie (event loop dashboardu, nie polling z UI).

---

## 12. Health Check (podsumowanie)

| Typ | Kiedy | Częstotliwość | Timeout | Konsekwencja |
|---|---|---|---|---|
| Readiness (start) | `starting` | co 2 s | `startupTimeoutSec` (domyślnie 120 s) | `running` / `error` (timeout) |
| Runtime | `running` | co `probeIntervalSec` (5 s) | 2 s / request | 3 kolejne fail → `error` (backend żywy, hang) |
| Proces (PID) | ciągły | event-driven (child `exit`) + 10 s fallback poll | — | `crashed` / `stopped` |
| Log patterns | przy każdej linii | — | — | wczesny `error` w `starting` (np. OOM w logach) |

Każdy wynik sonda zapisany w `state/probe.json` (debug) + event SSE.

---

## 13. Logi (FMK-2, FMK-3)

- **Źródła**: stdout + stderr child process; komunikaty wewnętrzne dashboardu
  (start/stop, błędy sonda) — łącznie z metką `source` (stdout/stderr/internal).
- **W pamięci**: ring buffer per instancja (`ringLines`, domyślnie 1000 linii).
- **Na dysku**: `logs/<instanceId>/<timestamp>.log` per start; retention
  `retentionFiles` (domyślnie 10 najstarszych usuwane); maks ~10 MB/plik (truncate z markerem).
- **Do UI**: SSE `GET /stream/:instanceId/logs` (live) + `GET /instances/:id/logs?limit=&level=`
  (historia z buffer). Filtrowanie poziomów (info/warn/error) po stronie UI.
- Klasyfikacja linii przez `engine.classifyLog` (poziom + znacznik błędu).
- Linie > 1000 znaków skracane w UI (pełna wersja w pliku).

---

## 14. API aplikacyjne (REST + SSE)

- Prefiks: `/api/v1`. Błędy: `{"error": {"code": "...", "message": "...", "details": {...}}}`.
- Kody błędów (MVP): `PORT_IN_USE`, `MODEL_NOT_FOUND`, `ENGINE_NOT_FOUND`,
  `PRESET_NOT_FOUND`, `INSTANCE_NOT_FOUND`, `INVALID_STATE`, `VALIDATION_FAILED`,
  `CONFIG_INVALID`, `PROCESS_SPAWN_FAILED`, `STARTUP_TIMEOUT`, `HEALTH_FAILED`,
  `PID_REUSED`, `CONFIG_WRITE_FAILED`, `ENGINE_BINARY_INVALID`
  (brak binarki / nie działa `--help` / brak `libvulkan` przy `gpu-layers > 0`).

### 14.1 Endpointy

| Metoda | Ścieżka | Rola |
|---|---|---|
| GET | `/api/v1/status` | stan dashboardu, wersja, engines (z binarkami + availability) |
| GET | `/api/v1/engines` | lista engine'ów |
| GET | `/api/v1/engines/:engineId/schema` | schemat parametrów (dla formularzy) |
| PUT | `/api/v1/engines/:engineId` | ścieżka binarki + params (ONB-1/ONB-2; walidacja: `--help`, Vulkan check §10.5) |
| GET | `/api/v1/models` | lista modeli (status, capabilities, rozmiar, engine) |
| POST | `/api/v1/models/discover` | rescan katalogów |
| POST | `/api/v1/models` | ręczne dodanie `{path, engineId, displayName?, capabilities?}` |
| GET | `/api/v1/models/:modelId` | szczegóły (metadane + config + presety + instancje) |
| PATCH | `/api/v1/models/:modelId` | metadane/capabilities/params |
| DELETE | `/api/v1/models/:modelId` | usuń z dashboardu (z instancjami/presetami; **nie** plików) |
| GET | `/api/v1/models/:modelId/presets` | presety |
| PUT | `/api/v1/models/:modelId/presets/:name` | utwórz/zmień preset |
| DELETE | `/api/v1/models/:modelId/presets/:name` | usuń preset |
| POST | `/api/v1/models/:modelId/presets/:name/duplicate` | duplikuj pod nową nazwą |
| GET | `/api/v1/instances` | wszystkie instancje + stany |
| POST | `/api/v1/instances` | utwórz instancję `{modelId, preset, port?}` (bez startu) |
| GET | `/api/v1/instances/:instanceId` | stan + resolved config + RuntimeInfo |
| PUT | `/api/v1/instances/:instanceId` | edycja overrides (tylko gdy `stopped`) |
| DELETE | `/api/v1/instances/:instanceId` | usuń (stopuje proces) |
| POST | `/api/v1/instances/:instanceId/start` | start (walidacja → spawn → `starting`) |
| POST | `/api/v1/instances/:instanceId/stop` | stop (grace) |
| POST | `/api/v1/instances/:instanceId/restart` | restart |
| POST | `/api/v1/instances/:instanceId/resolve` | rozstrzyganie `unknown` (reconcile §11.3): `{action: "adopt" \| "kill" \| "stopped"}` — adopt = przejmuje PID, kill = SIGTERM→SIGKILL, stopped = oznacza martwą; bez `action` → 400 (decyzja musi być jawna) |
| GET | `/api/v1/instances/:instanceId/logs?limit=&level=` | historia logów (ring) |
| GET | `/api/v1/instances/:instanceId/metrics` | ujednolicone metryki (backend + proces + GPU) |
| PUT | `/api/v1/config/global` | zmiana globalnych ustawień (walidacja + atomowy zapis) |
| GET | `/api/v1/config` | cały config (wszystkie warstwy + effective) |
| GET | `/api/v1/stream/:instanceId/logs` | **SSE** — logi na żywo |
| GET | `/api/v1/stream/events` | **SSE** — globalne zdarzenia (zmiany stanów, błędy) |

### 14.2 Przykłady

```bash
curl -s localhost:3100/api/v1/models
curl -s -X POST localhost:3100/api/v1/instances/llama-3-8b-instruct--szybka/start
curl -s localhost:3100/api/v1/instances/llama-3-8b-instruct--szybka
curl -s localhost:3100/api/v1/instances/llama-3-8b-instruct--szybka/metrics
curl -N localhost:3100/api/v1/stream/llama-3-8b-instruct--szybka/logs
```

DTO instancji (GET):

```json
{
  "instanceId": "llama-3-8b-instruct--szybka",
  "modelId": "llama-3-8b-instruct-9f3a1c2e",
  "preset": "szybka",
  "state": "running",
  "pid": 42424,
  "port": 8081,
  "endpoint": "http://127.0.0.1:8081/v1/",
  "startedAt": "2026-07-09T17:45:00Z",
  "uptimeSec": 312,
  "configSource": { "context-size": "preset", "gpu-layers": "model", "temp": "preset", "seed": "schema" },
  "runtime": { "slots": { "total": 1, "used": 0 }, "tokensPerSec": null, "gpu": null },
  "process": { "cpuPct": 12.4, "rssMB": 1870 },
  "lastError": null
}
```

---

## 15. Przechowywanie konfiguracji — podsumowanie decyzji

- Pliki JSON (§9.3), atomowe zapisy, `.bak`, walidacja schematów przy odczycie
  (błędny plik = błąd startu dashboardu z jasną komunikacją, **nie** ciche
  nadpisanie).
- Rejestr PID + logi pod `state/` i `logs/` — te foldery są "właśnością"
  dashboardu i mogą być czyszczone.
- **Zero** danych poza `~/.ai-dashboard` (poza katalogami modeli — read-only)
  i binarkami engine'ów.
- Przyszłość: jeśli pojawi się potrzeba historii (np. "co było w configu wczoraj")
  → opcjonalny import do SQLite (ADR-4 zostawia drzwi otwarte, ale MVP = JSON).

---

## 16. Bezpieczeństwo

| # | Zasada | Implementacja |
|---|---|---|
| S-1 | Bind na loopback | `server.host` domyślnie `127.0.0.1`; zmiana na `0.0.0.0` = ostrzeżenie w UI + **wymaga** tokena |
| S-2 | Token auth (opcjonalny) | `security.token`: w pliku SHA-256 (raw token pokazywany tylko raz, przy pierwszym ustawianiu); nagłówek `Authorization: Bearer <token>`; bind na nieloopback bez tokena = odmowa startu (S-1) |
| S-3 | Brak CORS | API + UI z tej samej origin (dashboard serwuje build weba); CORS off domyślnie |
| S-4 | Kontrola ścieżek w API | Jedyne wejście ścieżki = ręczne dodanie modelu (FM-3/ONB-3, `POST /models` — file picker); discovery tylko po `modelDirs`; pozostałe endpointy pracują wyłącznie na `modelId`/`instanceId` z rejestru |
| S-5 | Modele read-only | Dashboard nigdy nie zapisuje ani nie zmienia plików w katalogach modeli |
| S-6 | Kill tylko "swoich" | Stop dotyczy procesów, które dashboard rozpoczynał lub adoptował (reconcile, z jawnym potwierdzeniem użytkownika w `unknown`) |
| S-7 | SSE/REST = ten sam auth | Token wymagany na obu kanałach (SSE: query param `?token=` — akceptowany, bo SSE nie niesie nagłówków w przeglądarce) |
| S-8 | Logi | Nie wysyłane poza lokalnie; retention ograniczone; `lastError`/logi w UI tylko lokalnie |
| S-9 | Walidacja wejść | Wszystkie body walidowane (schematy JSON); `modelDirs` — ścieżki absolutne; porty — zakres 1024–65535 |

---

## 17. Obsługa błędów

| Warstwa | Błąd | Zachowanie |
|---|---|---|
| Konfiguracja | nieprawidłowy JSON / brak pola | błąd startu dashboardu: komunikat z plikiem + polem; `.bak` pozwala na rollback ręczny |
| Konfiguracja | zapis koliduje | atomowy: tmp+rename; błąd FS = `CONFIG_WRITE_FAILED` (stan bez zmian) |
| Walidacja startu | reguły schematu / engine.validate | `VALIDATION_FAILED` z listą konkretnych pól (UI podświetla) |
| Start | binarka nie istnieje / spawn fail | `PROCESS_SPAWN_FAILED` + stan `error` + komunikat |
| Start | timeout | `STARTUP_TIMEOUT` + stan `error` + tail 20 linii logów |
| Start | błąd w logach wczesnych (OOM) | stan `error` + wykryty znacznik (np. "out of memory") |
| Runtime | zgon procesu | `crashed` + `lastExitCode` + tail logów; event SSE |
| Runtime | hang (probe ×3) | `error` + komunikat "proces żywy, nie odpowiada" + akcje [restart][stop][kill] |
| Runtime | PID reuse po restarcie | `unknown` + procedura §11.3 (z potwierdzeniem) |
| API | 404/409/400 | spójny format błędu (§14); żadna cisza |
| Dashboard | wewnętrzny wyjątek handlera | log do `internal.log` + `500 { code: "INTERNAL" }`; proces manager nie jest zabijany |

Zasada: **błąd zawsze ma kod, komunikat i akcję** (w UI: komunikat + przyciski).

---

## 18. Extensibility — checklist dla przyszłych engine'ów

1. Nowy folder w `engines/` (§7.3): interfejs, `schema.ts`, `args.ts`, `probe.ts`, `logpatterns.ts`.
2. `filePatterns` dla discovery.
3. `detectCapabilities` (heurystyki) + ręczny override działa automatycznie (FM-6).
4. `fetchRuntimeInfo` → `RuntimeInfo` (UI generic) — jeśli backend ma API; `null` jeśli nie.
5. Rejestracja w `engines/index.ts` (1 linia).
6. Weryfikacja flag w `args.ts` z `--help` binarki (jak §10.1).
7. Test: budowa komendy (unit) + E2E z małym modelem (analogicznie §23).

Kandydaci (poza MVP, katalog rozszerzeń §7.3): **Ollama** (HTTP API, `GET /api/tags`),
**vLLM** (`/v1/models`, OpenAI-compatible), **kobold-lp** (HTTP),
**text-generation-webui** (gradio — trudniejszy; adapter "manual" = tylko config komendy).

---

## 19. Struktura projektu

```
ai-dashboard/                          # katalog projektu (ten folder)
├── PLAN.md
├── package.json                       # npm workspaces: apps/*, packages/*
├── tsconfig.base.json
├── README.md                          # (dodane w fazie 10: jak uruchomić)
├── packages/
│   └── shared/
│       └── src/
│           ├── engine/types.ts        # InferenceEngine, ParamSchema, RuntimeInfo, Capability
│           ├── config/types.ts        # GlobalConfig, EngineConfig, ModelConfig, Preset, ResolvedConfig
│           ├── api/dto.ts             # DTO request/response (wspólne FE/BE)
│           └── schema/validate.ts     # walidacja configu (wspólna FE/BE)
├── apps/
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # boot: config → engines → model registry → process manager → API
│   │       ├── app.ts                 # Fastify + routing + SSE hub
│   │       ├── core/
│   │       │   ├── config/
│   │       │   │   ├── store.ts       # JSON pliki: odczyt/zapis atomowy/.bak
│   │       │   │   ├── layers.ts      # merge global→engine→model→preset→instance
│   │       │   │   └── migrate.ts     # wersje plików config
│   │       │   ├── engine/
│   │       │   │   └── registry.ts    # registerEngine + lookup
│   │       │   ├── model/
│   │       │   │   ├── discover.ts    # skan katalogów (różnicowo, mtime)
│   │       │   │   ├── gguf.ts        # minimalny GGUF metadata reader (nagłówki)
│   │       │   │   └── capabilities.ts# heurystyki + manual override
│   │       │   ├── process/
│   │       │   │   ├── manager.ts     # spawn/kill/watchdog
│   │       │   │   ├── states.ts      # maszyna stanów (FSM)
│   │       │   │   ├── registry.ts    # PID registry (state/registry.json)
│   │       │   │   ├── reconcile.ts   # odzyskiwanie po starcie
│   │       │   │   └── ports.ts       # alokacja + kolizje
│   │       │   ├── health/
│   │       │   │   └── prober.ts      # readiness + runtime probe
│   │       │   ├── logs/
│   │       │   │   ├── ringbuffer.ts
│   │       │   │   └── writer.ts      # pliki, retention
│   │       │   └── metrics/
│   │       │       ├── collector.ts   # merge: engine RuntimeInfo + proces + GPU
│   │       │       └── gpu.ts         # AMD: sysfs / amdgpu_top (opcjonalnie)
│   │       ├── engines/
│   │       │   ├── index.ts           # registerEngine(...)
│   │       │   └── llama-server/
│   │       │       ├── index.ts       # InferenceEngine impl
│   │       │       ├── schema.ts      # parametry (dane)
│   │       │       ├── args.ts        # buildLaunch
│   │       │       ├── probe.ts       # isReady + fetchRuntimeInfo
│   │       │       └── logpatterns.ts # classifyLog
│   │       └── api/
│   │           ├── router.ts          # routing + auth (token)
│   │           ├── sse.ts             # SSE hub (logi + events)
│   │           └── handlers/
│   │               ├── status.ts
│   │               ├── engines.ts
│   │               ├── models.ts
│   │               ├── presets.ts
│   │               ├── instances.ts
│   │               └── config.ts
│   └── web/
│       ├── package.json
│       ├── vite.config.ts             # build → dist/ (serwowane przez server)
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx                # layout + routing (hash)
│           ├── api/
│           │   ├── client.ts          # fetch wrapper (REST)
│           │   └── sse.ts             # EventSource (logi/events)
│           ├── components/
│           │   ├── StatusBadge.tsx    # kolory stanów (FP-6)
│           │   ├── CapabilityIcons.tsx
│           │   ├── ModelList.tsx
│           │   ├── ModelDetail.tsx    # zakładki: podgląd/config/instancja/logi/metryki
│           │   ├── PresetSelect.tsx
│           │   ├── SchemaForm.tsx     # generyczny formularz ze schematu (§7.2)
│           │   ├── InstancePanel.tsx  # start/stop/restart + endpoint + PID + uptime
│           │   ├── LogViewer.tsx      # SSE + filtry
│           │   ├── MetricsPanel.tsx
│           │   └── Settings.tsx       # globalne: katalogi, binarki, porty, security
│           └── styles/tokens.css      # design tokens (kolory stanów, spacery)
└── tools/
    └── e2e/
        └── run-e2e.sh                 # E2E: mały model + pełny lifecycle (§23)
```

---

## 20. UX (prosty, praktyczny)

Trzy widoki, jedna nawigacja (hash routing):

### 20.0 Pierwsze uruchomienie — kreator (ONB-1, ONB-2)

Jeśli `config/engines/llama-server.json` nie istnieje (brak ścieżki binarki)
albo `global.json → modelDirs` jest puste:

1. **Krok 1 — Binarka**: file picker → ścieżka do `llama-server` + [Sprawdź]
   (istnieje, wykonywalna, `--help` się uruchamia; przy `gpu-layers > 0`:
   check buildu Vulkan — §10.5). Błędy = komunikat + podpowiedź akcji.
2. **Krok 2 — Katalogi modeli**: file picker (można dodać kilka) + [Nowy skan].
3. [Pomiń] — kreator można dokończyć później w Ustawieniach; wraca do momentu
   ukończenia.

W Ustawieniach w dowolnym momencie: zmiana binarki (ONB-2), dodawanie katalogów,
ręczne dodawanie modeli spoza katalogów (ONB-3 / FM-3).

### 20.1 `/` — Lista modeli

| Nazwa | Engine | Capabilities | Rozmiar | Presety | Port | Stan | Akcje |
|---|---|---|---|---|---|---|---|
| llama-3-8b-instruct | llama-server | 🔤 🧠🔧 | 4.9 GB | szybka · reasoning | 8081 | 🟢 running | ▶ ⏹ ↻ |

- Kolumny: nazwa (+ tooltip ścieżki), engine, ikony capabilities, rozmiar,
  presety (dropdown), port, **StatusBadge** (FP-6), akcje (start/stop/restart).
- Góra: [Nowy skan] [Dodaj model] [Ustawienia].
- Kolory: 🟢 running · ⚪ stopped · 🔵 starting · 🟡 stopping · 🔴 crashed/error · ⚪❓ unknown.

### 20.2 `/models/:id` — Szczegóły modelu

Zakładki (jedno kliknięcie od akcji; patrz "Szybka ścieżka"):

1. **Podgląd** — metadane (arch, context, rozmiar), capabilities (checkboxy do edycji), opis;
2. **Konfiguracja** — `SchemaForm` (grupy: Model / Wydajność / Sampling / Spekulatywna / Serwer / Zaawansowane):
   - wartości effective + źródło (ikona) + reset do domyślnej;
   - sekcja presetów: wybór / [Edytuj] / [Nowy] / [Duplikuj] (nazwa: `szybka`, `reasoning`, ...);
3. **Instancja** — stan, PID, port, uptime, endpoint (kopiuj), resolved config (read-only),
   przyciski **[Start]** **[Stop]** **[Restart]**;
4. **Logi** — `LogViewer` (SSE, auto-scroll, filtry poziomów, kopiuj);
5. **Metryki** — `MetricsPanel`: tokens/s, sloty, CPU%, RSS, GPU (jeśli dostępne).

**Szybka ścieżka (wymaganie UX)**: lista → klik modelu → wybór presetu → [Start]
→ badge `starting` → `running` + endpoint widoczny. **4 kliknięcia** do działającego modelu.

### 20.3 `/settings` — Ustawienia

- Katalogi modeli (lista, dodaj/usuń) + [Nowy skan]
- Engine: ścieżka binarki + [Sprawdź] (preflight: binarka istnieje, `--help`
  działa, check buildu Vulkan przy `gpu-layers > 0` — ONB-2, §10.5)
- Zakres portów; timeouty (start/probe); security (host, token); logi (retention).
- Zmiany: walidacja + potwierdzenie (np. zmiana portu serwera = restart dashboardu — ostrzeżenie).

Zasady UX: **praktyczny, nie ozdobny**: brak animacji tła, brak dashboardu "hero",
tekst + badge'y + tabele; dark mode (system); pełna obsługa klawiatury (Enter = start
w selekcji, S = stop, R = restart w widoku instancji).

---

## 21. Konwencje kodowania

- TypeScript `strict` (wszystkie projekty); zależności modułów: `api/*` → `core/*` →
  `packages/shared` (brak zależności wstecznych).
- Błędy: `AppError { code, message, details }` (§14); handlery nie rzucają do góry —
  middleware zamienia na spójny JSON.
- Autorytet stanu: `core/process/states.ts` (FSM) + `registry.json`; UI nigdy nie
  trzyma autorytetu stanu (odczyt z API).
- Nazwy: `camelCase` (kody), `PascalCase` (klasy/komponenty), kebab-case (ID engine'ów,
  klucze parametrów).
- Testy colocated: `*.test.ts` obok modułów; E2E w `tools/e2e/`.
- Commity: `faza.N: opis` (np. `faza.5: health prober + lifecycle`).

---

## 22. Kolejność implementacji (fazy = self-contained inkrementy)

Każda faza kończy się **działającym, testowalnym** stanem aplikacji. Kolejność
odzwierciedla zależności. Szacunki = liczba sesji (orientacyjnie).

### Faza 0 — Skeleton (sesja 1) — ✅ ZROBIONE
- [x] 0.1 Monorepo: `npm workspaces`, `packages/shared`, `apps/server`, `apps/web`, TS config, lint/format
- [x] 0.2 Server: Fastify "hello" + `GET /api/v1/status` + statyczny frontend (Vite dev proxy)
- [x] 0.3 Web: React + routing (hash) + pusty layout + [API: status]
- **Akceptacja**: `npm run dev` → widoki w przeglądarce + `status` w API. ✅ (zweryfikowane: serwer 3100 + Vite 5173, proxy `/api` działa; dodatkowo i18n PL — UI po polsku ze słownika `src/i18n`)

### Faza 1 — Storage + Configuration (sesja 2) ✅ ZROBIONE
- [x] 1.1 `config/store.ts`: odczyt/zapis JSON atomowy + `.bak` + walidacja plików
- [x] 1.2 Schematy: `global.json` (przykład §9.4), migracje/wersje
- [x] 1.3 `config/layers.ts`: merge 6 warstw + `source` per wartość
- [x] 1.4 API: `GET/PUT /config`, `GET /config` (effective)
- [x] 1.5 Testy unit: merge, walidacja, atomowość zapisu
- [x] 1.6 Watch plików config (fs `watch` + debounce) → reload + ostrzeżenie w UI (P-12)
- **Akceptacja**: config warstw działa + testy zielone. ✅ (zweryfikowane: store atomowy + `.bak`, warstwy z `source` per wartość, `GET/PUT /api/v1/config`, fs watch + debounce → reload z ostrzeżeniem w UI; 24 testy server + 12 shared zielone)

### Faza 2 — Abstrakcja engine + schemat llama-server (sesja 3) ✅ ZROBIONE
- [x] 2.1 `packages/shared/engine/types.ts` (interfejs §7.1) + registry
- [x] 2.2 `schema.ts` dla llama-server (tabela §10.1)
- [x] 2.3 `args.ts`: buildLaunch (config → komenda)
- [x] 2.4 **Potwierdzenie flag (ZROBIONE 2026-07)**: `~/llama.cpp/build/bin/llama-server --help`
  + trasy HTTP (0.4.0-dev, commit 67672dc5 — build deweloperski!) → tabela
  §10.1 + §10.3 (`/state`, `/parallel_info` nie istnieją) → korekty `schema.ts`/`args.ts`
- [x] 2.5 `validate()` + `preflight()` (binarka, port, ścieżka)
- [x] 2.6 Testy unit: snapshoty komendy (per preset)
- [x] 2.7 API: `GET /engines`, `GET /engines/:id/schema`, `PUT /engines/:id`
  (ścieżka binarki + walidacja: `--help`, check libvulkan) + testy
- **Akceptacja**: `buildLaunch(preset)` = poprawna komenda (sprawdzona z `--help`).
  ✅ (snapshot presetu „szybka” = komenda z §10.1 do znaku; wszystkie emitowane flagi
  istnieją w `--help` + pełna grupa argumentów parsuje się w realnej binarce bez
  „unknown argument”; `PUT /engines` zrealną binarką: `versionLine` + `vulkan: true`)

### Faza 3 — Model Management (sesja 4)
- [x] 3.1 Discovery (skan katalogów, cache mtime, `filePatterns`)
- [x] 3.2 GGUF metadata reader (nagłówki)
- [x] 3.3 Capabilities: heurystyki + manual override
- [x] 3.4 Ręczne dodanie / usuwanie modeli (FM-3/8)
- [x] 3.5 API: `models*` endpointy
- [x] 3.6 Testy unit: discovery (tmp foldery), gguf reader (pliki testowe)
- **Akceptacja**: katalog z modelami → lista w API + metadane.

### Faza 4 — Process Manager + FSM (sesja 5)
- [x] 4.1 `states.ts` FSM (§11.2) + `manager.ts` (spawn/kill grace)
- [x] 4.2 PID registry + watchdog (child `exit`)
- [x] 4.3 `ports.ts`: alokacja + kolizje
- [x] 4.4 Logi: ring buffer + writer + retention
- [x] 4.5 Testy unit: FSM (transycje), spawn/kill (dummy process), registry
- **Akceptacja**: spawn/kill dummy'ego procesu + poprawna zmiana stanów.

### Faza 5 — Health + lifecycle start/stop/restart (sesja 6)
- [ ] 5.1 `prober.ts`: readiness (start) + runtime (ciągły)
- [ ] 5.2 Lifecycle: `start` (walidacja→spawn→probe→running), `stop`, `restart`
- [ ] 5.3 Detekcja błędów startu (exit code, tail, log patterns)
- [ ] 5.4 API: `instances` + `start/stop/restart`
- [ ] 5.5 **E2E z małym modelem**: start → readiness → running → stop (sesja z prawdziwą binarką)
- **Akceptacja**: pełny lifecycle z prawdziwą `llama-server` + małym gguf.

### Faza 6 — API uzupełnieniowe + SSE (sesja 7)
- [ ] 6.1 API: presety CRUD (`GET/PUT/DELETE` + `duplicate`) + testy
- [ ] 6.2 SSE hub: `stream/:id/logs` + `stream/events`
- [ ] 6.3 `GET /instances/:id` (pełne DTO §14.2), `metrics`, `logs`
- [ ] 6.4 Auth token (S-2): middleware + SSE `?token=`
- [ ] 6.5 Testy: SSE (stream test), auth (testy)
- **Akceptacja**: logi na żywo + auth działają.

### Faza 7 — Frontend: modele + start/stop (sesja 8)
- [ ] 7.1 `ModelList` + `StatusBadge` + `CapabilityIcons`
- [ ] 7.2 `InstancePanel` (start/stop/restart + endpoint + PID + uptime)
- [ ] 7.3 `PresetSelect` + CRUD presetów z UI
- [ ] 7.4 Błędy: komunikaty + akcje (per §17)
- [ ] 7.5 Onboarding (ONB-1/ONB-2): kreator pierwszego uruchomienia (binarka +
  katalogi modeli, file pickery, [Sprawdź]) + [Pomiń]
- **Akceptacja**: szybka ścieżka (20.2) działa w przeglądarce; świeże
  `AI_DASHBOARD_HOME` (bez configu) → kreator → start modelu.

### Faza 8 — Logi + monitoring (sesja 9)
- [ ] 8.1 `LogViewer` (SSE) + filtry
- [ ] 8.2 `MetricsPanel` (collector: engine `/metrics` + `systeminformation` + GPU opcjonalnie)
- [ ] 8.3 `fetchRuntimeInfo` dla llama-server (`/metrics`, `/slots`, `/health`)
- **Akceptacja**: monitoring działający dla uruchomionego modelu.

### Faza 9 — Config form + presety (sesja 10)
- [ ] 9.1 `SchemaForm` (rendering ze schematu: grupy, typy, walidacja, źródła)
- [ ] 9.2 Edycja presetów z UI (formularz per preset)
- [ ] 9.3 `Settings` (globalne: katalogi, binarki, porty, security)
- **Akceptacja**: pełna pętla: model → preset → config → start → monitorowanie.

### Faza 10 — Reconcile + hardening + docs (sesja 11)
- [ ] 10.1 `reconcile.ts` (§11.3) + UI dla `unknown` + `POST /instances/:id/resolve`
- [ ] 10.2 GPU monitor (`gpu.ts`, opcjonalnie)
- [ ] 10.3 Security: reguła S-1 (bind ≠ loopback ⇒ wymagany token) + testy (middleware z 6.4)
- [ ] 10.4 README.md + `tools/e2e/run-e2e.sh`
- [ ] 10.5 E2E pełny (lifecycle + crash + reconcile + kolizja portów)
- **Akceptacja**: **kryteria ukończenia §24 spełnione.**

> Kolejność faz 6–9 można zamienić (np. 8 przed 7), jeśli logi mają być
> dostępne wcześniej — decyzja w sesji implementacyjnej.

### Konwencja sesji implementacyjnej

1. Otwórz `PLAN.md`, znajdź aktualną fazę (odświeżaj statusy checkboxów).
2. Zaznacz `in_progress` przy zadaniach; po ukończeniu fazy — odhacz + notatka
   w `STATUS.md` (jedno zdanie: co działa, co dalej).
3. Każda faza = commit; testy zielone = warunek zamknięcia fazy.

---

## 23. Sposób testowania

### 23.1 Unit (Vitest)

| Moduł | Testy |
|---|---|
| `args.ts` | snapshoty komend: per preset (szybka/reasoning/eksperymentalna) — pełna komenda oczekiwana |
| `layers.ts` | merge 6 warstw: priorytety, partial override, `source` |
| `validate.ts` | typy, zakresy, zależności (np. `spec-model` wymaga `spec-type`), nieistniejące ścieżki |
| `states.ts` | FSM: wszystkie legalne transycje + nielegalne rzucane |
| `ports.ts` | alokacja, kolizje, zakres |
| `registry.ts` | serializacja/deserializacja, atomowość |
| `discover.ts` | tmp foldery: nowe pliki / usunięcie / mtime; `filePatterns` |
| `gguf.ts` | pliki GGUF testowe (magic, metadata string/int) |
| `store.ts` | atomowość (kill mid-write), `.bak` |
| `prober.ts` | timeouty, retry (mock HTTP) |

### 23.2 Integracja (E2E) — `tools/e2e/run-e2e.sh`

Wymaga: mały model gguf (<1 GB, np. `tinyllama`/`tiny` z repo GGUF) + binarka
`llama-server`. Scenariusz:

1. Dashboard start (z `modelDirs` → tmp katalog z modelem)
2. `discover` → model znaleziony; metadane odczytane
3. Preset `e2e` (port 8099)
4. **start** → `starting` → `running` (probe OK); `GET /instances/:id` → PID/port
5. **logi**: SSE — linia readiness widoczna
6. **metryki**: `/metrics` → tokens/s/slots
7. **stop** → `stopping` → `stopped` (PID zgon)
8. **restart** → `running` znów
9. **crash**: `kill -9 PID` → `crashed` (exit code) + tail logów
10. **kolizja portów**: zająć 8099 (dummy http) → start → `PORT_IN_USE`
11. **reconcile**: restart dashboardu przy żywym procesie → `running` przywrócone;
    następnie kill modelu → `crashed`/`stopped`
12. **unknown**: SIGKILL dashboardu + zgon modelu poza rejestracją (brak exit
    code / czystego stopu) → restart dashboardu → `unknown` (brak dowodów) →
    `POST /instances/:id/resolve {action:"stopped"}` → `stopped`
13. **błędy**: (a) preset z `context-size=100` (< min z schematu) → `VALIDATION_FAILED`
    (bez spawnu); (b) `startupTimeoutSec=3` + model o długim ładowaniu →
    `STARTUP_TIMEOUT`

### 23.3 Frontend

- Waga: testy renderowania `SchemaForm` (per typ parametru) + `StatusBadge`
  (Vitest + jsdom). Pozostałe e2e UI = manual checklist.
- Manual checklist (per faza): szybka ścieżka (§20.2), presety, logi, błędy.

### 23.4 Środowisko testowe

- `modelDirs` → `tmp/` (nie prawdziwe modele przy testach jednostkowych!)
- E2E: `AI_DASHBOARD_HOME=tmp/e2e-home` (izolacja)
- Porty: E2E używa 8098–8099 (nie koliduje z produkcją).
- GPU: E2E bez GPU (CPU-only: `gpu-layers=0`); check Vulkan (`ldd`) i sysfs
  testowane jednostkowo ze stubami (brak zależności od sprzętu w CI).
- E2E binary = `~/llama.cpp/build/bin/llama-server` (0.4.0-dev, commit
  67672dc5) — `WARNING: radv is not a conformant...` w logach = **normalne**
  (known-warning, §10.4), E2E nie traktuje go jako błędu.

---

## 24. Kryteria ukończenia (MVP)

Aplikacja jest **ukończona**, gdy (wszystkie):

1. **Funkcje**: FM-1..8, FC-1..5, CFG-1..6, ONB-1..3, FP-1..7, FMK-1..7,
   FA-1..4 zrealizowane
   (każde z wymagania §2 ma implementację + test).
2. **E2E** (§23.2) przechodzi od startu do końca (13 kroków).
3. **Szybka ścieżka** (§20.2): ≤4 kliknięcia od listy do działającego modelu.
4. **Stany** (FP-6): każdy z 7 stanów osiągalny w E2E + widoczny w UI (badge).
5. **Recover** (§11.3): po restarcie dashboardu stany są przywrócone;
   `unknown` ma procedurę z UI.
6. **Błędy** (§17): każdy kod błędu występuje w E2E i jest czytany w UI.
7. **Config** (§9): 6 warstw merge + presety CRUD + `source` per wartość w UI.
8. **Monitoring** (FMK): logi SSE + metryki (backend + proces + GPU opcjonalnie).
9. **Bezpieczeństwo** (§16): bind loopback + token (testy) + brak dowolnych ścieżek.
10. **Testy**: unit zielone + E2E zielone; `npm test` przechodzi.
11. **Dokumentacja**: README (uruchomienie), `PLAN.md` odświeżone (statusy faz),
    `STATUS.md`.

---

## 25. Decyzje architektoniczne (ADR — dlaczego, alternatywy)

### ADR-1: Node.js + TypeScript (cały stack)
- **Dlaczego**: jeden język FE/BE (wspólne typy: `ParamSchema`, DTO),
  `child_process` natywnie (spawn/kill/PID), HTTP (REST+SSE) natywny,
  cross-platform (Windows/Linux). Zero mostków (w przeciwieństwie do np.
  Go-behind-REST czy Python-uvicorn).
- **Alternatywy odrzucone**:
  - *Python/FastAPI*: świetny w ekosystemie ML, ale dwa języki (TS+Py),
    cięższy dev proces (uvicorn+pytest vs node+vitest), `subprocess` gorsza
    integracja z monitoringiem (brak natywnego event loop child).
  - *Go*: lepszy proces management, ale brak wspólnych typów z FE +
    wolniejszy development (kompilacje, mniej ekosystemu UI).
  - *Electron/Tauri (desktop app)*: użytkownik chce przeglądarki + lokalnego
    serwera; Electron = ciężki, Tauri = dodatkowy runtime. Serwer lokalny
    wystarczy (MVP).

### ADR-2: Deklaratywny schemat parametrów (dane), nie hardcoded UI
- **Dlaczego**: FC-3 ("nie zakładaj, że wszystkie parametry muszą być zakodowane
  w UI") + FA-2 (frontend nie zwiąże z llama.cpp). Schemat = dane w module
  engine; UI generuje formularz. Rozwój backendu = rozszerzenie danych.
- **Alternatywy**: (a) ręczne komponenty per parametr — łamie FA-2;
  (b) JSON Schema + generic renderer — dobry, ale słabsza kontrola nad
  grupami/`source`/specjalnymi typami (`path-model`); nasz `ParamSchema`
  to "JSON Schema + meta" w jednym.

### ADR-3: REST + SSE, nie WebSocket
- **Dlaczego**: strumienie są **jednokierunkowe** (logi, zdarzenia od serwera);
  komendy = żądania (REST). SSE = prostsze (fetch/EventSource, brak
  handshake, brak reconnect logic po stronie serwera, przez proxy/firewall
  lepiej przechodzi niż WS), wystarczający do MVP.
- **Alternatywy**: WebSocket — pełna dwukierunkowość, ale dodatkowy
  reconnect + auth + upgrade handshake; nie potrzebujemy push od klienta.
  (Drzwi otwarte: SSE hub jest w `api/sse.ts` — zamiana na WS = zmiana transportu,
  nie architektury.)

### ADR-4: Pliki JSON, nie SQLite
- **Dlaczego**: transparentność (user widzi/edytuje config w edytorze),
  zero zależności (brak binary sqlite3, brak migracji), git-friendly,
  wystarczające (single-user, niska częstotliwość zapisów).
- **Alternatywy**: SQLite — lepsza przy historii/zapytaniach; ale dodaje
  zależność + nieprzejrzystość (user nie widzi configu bez narzędzia).
  **Drzwi otwarte**: `config/store.ts` abstrahuje odczyt/zapis — zamiana na
  SQLite (np. dla historii) = nowa implementacja store, nie przebudowa.

### ADR-5: Dashboard = supervisor procesów (in-process), nie systemd/PM2
- **Dlaczego**: dashboard musi wiedzieć o stanie (PID, logi, stany) —
  jeśli sam nadzoruje, ma pełny obraz; child process = czyste kill + logi.
  systemd/scheduled task = zewnętrzna warstwa, z którą dashboard musiałby
  się dogadywać (D-Bus/REST), komplikuje MVP.
- **Alternatywy**: (a) systemd units generowane przez dashboard — cięższy,
  zależny od dystrybucji; (b) PM2 — dodatkowy demon. Obie: poza MVP.
  **Drzwi otwarte**: `process/manager.ts` izoluje spawn/kill — zamiana na
  "zewnętrzny supervisor" = adapter, nie przebudowa.

### ADR-6: Instance = (model, preset) z portem
- **Dlaczego**: pokrywa CFG-5 (presety jako pełne konfiguracje) + FP (jedno
  miejsce na stan). Ten sam model + różne presety = równoległe instancje
  (różne porty) — naturalna semantyka.
- **Alternatywy**: (a) instance = tylko proces (preset = tymczasowy) —
  tracimy "zapisaną konfigurację" między startami; (b) instance = tylko
  config (brak portu) — port = kolizja; (c) jeden instance per model —
  zabija CFG-5 (równoległe presety).

### ADR-7: Readiness = HTTP probe (autorytet), logi = dopełnienie
- **Dlaczego**: parse logów jest kruche (zmiany formatu między buildami);
  `GET /v1/models` = obiektywny dowód "backend odpowiada". Logi dają
  **wczesne** błędy (OOM w logach zanim proces wyjdzie) — to dopełnienie.
- **Alternatywy**: (a) tylko logi — kruche; (b) tylko probe — spóźnione
  wykrywanie błędów wczesnych. Hybryda = najlepsza.

### ADR-8: Loopback + opcjonalny token (security)
- **Dlaczego**: single-user, lokalnie (§4 A1). Loopback = domyślna
  "bramka" (żadna sieć). Token = opcja dla niestandardowego bindu
  (np. LAN do testów). Pełne auth (user/pas) = poza MVP (single-user).
- **Alternatywy**: (a) brak auth — ryzyko (bind LAN); (b) OAuth —
  zbyt ciężki dla single-user lokalnego.

### ADR-9: Fastify (nie express / własny router)
- **Dlaczego**: streaming/SSE pierwszorządowe, routing gotowy, lekki,
  TypeScript-first. Express = starszy ekosystem, własny router = kod bez
  potrzeby.
- **Alternatywy**: express (brak SSE wsparcia w core — dodatkowy middleware),
  `h3` (Nuxt) — dobry, ale Nuxt-dependent.

### ADR-10: React + Vite + hash routing (nie Vue/Svelte/SPA-serwer)
- **Dlaczego**: TS-first, duży ekosystem, Vite = szybki dev + build;
  hash routing = działa ze statycznego buildu (bez konfiguracji serwera).
  React 18 = stabilny; brak Redux (3 widoki + kreator onboarding).
- **Alternatywy**: Vue/Svelte — też dobre, ale TS ekosystem React większy
  (komponenty, testy). SSR = poza MVP (SPA lokalne).

---

## 26. Potencjalne problemy i ryzyka

| # | Problem | Prawdopodobieństwo | Mitigacja |
|---|---|---|---|
| P-1 | Flagi `llama-server` różnią się między buildami | wysokie | Zadanie 2.4: potwierdzenie z `--help` builda użytkownika; `schema.ts` = dane (łatwa zmiana) |
| P-2 | PID reuse po crashu | średnie | Reconcile: porównanie czasu startu procesu (`/proc`/`GetProcessTimes`) + sonda portu; `unknown` z procedurą (§11.3) |
| P-3 | Kill procesów | nie dotyczy (cel = Linux: SIGTERM/SIGKILL — §27.1) | Grace stop: SIGTERM → `stopTimeoutSec` (10 s) → SIGKILL; `llama-server` jest stateless (kill = czysty) |
| P-4 | Vulkan/CUDA buildy — różne binarki | średnie | `engines/llama-server.json → binary` (użytkownik wybiera); `preflight` sprawdza istnienie |
| P-5 | Duże modele — długi start (minuty) | wysokie | `startupTimeoutSec` per model (np. 600 s); UI pokazuje `starting` + logi na żywo (postęp ładowania) |
| P-6 | GPU OOM | średnie | Log patterns (P-5) + `preflight` (opcjonalny check GPU) + komunikat z akcją (zmniejsz `gpu-layers`) |
| P-7 | Kolizje portów | średnie | `ports.ts`: alokacja + kolizje + `PORT_IN_USE` z podpowiedzią |
| P-8 | Logi rosną (długie sesje) | średnie | Ring buffer + retention plików (§13) |
| P-9 | Dashboard zabity (nie model) | średnie | Reconcile (§11.3): model = "przywrócony" (`running`) |
| P-10 | GGUF reader — nietypowe pliki (multi-file, sharded) | niskie | MVP: single-file gguf; sharded = `unknown` + ręczne dodanie (FM-3) |
| P-11 | SSE reconnect (przeglądarka) | niskie | `EventSource` auto-reconnect; `lastEventId` (linie logów z ID) = brak straty |
| P-12 | User zmieni config w pliku przy działającym dashboardie | niskie | Watch plików config (fs `watch` + debounce) → reload + ostrzeżenie w UI (nie cicho) |
| P-13 | Wiele modeli na wiele GPU | niskie | MVP: `gpu-layers` per instancja (brak auto-assign GPU); extension: `--device` per instancja |
| P-14 | Build llama.cpp bez `--metrics` (lub innej flagi) | niskie | `args.ts` buduje komendę z flag **potwierdzonych w `--help`** (2.4) — flaga niewspierana = **pominięta** (spawn nigdy nie dostaje flagi, którą build odrzuci); `fetchRuntimeInfo` = null (graceful); UI: "brak metryk" |
| P-15 | Zła binarka (build bez Vulkan przy `gpu-layers > 0`) | niskie (preflight §10.5) | `ENGINE_BINARY_INVALID` z komunikatem + akcją (zmień ścieżkę w ONB/Ustawieniach albo `gpu-layers=0`); [Sprawdź] w kreatorze (ONB-1) |

---

## 27. Decyzje użytkownika + otwarte pytania

> **Decyzje użytkownika (2026-07)** — pytania 1–4, 7, 9 rozstrzygnięte:

1. **Platforma**: **Linux** (natywna) — ścieżki `/sys`, `/mnt`, kill
   (SIGTERM/SIGKILL), monitoring GPU przez sysfs / `amdgpu_top`. → TT-7.
2. **GPU**: **AMD + Vulkan** (nie ROCm) — binarka `llama-server` = build
   llama.cpp z `-DGGML_VULKAN=1`; offload GPU przez `gpu-layers` (`-ngl`);
   monitoring: sysfs `/sys/class/drm/` + `amdgpu_top` (opcjonalnie, A8).
   **Potwierdzone `--version` (2026-07)**: build wykrywa GPU — sterownik
   RADV (known-warning §10.4). → §10.5, FMK-4, A3.
3. **Ścieżka binarki `llama-server`**: wybierana przez użytkownika w
   **kreatorze pierwszego uruchomienia** (ONB-1), jeśli nie była wcześniej
   ustawiona; później edytowalna w Ustawieniach (ONB-2). Potwierdzenie
   flag = zadanie 2.4 (P-1). **Użytkownik ma już build**:
   `~/llama.cpp/build/bin/llama-server` — `0.4.0-dev` (build 1316, commit
   67672dc5), GNU 16.2.1, Linux x86_64, Vulkan aktywny (potwierdzone
   `--version`, 2026-07); kreator ONB-1 zapisze tę ścieżkę.
4. **Katalogi modeli**: wybierane przez użytkownika w kreatorze (ONB-1);
   dodatkowe katalogi i ręczne dodawanie modeli w dowolnym momencie
   (ONB-3, FM-1/FM-3). → `global.json → modelDirs`.

> Pozostałe pytania (5, 6, 8, 10–12) — opcjonalne, z domyślnymi w planie;
> można rozstrzygnąć w trakcie implementacji.
5. **Zakres portów**: 8080–8099 (domyślne §9.4) — OK?
6. **Język UI**: polski (domyślne A5) — OK? (API/identyfikatory angielskie.)
7. **Wiele instancji tego samego modelu** (równoległe presety, §11.1) —
   **TAK, zostaje w MVP** (potwierdzone 2026-07; A7/ADR-6).
8. **Autostart dashboardu** (system / tray) — MVP nie (A8); czy potrzebne po MVP?
9. **Stos**: Node/TS + React (A6) — **AKCEPTACJA** (potwierdzone 2026-07; ADR-1).
10. **Modele sharded / multi-file** — MVP: single-file gguf (P-10); czy użytkownik ma sharded?
11. **Ollama / vLLM** jako engine'y MVP? (plan: poza MVP, §18 — architektura gotowa)
12. **Zachowanie po crashu**: auto-restart? (MVP: nie — `crashed` + [Restart] w UI;
    auto-restart = ryzyko pętli; extension)

---

## 28. Checklist: spójność planu

- [x] Każde wymaganie z §2 ma: architekturę (§5–15), zadania (§22) i testy (§23).
- [x] Stany (FP-6): 7 stanów zdefiniowane (§11.2) + E2E (§23.2, krok 4–13).
- [x] Warstwy configu (FC): 6 warstw (§9.1) + merge (§9.1) + source (§9.1, §14.2).
- [x] Engine abstrakcja (FA): interfejs (§7.1) + schema (§7.2) + registry (§7.3) + checklist (§18).
- [x] API: wszystkie endpointy (§14.1) pokryte w zadaniach (faza 2, 3, 5, 6, 7).
- [x] Bezpieczeństwo (S-1..S-9): implementacja (§16) + faza 6/10.
- [x] Błędy: kody (§14) + zachowania (§17) + E2E (§23.2).
- [x] Decyzje: ADR-1..10 (§25) z alternatywami.
- [x] Ryzyka: P-1..P-15 (§26) z mitigacjami.
- [x] Otwarte pytania: 12 (§27) — 1–4, 7, 9 rozstrzygnięte (2026-07), 6 pozostałych z domyślnymi.
- [x] Onboarding (ONB-1..3): kreator (§20.0) + API `PUT /engines/:id` (§14.1) + faza 7 (7.5) + preflight §10.5.
- [x] Kryteria ukończenia: 11 (§24) — wszystkie testowalne.

---

## 29. Jak rozpocząć implementację (następna sesja)

1. §27: pytania 1–4, 7, 9 **rozstrzygnięte** (Linux, AMD+Vulkan, binarka +
   katalogi modeli = kreator ONB-1, równoległe instancje, Node/TS+React);
   pozostałe 6 z domyślnymi — można rozstrzygnąć w trakcie. Build:
   `~/llama.cpp/build/bin/llama-server` (0.4.0-dev, commit 67672dc5,
   Vulkan/RADV potwierdzony) — flagi i endpointy potwierdzone w 2.4
   (tabela §10.1, §10.3).
2. Otwórz `PLAN.md`, przejdź do **Faza 0** (§22) — zacznij od 0.1.
3. Konwencja sesji (§22 "Konwencja sesji implementacyjnej") — odświeżaj statusy.
4. Po każdej fazie: commit + `STATUS.md` + odhacz checkboxów w `PLAN.md`.

**Faza 0 = sesja 1 implementacji. Koniec planowania.**
