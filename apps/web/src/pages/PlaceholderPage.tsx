import { t } from '../i18n';

/** A view that will be implemented in a later phase (PLAN.md §22). */
export function PlaceholderPage() {
  return (
    <section>
      <h2>{t('placeholderTitle')}</h2>
      <p className="muted">{t('placeholderDesc')}</p>
    </section>
  );
}
