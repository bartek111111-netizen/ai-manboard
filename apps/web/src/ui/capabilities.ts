/**
 * Capability → icon mapping (Faza 7.1): the `CapabilityIcons` component maps
 * each enabled capability flag to an icon. Kept as a pure function so it can
 * be unit-tested without a DOM.
 */
export interface CapabilityUi {
  icon: string;
  /** The capability key (used as a title/tooltip). */
  key: string;
}

const ICONS: Record<string, string> = {
  text: '🔤',
  vision: '👁',
  audio: '🎧',
  'tool-calling': '🔧',
  thinking: '🧠',
  'image-generation': '🎨',
};

/** The icon for a capability key (a generic bullet when unknown). */
export function capabilityIcon(key: string): CapabilityUi {
  return { icon: ICONS[key] ?? '•', key };
}

/**
 * The icons for the enabled capability flags, in stable order.
 * `flags` = `{ [capability]: boolean }`.
 */
export function capabilityIcons(flags: Record<string, boolean>): CapabilityUi[] {
  return Object.entries(flags)
    .filter(([, on]) => on)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key]) => capabilityIcon(key));
}
