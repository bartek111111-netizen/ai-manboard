import { capabilityIcons } from '../ui/capabilities';
import { t } from '../i18n';

/**
 * Capability icons (Faza 7.1): renders the enabled capability flags as icons
 * (one per capability), with a title tooltip.
 */
export function CapabilityIcons({ flags }: { flags: Record<string, boolean>; manual?: boolean }) {
  const icons = capabilityIcons(flags);
  if (icons.length === 0) {
    return <span className="muted">{t('capabilitiesEmpty')}</span>;
  }
  return (
    <span className="capability-icons">
      {icons.map(({ icon, key }) => (
        <span key={key} className="capability-icon" title={key}>
          <span className="capability-icon-symbol">{icon}</span>
          <span className="capability-icon-label">{key}</span>
        </span>
      ))}
    </span>
  );
}
