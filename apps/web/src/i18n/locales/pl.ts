/**
 * Polish locale — the display language of the UI (plan A5).
 * Keys are stable; the values are what the user actually sees.
 */
export const pl = {
  appTitle: "AI Model Dashboard",
  navDashboard: "Pulpit",
  navStatus: "Status",
  navSettings: "Ustawienia",
  statusHeading: "Status API",
  statusLoading: "Ładowanie statusu…",
  statusError: "Nie można połączyć z API dashboardu",
  fieldAppName: "Aplikacja",
  fieldVersion: "Wersja",
  fieldState: "Stan",
  fieldUptime: "Czas pracy",
  enginesEmpty: "brak — moduły engine pojawią się w kolejnych fazach",
  statusAutoRefresh:
    "Odświeżanie: co 5 s (zmiany configu w plikach są wykrywane automatycznie)",
  configHeading: "Konfiguracja (pliki)",
  configHome: "Katalog konfiguracji",
  configWatchActive: "Odczyt zmian w plikach (fs watch)",
  configWatchOn: "aktywny",
  configWatchOff: "nieaktywny",
  configLastChange: "Ostatnia zewnętrzna zmiana pliku",
  configNoChanges: "brak",
  configReloadCount: "Reloady po zmianie pliku",
  configReloadError: "Błąd ostatniego reloadu",
  placeholderTitle: "W trakcie budowy",
  placeholderDesc:
    "Ten widok pojawi się w kolejnych fazach implementacji (PLAN.md).",

  // Models (Faza 7.1)
  modelsEmpty: "Brak modeli. Kliknij [Nowy skan] lub [Dodaj model].",
  colName: "Nazwa",
  colEngine: "Engine",
  colCapabilities: "Możliwości",
  colSize: "Rozmiar",
  colPreset: "Preset",
  colPort: "Port",
  colState: "Stan",
  colActions: "Akcje",
  presetNone: "brak presetu",
  capabilitiesEmpty: "brak oznaczonych możliwości",
  scanResult: "Znaleziono:",
  actionScan: "Nowy skan",
  actionAddModel: "Dodaj model",

  // Instance panel (Faza 7.2)
  fieldPreset: "Preset",
  fieldPort: "Port",
  fieldPid: "PID",
  fieldEndpoint: "Endpoint",
  fieldEngine: "Engine",
  fieldName: "Nazwa (wyświetlana)",
  fieldPath: "Ścieżka",
  fieldSize: "Rozmiar",
  fieldArch: "Architektura",
  fieldContext: "Kontekst",
  copy: "Kopiuj",
  copied: "Skopiowano",
  lastError: "Ostatni błąd",
  actionStart: "Start",
  actionStop: "Stop",
  actionRestart: "Restart",
  presetRequired: "Wybierz preset, aby zarządzać instancją.",

  // Presets (Faza 7.3)
  presetHeading: "Presety",
  presetsEmpty: "Brak presetów — utwórz pierwszy poniżej.",
  presetSelect: "Wybór presetu",
  actionSave: "Zapisz",
  actionDuplicate: "Duplikuj",
  actionDelete: "Usuń",
  actionNewPreset: "Nowy",
  dupPrompt: "Nazwa kopii presetu:",
  delConfirm: "Usunąć ten preset?",
  newPresetPlaceholder: "nazwa presetu",
  autoAssign: "Przypisz automatycznie jako domyślny",
  defaultTag: "domyślny",

  // Status page (running models)
  noRunningModels: "Brak uruchomionych modeli.",
  stateWorking: "generuje",
  stateIdle: "wolny",
  stateReady: "gotowy",

  // Info page
  navInfo: "Info",
  infoHeading: "Informacje o aplikacji",

  // Notifications settings
  settingsNotifications: "Powiadomienia",
  notificationsDesc: "Opcje dotyczące powiadomień o zmianie stanu modeli.",
  stateChangeDelayLabel: "Opóźnienie zmiany stanu (s)",
  stateChangeDelayHint:
    "Gdy model często przeskakuje między stanami (idle/working), opóźnienie uniemożliwia spam powiadomeń. Np. 5 = komunikat pojawi się po 5s stabilnego stanu.",

  // Detail tabs
  tabPreview: "Podgląd",
  tabConfig: "Konfiguracja",
  tabInstance: "Instancja",
  tabLogs: "Logi",
  tabMetrics: "Metryki",
  modelNotFound: "Nie znaleziono modelu",

  // Onboarding (Faza 7.5)
  onbTitle: "Szybka konfiguracja",
  onbIntro:
    "Ustaw binarkę silnika i katalogi z modelami, aby rozpocząć pracę z panelem.",
  onbBinaryStep: "Krok 1 — binarka llama-server",
  onbBinaryPlaceholder:
    "ścieżka do llama-server (np. /home/u/llama.cpp/build/bin/llama-server)",
  onbCheck: "Sprawdź",
  onbCheckOk: "Binarka OK",
  onbDirsStep: "Krok 2 — katalogi modeli",
  onbDirsPlaceholder: "katalogi z modelami GGUF (jeden na wiersz)",
  onbScanResult: "Skan zakończony:",
  onbSkip: "Pomiń",

  // Error actions (Faza 7.4)
  errActionModelNotFound:
    "Upewnij się, że model istnieje — uruchom [Nowy skan] lub dodaj go ręcznie.",
  errActionInstanceLive: "Instancja już działa. Zatrzymaj ją, aby ją zmienić.",
  errActionEngineBinary:
    "Sprawdź ścieżkę do binarki i uprawnienia (czy jest wykonywalna, czy ma --version, libvulkan).",
  errActionUnauthorized: "Podaj token dostępu w Ustawieniach (S-2).",
  errActionPrefix: "Co zrobić",

  // LogViewer (Faza 8.1)
  logFilterLevel: "Filtruj po poziomie",
  logFilterAll: "Wszystkie",
  logSearchPlaceholder: "szukaj w logach…",
  logAutoScroll: "auto-scroll",
  logEmpty: "Brak linii logów (instancja nie działa albo filtr pusty).",

  // MetricsPanel (Faza 8.2)
  metricsHeading: "Metryki",
  metricsContextSize: "Rozmiar kontekstu",
  metricsSlots: "Sloty (używane/total)",
  metricsTokensPerSec: "Szybkość generowania (tokens/s)",
  metricsCpu: "CPU procesu",
  metricsRss: "Pamięć RAM procesu",
  metricsWorkTime: "Czas pracy (generowanie)",
  metricsWorkPct: "% czasu pracy",
  metricsNotLive: "Metryki dostępne tylko dla uruchomionej instancji.",
  // Grouped metrics (engine / process / GPU)
  groupEngine: "Engine (llama-server)",
  groupProcess: "Proces",
  groupGpu: "GPU",
  // External instances (detected outside the app, PLAN §16.4)
  externalBadge: "SPOZA APLIKACJI",
  externalDescription:
    "Wykryto proces silnika uruchomiony spoza aplikacji (nie przez dashboard). Dane przechwycono z systemu.",
  groupParams: "Parametry (przechwycona komenda)",
  groupModel: "Model",
  copyCommand: "Kopiuj komendę",
  launchCommand: "Komenda startowa",
  fieldModelPath: "Ścieżka modelu",
  fieldQuantization: "Kwantyzacja",
  fieldHost: "Host",
  metricsPrefill: "Prefill — śr. tok/s",
  metricsTtft: "Czas do 1. tokena (TTFT)",
  metricsGpuUtilization: "Wykorzystanie GPU",
  metricsGpuName: "Karta",
  metricsGpuMemoryVram: "Pamięć (VRAM)",
  openChatInBrowser: "Uruchom Chat w przeglądarce",

  // SchemaForm (Faza 9.1)
  enumSelect: "— wybierz —",
  enumCustomNumber: "własna wartość (liczba)",
  pathModelPlaceholder: "ścieżka do pliku GGUF",
  advancedSection: "Parametry zaawansowane",
  commandPreview: "Podgląd komendy",

  // Instance resolve (Faza 10.1)
  actionResolve: "Rozstrzygnij",

  // Header status

  // Add model modal
  addModelTitle: "Dodaj model",
  modelPathLabel: "Ścieżka do pliku modelu",
  displayNameLabel: "Nazwa wyświetlana",
  browseBtn: "Przeglądaj",
  addModelBtn: "Dodaj",
  addingBtn: "Dodawanie...",
  cancelBtn: "Anuluj",

  // Settings — GPU selection
  settingsGpuSelection: "Karta graficzna",
  gpuSelectionDesc:
    "Wybrana karta będzie pokazana w statystykach po lewej stronie (sidebar).",
  noGpusDetected: "Nie wykryto GPU",
  gpuNotSelected: "GPU nie zaznaczone w ustawieniach",
  gpuUseCustomName: "Użyj własnej nazwy GPU",
  gpuCustomLabel: "Własna nazwa GPU",
  gpuCustomLabelPlaceholder: "np. RX 9070 XT",
  gpuCustomLabelHint:
    "Gdy zaznaczone, ta nazwa zastępuje wykrytą nazwę GPU we wszystkich miejscach (sidebar, Status, Metryki).",

  // File picker
  showHidden: "Pokaż ukryte",
  selectFile: "Wybierz plik",
  selectFolder: "Wybierz folder",
  upDir: "W górę",
  loading: "Ładowanie...",
  emptyDir: "Pusty folder",
  selectCurrentDir: "Wybierz ten folder",

  // Settings — model dirs list
  noModelDirs: "Brak katalogów — dodaj pierwszy",
  addModelDir: "Dodaj katalog",
  removeDir: "Usuń katalog",

  // Hidden models
  hiddenModelsHeading: "Ukryte modele",
  noHiddenModels: "Brak ukrytych modeli",
  unhideModel: "Pokaż",

  // Engine auto-detect
  autoDetectBtn: "Wykryj",

  // Engine status
  engineHeading: "Engine (backendy)",
  engineConfigured: "Skonfigurowany",
  engineNotConfigured: "Brak binarki",
  engineBinary: "Binarka",
  testEngineBtn: "Testuj",
  testingEngine: "Testowanie...",

  // System status
  systemStatusHeading: "Status systemu",
  gpuUtilization: "GPU",
  gpuMemory: "VRAM",
  gpuHeading: "GPU",
  gpuNotAvailable: "GPU nie wykryte",
  cpuHeading: "CPU",
  cpuUsage: "Wykorzystanie",
  cpuLoadAvg: "Średni load",
  cpuTemperature: "Temperatura",
  cpuNotAvailable: "CPU metrics niedostępne",
  ramHeading: "RAM",
  ramUsage: "Zajętość",
  ramUsed: "Użyto",
  ramNotAvailable: "RAM metrics niedostępne",

  // Preset editor (Faza 9.2)
  presetSave: "Zapisz",
  presetCancel: "Anuluj",
  presetParamsHeading: "Parametry",

  // Settings (Faza 9.3)
  settingsHeading: "Ustawienia globalne",
  settingsModelDirs: "Katalogi modeli",
  settingsEngines: "Binarki engine",
  settingsEngineBinary: "Ścieżka binarki",
  settingsPortRange: "Zakres portów",
  settingsPortStart: "Start",
  settingsPortEnd: "Koniec",
  settingsSecurity: "Security",
  settingsToken: "Token dostępu",
  settingsTokenPlaceholder: "pusty = wyłączone",
  settingsSave: "Zapisz",
  settingsSaved: "Zapisano",

  // Launch-mode choice (start/restart) — how the engine is tied to the dashboard.
  launchModeTitle: "Jak uruchomić model?",
  launchModeIntro:
    "Wybierz, jak model ma się zachować, gdy dashboard zostanie zamknięty lub zrestartowany:",
  launchModeBackground: "Zostaje w tle",
  launchModeBackgroundDesc:
    "Model będzie działał dalej, nawet gdy dashboard się zamknie lub zrestartuje.",
  launchModeSession: "Znika z dashboardem",
  launchModeSessionDesc:
    "Model zatrzyma się razem z dashboardem (gdy dashboard się zamknie).",
  launchModeTag: "Tryb uruchomienia",

  // DSH control (left sidebar) — start/stop the DeepSeek Harness process.
  // The operation runs in the background and takes a few seconds, so a busy
  // state + note tell the user something is happening while they wait.
  dshStart: "Odpal DSH",
  dshStop: "Zatrzymaj DSH",
  dshBusyStart: "Odpalam DSH…",
  dshBusyStop: "Zatrzymuję DSH…",
  dshBusyNote: "Komenda DSH wykonuje się w tle — poczekaj chwilę…",
} as const;
