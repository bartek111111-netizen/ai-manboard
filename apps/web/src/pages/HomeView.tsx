import { useOnboarding } from '../hooks/useOnboarding';
import { ModelList } from './ModelList';
import { Onboarding } from './Onboarding';

/**
 * Home view (Faza 7): shows the onboarding wizard when setup is incomplete
 * (no binary or no model dirs), otherwise the model list.
 */
export function HomeView() {
  const { needed, checking, refresh } = useOnboarding();

  if (checking) {
    return null;
  }
  if (needed) {
    return <Onboarding onDone={refresh} />;
  }
  return <ModelList />;
}
