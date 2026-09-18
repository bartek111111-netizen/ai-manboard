# STATUS

## Audyt zgodności ze specyfikacją + naprawa E2E (run-e2e.sh) — ✅ ZROBIONE (2026-09-18)

Pełny przegląd projektu (PLAN.md + STATUS.md vs. kod) + dwie naprawy:

1. **`run-e2e.sh` — naprawiony (poprzednio FAILował na kroku 1).**
   - Poprzednia wersja: (a) świeży home ma pusty `modelDirs` → discover zwracał
     `total:0` → FAIL „model not found"; (b) zhardkodowany `MODEL_ID=smollm2-135m-q2k`
     nie istnieje — modelId wynika z `slug + sha1(path)[:8]` (PLAN §8.1) i dla
     pliku `.e2e-models/SmolLM2-135M-Instruct-Q2_K.gguf` to
     `smollm2-135m-instruct-q2-k-9636cfd8`; (c) skrypt **reuse'ował bieżący serwer**
     na `BASE_URL` — z domyślnym portem 3100 tworzyłby preset `e2e-test` w **produkcyjnym**
     home. Nowa wersja: zawsze izolowany home (`/tmp/e2e-test`) + port `3199`
     (PLAN §23.4), seed `PUT /config/global` (modelDirs + binarka) przed discover,
     dynamiczny MODEL_ID (node, sha1), pełny lifecycle w teście: discover → preset
     (8123) → start (running 3 s) → **metryki** (4 sloty, GPU sysfs: Navi 48 / RX 9070,
     RSS, tok/s counters) → stop → **restart** (running 3 s) → final stop + trap
     zabijający serwer po teście. **E2E przechodzi z prawdziwą binarką**
     (`~/llama.cpp/build/bin/llama-server` 0.4.1-dev, 54315813).
2. **`resolve.test.ts` — lint error (`no-unused-vars` na argumencie mocka).**
   `eslint-disable-next-line` był o wiersz za wcześnie (linia nad `const`, błąd na
   wierszu wewnątrz obiektu) → dyrektywa nieaktywna + warning „unused directive".
   Mock `mockRegistry` teraz ma `get` **bez parametru** (TS: fewer args assignable)
   — błąd zniknął bez dyrektyw. Uwaga: w ESLint 10.10 `eslint-disable` (blokowy)
   i `eslint-disable-line` nie tłumiły `@typescript-eslint/no-unused-vars`
   (tylko `-next-line` działał) — po naprawie mocka żaden z tych tricków niepotrzebny.

Wynik audytu: bramki zielone (typecheck 3 workspace, lint, testy 60+173+15, build
web), schemat llama-server = 39 parametrów (spójne z ewolucją §10.1: model/
performance/sampling/server/chat/moe/vision/advanced/speculative + `jinja`/`mmproj`/
`reasoning-effort` dodane w poprzeczkach), FSM 7 stanów zgodny z §11.2, routing
§14.1 kompletny (PUT/DELETE `/instances/:id` celowo poza MVP — warstwa 6, STATUS Faza 5),
S-1 / GPU sysfs / LIVE tok/s / reconcile / kolizje portów potwierdzone w kodzie + testach.

Gates: typecheck/lint/testy (server 173/173, web 15/15, shared 60/60) + web build + **E2E (nowy skrypt) zielone**.

## Logi: jeden folder per model + czytelne nazwy + podstrony z hardlinkami + odnośniki w Status — ✅ ZROBIONE (2026-09-17)

Cztery poprawki po sprawozdaniu użytkownika:

1. **Logi: jeden folder per model (bez `--preset`) + czytelne nazwy.**
   `writer.ts` (logi LIVE) zapisywał do `logs/<modelId>--<presetName>/` (osobny
   folder per instancja), a `store.ts` (logi ZAPISANE) do `logs/<modelId>/`
   (jeden folder per model) — dwa różne katalogi. Fix: `LogWriter.instanceDir()`
   teraz zwraca `logs/<modelId>/` (parsuje `modelId` z `instanceId` przez
   pierwszy `--`), a `start()` nazywa plik `<preset>-<YYYY-MM-DD_HH-mm-ss>.log`
   (np. `112k_Context-2026-09-17_22-04-14.log`) — czytelna nazwa (widać preset
   - czas startu). Kolizje (dwa starty w tej samej sekundzie) dostają dopisek
     `-2`, `-3` itd. `latestFile`/`prune` sortują po stemplu (regex z pliku).
     `manager.stamp()` uprościł się do `Date.now()` (kolizje w `LogWriter.start`).
     Obie ścieżki (LIVE + ZAPISANE) teraz dzielą ten sam katalog `logs/<modelId>/`.
