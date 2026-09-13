/**
 * Polish locale — the display language of the UI (plan A5).
 * Keys are stable; the values are what the user actually sees.
 */
export const pl = {
  appTitle: 'AI Model Dashboard',
  navDashboard: 'Pulpit',
  navModels: 'Modele',
  navSettings: 'Ustawienia',
  dashboardTitle: 'Pulpit',
  statusHeading: 'Status API',
  statusLoading: 'Ładowanie statusu…',
  statusOk: 'API działa',
  statusError: 'Nie można połączyć z API dashboardu',
  statusErrorHint: 'Sprawdź, czy serwer działa (npm run dev:server)',
  fieldAppName: 'Aplikacja',
  fieldVersion: 'Wersja',
  fieldState: 'Stan',
  fieldUptime: 'Czas pracy',
  fieldEngines: 'Engine (backendy)',
  enginesEmpty: 'brak — moduły engine pojawią się w kolejnych fazach',
  statusAutoRefresh: 'Odświeżanie: co 5 s (zmiany configu w plikach są wykrywane automatycznie)',
  configHeading: 'Konfiguracja (pliki)',
  configHome: 'Katalog konfiguracji',
  configWatchActive: 'Odczyt zmian w plikach (fs watch)',
  configWatchOn: 'aktywny',
  configWatchOff: 'nieaktywny',
  configLastChange: 'Ostatnia zewnętrzna zmiana pliku',
  configNoChanges: 'brak',
  configReloadCount: 'Reloady po zmianie pliku',
  configReloadError: 'Błąd ostatniego reloadu',
  placeholderTitle: 'W trakcie budowy',
  placeholderDesc: 'Ten widok pojawi się w kolejnych fazach implementacji (PLAN.md).',
} as const;
