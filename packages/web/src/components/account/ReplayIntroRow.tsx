import { RotateCcw } from 'lucide-react';

// Same key as features/Onboarding.tsx.
const ONBOARDING_KEY = 'festie_onboarding_completed';

/** Clears the onboarding flag and reloads home, where the intro shows again. */
export default function ReplayIntroRow() {
  const replay = () => {
    try {
      localStorage.removeItem(ONBOARDING_KEY);
    } catch {
      // localStorage unavailable: the reload below still lands on home.
    }
    window.location.assign('/');
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-card p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary">Replay intro</p>
        <p className="text-xs text-text-muted">Show the welcome walkthrough again</p>
      </div>
      <button
        type="button"
        onClick={replay}
        aria-label="Replay intro"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary"
      >
        <RotateCcw className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
