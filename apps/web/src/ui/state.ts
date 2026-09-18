/**
 * Instance-state → UI mapping (Faza 7.1, FP-6): the label + color variable
 * for the `StatusBadge`. Kept as a pure function so it can be unit-tested
 * without a DOM.
 */
import type { InstanceState } from "@ai-dashboard/shared";

export interface StateUi {
  /** The CSS custom property that holds the state color. */
  colorVar: string;
  /** The Polish label (i18n key resolved by the caller). */
  label: string;
  /** A short symbol used in the list column. */
  symbol: string;
}

const MAP: Record<InstanceState, StateUi> = {
  running: { colorVar: "--color-state-running", label: "Działa", symbol: "🟢" },
  starting: {
    colorVar: "--color-state-starting",
    label: "Uruchamianie",
    symbol: "🔵",
  },
  stopping: {
    colorVar: "--color-state-stopping",
    label: "Zatrzymywanie",
    symbol: "🟡",
  },
  stopped: {
    colorVar: "--color-state-stopped",
    label: "Zatrzymany",
    symbol: "⚪",
  },
  error: { colorVar: "--color-state-error", label: "Błąd", symbol: "🔴" },
  crashed: { colorVar: "--color-state-crashed", label: "Awaria", symbol: "🔴" },
  unknown: {
    colorVar: "--color-state-unknown",
    label: "Nieznany",
    symbol: "❓",
  },
};

/** Maps a state to its UI representation (falls back to `unknown`). */
export function stateUi(state: InstanceState): StateUi {
  return MAP[state] ?? MAP.unknown;
}

/** Whether the instance is in a "live" state (start/stop available). */
export function isLiveState(state: InstanceState): boolean {
  return state === "running" || state === "starting" || state === "stopping";
}
