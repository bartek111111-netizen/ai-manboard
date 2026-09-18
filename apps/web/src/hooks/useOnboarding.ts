import { useCallback, useEffect, useState } from "react";
import { getConfig, getEngines } from "../api/client";

export interface OnboardingState {
  /** True when the onboarding wizard should be shown. */
  needed: boolean;
  checking: boolean;
  refresh: () => void;
}

/**
 * Detects whether the onboarding wizard is needed (Faza 7.5, ONB-1/ONB-2):
 * shown when the `llama-server` engine has no binary OR `global.modelDirs`
 * is empty. Re-checks after each onboarding action.
 */
export function useOnboarding(): OnboardingState {
  const [needed, setNeeded] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback((): void => {
    Promise.all([getEngines(), getConfig()])
      .then(([engines, config]) => {
        const llama = engines.find((e) => e.id === "llama-server");
        const noBinary = !llama?.configured;
        const noDirs = config.global.modelDirs.length === 0;
        setNeeded(noBinary || noDirs);
      })
      .catch(() => {
        // API unavailable — treat as onboarding-needed so the wizard can retry
        setNeeded(true);
      })
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { needed: needed === true, checking, refresh };
}