2. **Podstrony modelu: trwale linki (`?tab=` + `?preset=`).** `ModelDetail`
   przepisany — `tab` + `preset` pochodzą z `useSearchParams` (parametry URL),
   a nie ze stanu lokalnego. Dzięki temu odświeżenie strony **nie** resetuje
   na podstronę „Instancje" — URL zachowuje wybraną zakładkę + preset.
3. **Status: odnośniki Konfiguracja + Logi per karta.** `StatusPage` — karta
   z bieżącą instancją ma teraz dwa odnośniki (`status-nav-link`): „Konfiguracja"
   → `#/models/<id>?tab=config&preset=<preset>` i „Logi" → `?tab=logs`. Kliknięcie
   przenosi **odrazu** na odpowiednią podstronę (bez kilkukrotnego klikania).
4. **`.cmd-block` (okno komendy) — padding przy zalamaniu.** `.cmd-block`
   w `tokens.css` przepisany: bez obramowania (tylko `background` + `border-radius`),
   `padding: 14px 16px`, `line-height: 1.7`, `max-height: 42vh` — tekst przy
   zalamaniu nie „siedzi" na krawędziach. Nowy token `--color-bg-alt`
   (dark `#242528` / light `#ffffff`).

Gates: typecheck/lint/testy (server 168/168, web 15/15) + web build zielone.
Uwaga: zmiana #1 (LogWriter) wchodzi przy **następnym starcie dashboardu**;
#2–4 to FE (build web).

## UI: czytelniejsza „Komenda startowa” + wyraźniejsza ikona ⓘ + tryb uruchomienia w Metrykach — ✅ ZROBIONE (2026-09-17)

Trzy poprawki w UI (strona **Status** + zakładka **Metryki** — wspólny komponent
`InstanceMetrics`):

1. **Ikonka ⓘ (komenda startowa)** — zamiast ledwo widocznego kursywnego „i”
   (Georgia) teraz **wyraźna ikona SVG** (okrąg + kropka + lufcik), `currentColor`
   → podświetla się na hover/focus (przycisk większy, z tłem na hover). Bardziej
   czytelna i **jednoznaczna** (widać, że to „info”).
2. **Okno komendy (popup)** — szersze (440px), większy padding + odstęp między
   wierszami (tekst nie „siedzi" na górnej/dolnej krawędzi obramowania), a długa
   komenda **scrolluje się** (`max-height: 42vh`) zamiast rozbudowywać okno.
3. **Tryb uruchomienia w Metrykach** — w nagłówku grupy „Engine", obok ikony ⓘ,
   nowy chip: **🟢 Zostaje w tle / ⚪ Znika z dashboardem** (tooltip = opis
   trybu). Widoczny zarówno na stronie **Status** jak i w zakładce **Metryki**.

Gates: typecheck/lint/testy (server 168/168, web 15/15) + web build zielone.

## Fix: Stop nie zabijał adoptowanej instancji (orphan po restarcie) + CPU/RAM po restarcie — ✅ ZROBIONE (2026-09-17)

Po rebuildzie + restarcie dashboardu adoptowana instancja (`background` —
przeżyła restart) **nie dostawała metryk CPU/RAM** (widać tylko VRAM), a **Stop
ją osierocał**: „stop" czyścił rejestr, ale **nie zabijał procesu** (VRAM/RAM
zostały, instancja wróciła jako „spoza aplikacji" i doszedł **drugi proces**
tego samego modelu → podwójne zużycie RAM).

Przyczyna (jeden wspólny): `manager.active` trzyma obiekt `ChildProcess` **tylko**
dla procesów **uruchomionych przez BIECZĄCY** proces dashboardu. Adoptowana
instancja (przeżyła restart) ma żywy **PID w rejestrze**, ale **brak child**.
Dwie ścieżki polegały na `child`:

