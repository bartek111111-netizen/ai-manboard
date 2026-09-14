import type { InstanceState } from '@ai-dashboard/shared';
import { stateUi } from '../ui/state';

/**
 * Instance-state badge (Faza 7.1, FP-6): a colored dot + label.
 * Colors come from the design tokens (`--color-state-*`).
 */
export function StatusBadge({ state, small = false }: { state: InstanceState; small?: boolean }) {
  const ui = stateUi(state);
  return (
    <span className={`status-badge${small ? ' small' : ''}`} style={{ color: `var(${ui.colorVar})` }}>
      <span className="status-badge-dot" aria-hidden="true" />
      {ui.label}
    </span>
  );
}