1. **`manager.stop()`** — przy `!active` **tylko** oznaczał rejestr `stopped` i
   wracał (**bez sygnału do PID**) → **orphan** (proces żyje, dashboard o nim
   zapomniał, detekcja → „spoza aplikacji").
2. **`readProcessMetrics()`** — brała PID z `manager.getActiveEntry(...).child.pid`
   → dla adoptowanej `undefined` → brak CPU/RAM (stąd tylko VRAM — on jest
   globalny z GPU, więc „zgadzał się").

Fix:

1. **`manager.stop()` / `terminate()`** — gdy brak `active`, ale w rejestrze jest
   **żywy PID** (running/starting/stopping), **sygnalizuje ten PID**: SIGTERM →
   grace → SIGKILL. `background` działa detached (własna grupa, pid = pgid) →
   sygnał do **grupy** (`-pid`), żeby trafić w silnik + dzieci. Nowy helper
   `signalPid()`.
2. **`readProcessMetrics()`** — PID teraz z **rejestru** (`registry.get(...).pid`),
   fallback na `child.pid` → metryki CPU/RAM działają też dla adoptowanych.

Gates: typecheck/lint/testy (server 168/168, web 15/15) + web build zielone.
Nowy test: `manager.test.ts → stop() signals an adopted instance (no orphan)`.
Uwaga: fix serwera wchodzi przy **następnym starcie dashboardu**.

## Metryki NA ŻYWO (tok/s podczas generowania) + uproszczenia (metryki /proc, dedup) — ✅ ZROBIONE (2026-09-17)

Trzy zmiany po sprawozdaniu użytkownika („gdy model aktywnie generuje — ma slot
aktywny — to mierz tok/s / prefill itd. na bieżąco; teraz wszystko aktualizuje
się dopiero, gdy model skończy całe zadanie"):

1. **Tok/s generowania to był ŚREDNI KUMULATYWNY, nie bieżąca szybkość.**
   `probe.ts` liczył `tokensPerSec = tokens_predicted_total / tokens_predicted_seconds_total`
   — to **średnia od startu** serwera, więc przy długim zadaniu (10+ min) liczba
   „leciała" i nie odzwierciedlała obecnego tempa. **Koncepcja zmieniona:**
   `probe.ts` wystawia teraz **surowe liczniki** (`extras.counters`:
   `tokensPredictedTotal` itd.); `lifecycle.ts → applyLiveRate()` trzyma poprzednią
   próbkę licznika per instancja i liczy **LIVE rate = Δtokens / Δczas** okna
   odczytu (UI pyta co 3 s). Gdy slot aktywnie generuje → **bieżąca** szybkość;
   gdy idle / przy 1. odczycie (brak poprzedniej próbki) → **fallback** do średniej
   kumulatywnej (nie pokazujemy mylącego 0). `extras.tokensPerSecAvg` trzyma
   średnią od startu do referencji. Prefill/TTFT i tak pochodzi z loga
   (`prompt processing` — pojawia się na **początku** żądania) i jest bieżący;
   `prefillTps` zostaje śr. od startu (oznaczony „śr.").
2. **Metryki procesu z `/proc` zamiast pełnego skanu procesów (uproszczenie + fix).**
   `getProcessMetrics()` używał `systeminformation.processes()` — **skanował CAŁĄ
   tabelę procesów** przy każdym odczycie (co 3 s). Fix: `readProcessMetrics()`
   czyta **bezpośrednio** `/proc/<pid>/status` (RSS) i `/proc/<pid>/stat`
   (jiffies CPU); CPU% = **LIVE rate** z różnicy jiffies w oknie odczytu (1. odczyt
   po starcie = null). Projekt Linux-only (§27) → `/proc` w porządku. Usunięty
   import `systeminformation` (już niepotrzebny).
3. **Dedup `getFullDto` / `getMetrics` (uproszczenie).** Obie metody **trzykrotnie**
   składały to samo (`fetchRuntimeInfo` + `applyLiveRate` + `getSystemMetrics` +
   metryki procesu). Fix: wspólny `collectRuntimeMetrics()` zwraca
   `{ runtime, process, gpu, ttft }`; obie metody go wywołują.

Gates: typecheck/lint/testy (server 167/167, web 15/15) + web build zielone.
Nowy test: `lifecycle.test.ts → derives a LIVE tok/s from the cumulative counter delta`.
Uwaga: zmiany serwera (1–3) wchodzą przy **następnym starcie dashboardu**.

## Kolory tytułów w modalu trybu (ciemny motyw) + kill DSH (cała grupa procesów) — ✅ ZROBIONE (2026-09-17)

Dwie poprawki po sprawozdaniu użytkownika:

1. **Tytuły w modalu trybu startu ledwo widoczne w ciemnym motywie.**
   `.launch-mode-title` siedzi w surowym `<button class="launch-mode-option">`,
   a `<button>` **nie dziedziczy** `color` (domyślnie czarny w przeglądarce)
   → w ciemnym motywie tytuły „Zostaje w tle" / „Znika z dashboardem" były
   czarne na ciemnym tle. Fix: `.launch-mode-option { color: var(--color-text) }`
   — tytuł dopasowuje się do motywu (jasny w dark, ciemny w light). Wcześniejszy
   scoped override light (`.launch-mode-intro`/`-desc → #7c7f88`) zostaje — to
   opisy w jasnym motywie.
2. **Kliknięcie „Stop DSH" nie robiło nicu.** Stara `findDshProcess()` trafiała
   tylko na wrapper `pnpm dsh web` (argv prawdziwego serwera DSH to
   `node … apps/cli/src/bin.ts web`, nie pasujący do grepów
   `dsh web|deepseek-harness`) i zabijała **jeden** PID — SIGTERM do wrappera
   zostawiał serwer DSH jako osierocony proces (wciąż działał). Fix
   (`api/handlers/dsh.ts`): `findDshProcesses()` zbiera PID **+ PGID** (grupa
   procesów); `killTargetFor()` = `-pgid` gdy proces jest liderem własnej grupy
   (nasz detached spawn — zabijamy całe drzewo), inaczej sam PID (nie ciągniemy
   cudzej grupy); stop = SIGTERM do całej grupy, po 3 s SIGKILL przetrwałym.
   Testy jednostkowe: `parseDshPs`, `killTargetFor` (`dsh.test.ts`).

Gates: typecheck/lint/testy (server 166/166, web 15/15) + web build zielone.
Uwaga: fix #2 (server) wchodzi przy **następnym starcie dashboardu**; #1 to FE
(build web / HMR dev).

## Logi: czasy w listie + automatyczne otwarcie bieżącego logu + kolory modala trybu — ✅ ZROBIONE (2026-09-17)

Trzy poprawki FE/server po sprawozdaniu użytkownika:

1. **Czas „przesunięty o 2h do tyłu" w nazwach zapisanych uruchomień.**
   Nazwy plików `auto-*.log`/`manual-*.log` niosą stempl **UTC bez znacznika
   strefy** (`2026-09-16T23-09-14`); FE parsował go jako lokalny → w CEST
   (UTC+2) czas wychodził o 2h wstecz. Fix: `store.ts → listRunLogs()` zwraca
   `ts` z **mtime pliku** jako pełny ISO z `Z` (pewna chwila zapisu); FE
   (`LogViewer`) rysuje `new Date(ts).toLocaleString()` → czas lokalny.
2. **Bieżący log nie otwierał się automatycznie.** Gdy instancja **nie działa**,
   widok live był pusty i użytkownik musiał klikać plik na liście. Fix:
   `LogViewer` pobiera stan instancji (`GET /api/v1/instances`); jeśli stan
   nie jest `running`/`starting`/`stopping`, po załadowaniu listy **sam otwiera
   najnowszy zapisany log** (raz; `autoLoadedRef`). Gdy instancja działa —
   widok live (SSE + replay ringu) JEST bieżącym logiem i nic się nie otwiera.
3. **Modal trybu startu — opisy „prawie czarne".** W jasnym motywie
   `--color-muted` (`#6b6e75`) na białym tle wyglądało niemal czarno. Fix:
   scoped override w `tokens.css` (sekcja `prefers-color-scheme: light`):
   `.launch-mode-intro` + `.launch-mode-desc` → `#7c7f88`.

Gates: typecheck/lint/testy (server 162/162, web 15/15) + web build zielone.
Uwaga: fix #1 (server) wchodzi przy **następnym starcie dashboardu**; #2/#3 to
FE (build web / HMR dev).

**Kontekst „2 wykryte instancje":** diagnoza na żywo — o 01:07 użytkownik
uruchomił nowy model, gdy stary silnik (00:09) wciąż się zamykał i trzymał
port **8080**; nowy engine zajął **8081** (auto-increment llama.cpp), a stary —
już zatrzymany z aplikacji, PID usunięty z rejestru — pojawił się jako
**zewnętrzny** (poprawne zachowanie detekcji, `detectExternalInstances`).
Ctrl+C dashboardu zabił grupę procesów (stary + nowy silnik, oba `session`).
Teraz: jeden czysty run na **8080** (session, pid 3711507).

## Logi: przywracanie przechwytywania logów dla zadoptowanych instancji tła — ✅ ZROBIONE (2026-09-17)

**Bug (wprowadzony przez tryby startu, `2181096d`):** dla instancji w trybie
**„Zostaje w tle"** (`background`) po **restartzie dashboardu** zakładka Logi
była trwale pusta. Reconcile poprawnie przywracał stan `running` (PID żyje),
ale ring buffer + file-tail poller żyły tylko w pamięci starego procesu
(`ProcessManager`): `getLogs()` → `[]`, replay SSE pusty, `onLogLine` nigdy
nie wywoływany — silnik pisał dalej do `logs/<instanceId>/*.log`, ale nic tego
nie odczytywało. Ścieżka `session` działała bez zmian (zweryfikowane na żywo
end-to-end: ring, SSE bezpośredni i przez proxy Vite, bundle świeży).

**Zmiany (`apps/server/src/core/process/manager.ts` + `index.ts`):**

- Ringi przeniesione z `ActiveInstance` do wspólnego `rings: Map` — istnieją
  także dla instancji zadoptowanych (bez własnego child process).
- `tails` — jeden rekord per tailowany plik (`timer` + `logFile` + `offset`);
  `startTail(instanceId, logFile)` zastępuje stary tail (nowy start = nowy plik).
- **Nowy `adoptLogTails(registry)`** (publiczne): dla wpisów rejestru ze stanem
  `running`/`starting` i żywym PID, bez entry w `active` — odpala file-tail na
  najsnowszym pliku `logs/<instanceId>/` (offset 0 → ring dostaje seed z istniejącego
  pliku, potem kolejne linie na żywo). Wywoływane w `index.ts` po
  `reconcileAll()`; log `re-attached live logs for: …`.
- `tailRead` dla zadoptowanych taili kończy się, gdy PID umarł lub stan
  rejestru jest stabilny (timer nie wycieka).
- Test regresyjny: „adopts a background instance's log file after a dashboard
  restart" — nowy manager nad tym samym home podąża za plikiem istniejącego
  silnika; ring zasilany + `onLogLine` (SSE) działa.

Gates: typecheck/lint/testy (server 162/162, łącznie 227) + web build zielone.
**Uwaga:** fix wchodzi przy **następnym starcie dashboardu** (restart zabija
instancje `session` — grupa procesów). Instancje `background` przeżywają restart
i odzyskują logi automatycznie.

## Poprawka reguły: parametry z pliku presetu (nie „≠ default") + fix ubatch-size default — ✅ ZROBIONE (2026-09-16)

**Reguła (poprawiona po wyjaśnieniu użytkownika):** parametry **ustawione przez
użyka** (obecne w pliku presetu) są wysyłane do `llama-server`; parametry
**nieobecne** w pliku presetu (użyk nie ustawił) **nie** są wysyłane. Schematyczne
defaulty **nie** są merge'owane do obiektu params. To **nie** jest reguła „≠ default" —
to **„czy param jest w pliku presetu"**.

**Zmiany:**

- `PresetSelect.tsx`: **revert** — `editParams` = `{...current.params}` (bez
  `schemaDefaults`). Plik presetu jest źródłem prawdy: parametry nieustawione
  są nieobecne, a launcher/podgląd wysyłają tylko to, co jest w pliku.
- `args-core.ts`: usunięto check „≠ default" — wysyłam **wszystko co jest w
  params** (zdefiniowane). Param nieobecny (`undefined`) → nie wysyłany.
- `SchemaForm.tsx`: `buildCommandPreview` nie merge'uje `schemaDefaults` —
  tylko params z presetu + host/port.
- `schema.ts`: `ubatch-size` default **1024 → 512** (faktyczny default llama.cpp).
- `args.test.ts`: przepisane testy pod nową regułę (params = tylko to, co user
  ustawił; pusty params → tylko `--model`).

**Bramki (2026-09-16):** typecheck + lint + testy zielone — **60 (shared) +
151 (server) + 15 (web) = 226/226**; web build OK.

## Nowa reguła: tylko parametry zmienione przez użytkownika + fix zapisu/wczytania presetu — ✅ ZROBIONE (2026-09-16)

**Reguła (decyzja użytkownika):** parametry **na domyśle** w ogóle **nie** są
wysyłane do `llama-server` (serwer działa na własnych defaultach); parametry
**ustawione przez użytkownika** (≠ default) **muszą** być w podglądzie i w
odpalaniu; te **niezaznaczone** nie pojawiają się nigdzie i nie odpalają —
dotyczy to **wszystkiego**, w tym `--host`/`--port`.

**Zmiany:**

- `schema.ts`: `offline` default → `false` (domyślny stan serwera = online,
  flaga `--offline` nieobecna).
- `args-core.ts`: usunięto „zawsze `--host`/`--port`" — teraz idą przez pętlę
  „≠ default" (wysyłane tylko gdy ≠ `127.0.0.1`/`8080`). `--model` zostaje
  zawsze (required). Plain bools (`--metrics`, `--offline`) wysyłane gdy `true`
  (flag-only: obecność = enabled).
- `args.test.ts`: zaktualizowane testy pod nową regułę (host/port tylko ≠
  default, offline default = false → nie wysyłane, metrics default = true →
  wysyłane).
- `PresetSelect.tsx`: **fix zapisu/wczytania** — `editParams` teraz
  `{...schemaDefaults, ...current.params}` (wcześniej tylko `current.params`).
  Dzięki temu: pola formularza pokazują domyślne wartości schematu (dla
  niezapisanych pól), a przy zapisie wysyłany jest **pełny** zestaw parametrów
  (nie tylko te zmienione w presetu).

**Bramki (2026-09-16):** typecheck + lint + testy zielone — **60 (shared) +
151 (server) + 15 (web) = 226/226**; web build OK.

## Poprawki: podgląd komendy = faktyczna komenda + pełne logi bez przycinania — ✅ ZROBIONE (2026-09-16)

Dwa zgłoszone bugi. **Podgląd ≠ faktyczna komenda:** FE miał własny builder
(`buildCommandPreview` w `SchemaForm`) z twardym binary i z surowymi parametrami
presetu (bez defaultów schematu) → brakowało `--offline`/`--metrics`/stanu jinja
i kolejność/flagi się różniły. Poprawka: wydzielono czysty, browser-safe
`buildLlamaServerArgs` (`shared/engine/llama-server/args-core.ts` — jeden builder
flagi, bez `node:path`) — `buildLlamaServerLaunch` (`args.ts`) go opakowuje
(cwd/env), a FE preview importuje `buildLlamaServerArgs` z `@ai-dashboard/shared`.
`SchemaForm` buduje parametry jako **merge defaultów schematu + wartości presetu +
host/port** i używa **prawdziwego binary** (`getEngines()`), więc podgląd jest
zawsze identyczny z odpalaną komendą (w tym `--offline`/`--metrics` i `--jinja`).
`PresetSelect` pobiera `binary` + `port` i podaje do `SchemaForm`. **Logi (reset
boxa, „1–2 linie"):** `LogViewer` co 500 ms **zamieniał** `lines` na ostatnią
partię (`.slice(-500)` + `setLines(buffer)`) → box „resetował się" i pokazywał
tylko ostatnie linie. Poprawka: **append** (`setLines(prev => [...prev, ...buffer])`)

- cap 10000 (był 500) → pełna historia na raz, bez przycinania, scroll (CSS
  `overflow-y`). SSE i tak replayuje ring (1000 linii) na połączeniu.

**Bramki (2026-09-16):** typecheck + lint + testy zielone — **60 (shared) +
151 (server) + 15 (web) = 226/226**; web build OK (FE importuje czysty builder,
brak `node:path` w browserze).

**Dalej:** CORS (10.3 PLAN), GPU metrics w UI, pełny E2E z crash (kill procesu),
docs polish, konsument debounce w UI (stateChangeDelaySec), opcjonalnie: fallback
logów na dysku dla instancji po restarcie dashboardu / odpalonych zewnętrznie.

## Po-Faza 10 — StatusPage + metryki per-proces + logi + jinja + auto-alokacja + bramki — ✅ ZROBIONE (2026-09-16)

Działa: pełna pętla + nowy StatusPage + wskaźniki stanu + persistence logów; bramka zielona.
**StatusPage:** nowa strona `pages/StatusPage.tsx` — siatka modeli running z metrykami na żywo
(czas pracy, % pracy, CPU/RAM) + licznik w sidebarze. **Metryki per-proces:** CPU%/RSS
przez `systeminformation` (cpu, memRss KB) + fallback `/proc` — w `MetricsPanel` i
`StatusPage` (poprawki: memRss=KB nie MB, real RSS). **Wskaźniki stanu (dots + toasty):**
header: kropki per model (blink, kolory hex, nazwy modeli) + toasty przy zmianie stanu;
`hooks/useModelState.ts` — polling 3 s (slots → idle/working/ready); debounce setting
w Settings (persist: `global.notifications.stateChangeDelaySec`, konsument UI — do zrobienia).
**Logi:** persistence — auto-save przy stop (last 3), manual save (last 10), historia +
clear per model (panel w `ModelDetail`); klasyfikacja poziomów (stderr ≠ error);
`/metrics` → tokensPerSec/contextSize; kopiuj ostatnie 40 linii. **Porty:** systemowy probe
(`isPortInUse`) + auto-alokacja wolnego portu gdy pinned jest zajęty (registry LUB system);
`resolve` używa bieżącego portu gdy instancja żywa (bez re-alokacji). **Jinja:** param
`--jinja`/`--no-jinja` (chat template) + grupa `chat` w SchemaForm. **Info:** strona Info
(wersja/engine/config) + DSH control w sidebarze (start/stop, PID).
**Bramki (2026-09-16):** typecheck (26 błędów) + lint (10) + testy resolve (stare
zachowanie portów) — naprawione: `portInUse` probe wstrzykiwalna w `InstanceResolver`
(testy deterministyczne, 3 nowe testy auto-alokacji), generiki Fastify 5 (`Params`/`Body`)
w handlers/logs.ts, grupa `chat` w `ParamSchema` (shared), `notifications` w `GlobalConfig`,
typowanie `si.processes()`, `LogLine[]` w autoSaveLogs. Bramka: **typecheck + lint + testy
zielone — 60 (shared) + 151 (server) + 15 (web) = 226/226**; web build OK.

**Dalej:** CORS (10.3 PLAN), GPU metrics w UI, pełny E2E z crash (kill procesu), docs polish,
konsument debounce w UI (stateChangeDelaySec).

## Faza 10 — Reconcile + hardening + docs — ✅ ZROBIONE

Działa: pełne pokrycie: lifecycle + crash + reconcile + security + GPU + E2E (PLAN §22 10.1–10.5).
**Reconcile (10.1):** `core/process/reconcile.ts` — startup reconcile (PLAN §11.3):
żywy proces → state niezmienione, martwy → `crashed`/`stopped`; `POST /instances/:id/resolve`
(ręczne rozstrzyganie `unknown`); UI: przycisk [Rozstrzygnij] dla `unknown` w `InstancePanel`.
**Security S-1 (10.3):** `security.ts` — reguła: bind ≠ loopback ⇒ wymagany token
(hard startup check); `validateSecurityConfig(host, token)` — throw przy naruszeniu.
**GPU monitor (10.2):** `gpu.ts` — opcjonalny: sysfs (AMD) + `nvidia-smi` (NVIDIA);
`readGpuInfo()` → `GpuInfo | null`. **E2E (10.4/10.5):** `tools/e2e/run-e2e.sh` —
pełny lifecycle (discover → preset → start → running → metrics → stop); crash/reconcile/
port collision pokryte unit testami. Bramka: **typecheck + lint + testy zielone —
149 (server) + 15 (web) = 164/164**; web build OK.

**Dalej:** projekt zakończony (PLAN 0–10 ✅). Możliwe rozszerzenia: pełny E2E z crash
(kill procesu), GPU metrics w UI, CORS (10.3 z PLAN), docs polish.

## Faza 9 — Config form + presety — ✅ ZROBIONE

Działa: pełna pętla: model → preset → config → start → monitorowanie (PLAN §22 9.1–9.3).
**SchemaForm (9.1):** `components/SchemaForm.tsx` — generyczny formularz renderowany
deklaratywnie ze schematu engine (`ParamSchema[]`): grupy (model/performance/sampling/
speculative/server/advanced), typy (int/float/string/bool/enum/path-model), walidacja
(min/max), źródło wartości; `advanced` params w `<details>` (collapsed). **Edycja
presetów (9.2):** `PresetSelect` — pełny formularz parametrów (SchemaForm) per preset,
[Zapisz] / [Anuluj]; CRUD (nowy/duplikuj/usuń) + port. **Settings (9.3):**
`pages/Settings.tsx` — globalne: katalogi modeli (textarea), binarki engine
(per-engine), zakres portów (start/end), security (token); [Zapisz] → `putGlobalConfig`.
`getEngineSchema` w `api/client.ts` (GET `/engines/:id/schema`). Bramka: **typecheck

- lint + testy zielone — 129 (server) + 15 (web) = 144/144**; web build OK.

**Dalej:** Faza 10 — reconciler + S-1 + GPU monitor + E2E pełny + docs.

## Faza 8 — Logi + monitoring — ✅ ZROBIONE

Działa: logi na żywo (SSE) + metryki runtime (PLAN §22 8.1–8.3).
**LogViewer (8.1):** `components/LogViewer.tsx` — linie logów z SSE
(`openLogStream`), filtry (poziom: all/info/warn/error, wyszukiwarka), auto-scroll
(odczepia się gdy scrolluje w górę), limit 500 linii; zintegrowany w `ModelDetail`
(zakładka "Logi"). **MetricsPanel (8.2):** `components/MetricsPanel.tsx` — metryki
runtime: `fetchRuntimeInfo` (slots, tokens/s, model loaded, context) + `process`
(CPU/RSS — Faza 10 pełny collector); polling DTO 3 s; zintegrowany w `ModelDetail`
(zakładka "Metryki"). **fetchRuntimeInfo (8.3):** `probe.ts` — `/v1/models`
(modelLoaded), `/slots` (total/used), `/health` (extras), `/metrics`
(availability + sample); `RuntimeInfo` typ w `shared/engine/types.ts`. Bramka:
**typecheck + lint + testy zielone — 129 (server) + 15 (web) = 144/144**; web build OK.

**Dalej:** Faza 9 — `SchemaForm` (31 parametrów ze schematu) + edycja presetów +
`Settings` (globalne); Faza 10 — reconciler + S-1 + E2E pełny.

## Faza 7 — Frontend: modele + start/stop — ✅ ZROBIONE

Działa: UI (React) — lista modeli, panel instancji, presety, onboarding (PLAN §22 7.1–7.5, §20).
**ModelList (7.1):** `pages/ModelList.tsx` — tabela modeli (nazwa/engine/capabilities/
rozmiar/preset/port/stan/akcje), preset select na wiersz, [Nowy skan] / [Dodaj model] /
[Ustawienia]; `hooks/useModelData.ts` — fetch models + instances + presets, polling 3 s;
`components/StatusBadge.tsx` (badge stanu z kolorem z `tokens.css`), `components/
CapabilityIcons.tsx` (ikony możliwości: 🔤👁🎧🔧🧠🎨). **InstancePanel (7.2):**
`components/InstancePanel.tsx` — state/PID/port/uptime/endpoint (kopiuj) + [Start] /
[Stop] / [Restart]; polling DTO 3 s + SSE `openEventStream` (badge live). **PresetSelect
(7.3):** `components/PresetSelect.tsx` — wybór + CRUD presetów (nowy / duplikuj / usuń,
edycja portu); pełna forma parametrów = Faza 9. **Błędy (7.4):** `ui/errors.ts` —
`errInfo` (message + code) + `errorAction` (sugestia dla `MODEL_NOT_FOUND` /
`INSTANCE_LIVE` / `ENGINE_BINARY_INVALID` / `UNAUTHORIZED`); `components/ErrorNotice.tsx`
(komunikat + "Co zrobić"). **Onboarding (7.5):** `pages/Onboarding.tsx` — kreator
(binarka `llama-server` + [Sprawdź] preflight, katalogi modeli + [Zapisz] + [Nowy skan],
[Pomiń]); `hooks/useOnboarding.ts` — wykrywanie (brak binarki LUB `modelDirs` puste);
`pages/HomeView.tsx` — Onboarding albo ModelList. **Fix server:** `resolve.ts` — wyklucza
port bieżącej instancji z `taken` (GET `/instances/:id` nie triggeruje `PORT_IN_USE`).
Bramka: **typecheck + lint + testy zielone — 129 (server) + 15 (web) = 144/144**;
web build OK. E2E: świeży `AI_DASHBOARD_HOME` → kreator → skan → start → `running` +
endpoint (port 8124, PID 62, uptime 5 s).

**Dalej:** Faza 8 — `LogViewer` (SSE logi) + `MetricsPanel` (CPU/RSS/GPU); Faza 9 —
`SchemaForm` + dashboard + `Settings`; Faza 10 — reconciler + S-1 + CORS.

## Faza 6 — API uzupełnieniowe + SSE + auth — ✅ ZROBIONE

Działa: API uzupełnieniowe (PLAN §22 6.1–6.5, §14.1) + SSE + token.
**Presety CRUD (6.1):** `api/handlers/presets.ts` — `makePresetHandlers(store)`:
`GET /api/v1/models/:modelId/presets` (lista), `PUT …/presets/:name` (create/update,
`validatePreset`, `version:1` default, `name` z URL), `DELETE …/presets/:name`
(`PRESET_NOT_FOUND` 404), `POST …/presets/:name/duplicate` (klon pod nowym
`{name}`, 201); `deletePreset` w `ConfigStore`. **SSE hub (6.2):** `core/sse/hub.ts` —
`SseHub` (pub/sub): `subscribeLog(instanceId, cb)` / `subscribeEvents(cb)`
(zwracają unsubscribe), `publishLog`/`publishState` (hooki managera);
`api/handlers/sse.ts` — `GET /api/v1/stream/:instanceId/logs` (replay ring +
live linie `event: log`), `GET /api/v1/stream/events` (`event: state`);
manager publikuje przez `onStateChange` + `onLogLine` (dodane hooki),
`reply.hijack()` + `text/event-stream`. **Pełne DTO (6.3):** `getFullDto`
w `lifecycle.ts` (typ `InstanceDto`): `instanceId/modelId/preset/state/pid/port/
endpoint/startedAt/uptimeSec` + `configSource` (per-param layer z `resolved`) +
`runtime` (`engine.fetchRuntimeInfo`, null gdy nie-live) + `process`
(`{cpuPct,rssMB}` = null, Faza 8) + `lastError` (exitCode/signal z rejestru);
handlery `get`/`metrics`/`logs` (`?limit=`) w `instances.ts`. **Auth (6.4, S-2):**
`api/auth.ts` — `sha256` + `makeAuthMiddleware(getTokenHash)`: `onRequest` hook,
`Authorization: Bearer <token>` (REST) albo `?token=` (SSE, S-7), `null` = no-op,
`/healthz`+`/`+`/assets/` exempt, `UNAUTHORIZED` 401; `getTokenHash` w
`buildApp` (`store.readGlobal().security.token`). **Testy (6.5):** presety (5),
SSE (hub 2 + stream 2), auth (7: 401 brak/źle, 200 poprawnie, `?token=`, no-op,
healthz exempt), DTO/metrics/logs (4). Bramka: **typecheck + lint + testy
zielone — 60 (shared) + 129 (server) = 189/189**.

**Dalej:** Faza 7 — UI (React): `InstancePanel` (start/stop/restart + endpoint +
PID + uptime + logi na żywo z SSE) + `ConfigEditor` + `PresetList`; Faza 8 —
metryki (CPU/RSS/GPU); Faza 9 — dashboard; Faza 10 — reconciler + S-1.

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
(`engine.validate` → `VALIDATION_FAILED` 400, `engine.preflight` → `PREFLIGHT_FAILED` 400) → `manager.spawn` (stan `starting`) → tło `driveStartup`: probe OK →
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

- realne pliki, registry (add/get/update/remove), API (pełny lifecycle 201→GET→
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

- parametrów `VALIDATION_FAILED`, zapis `config/engines/<id>.json`). Testy:
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
