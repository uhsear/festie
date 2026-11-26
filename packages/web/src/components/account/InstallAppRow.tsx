import { useState } from 'react';
import { ACCOUNT_COPY } from '@festie/shared/constants';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import { isIOSSafari, isStandalone } from '../../hooks/useIOSInstall';
import IOSInstallDrawer from '../features/IOSInstallDrawer';
import Button from '../ui/Button';

/**
 * Install Festie row for Help and legal. Uses the prompt Header captured, the
 * iOS Add to Home Screen steps, or a plain how-to line where neither exists.
 */
export default function InstallAppRow() {
  const [installed, setInstalled] = useState(() => isStandalone());
  const [canPrompt, setCanPrompt] = useInstallPrompt();
  const [showSteps, setShowSteps] = useState(false);

  if (installed) return null;

  const ios = !canPrompt && isIOSSafari();

  const install = async () => {
    const evt = window.__festieInstallPrompt;
    if (!evt) return;
    let outcome: 'accepted' | 'dismissed' = 'dismissed';
    try {
      await evt.prompt();
      outcome = (await evt.userChoice).outcome;
    } catch {
      // Prompt already used or blocked: the browser offers no second prompt.
    }
    window.__festieInstallPrompt = null; // eslint-disable-line require-atomic-updates -- module-level flag, not a real race
    setCanPrompt(false);
    if (outcome === 'accepted') setInstalled(true);
  };

  return (
    <div className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-bg-card p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary">{ACCOUNT_COPY.installTitle}</p>
        <p className="text-xs text-text-muted">
          {canPrompt || ios ? ACCOUNT_COPY.installHint : ACCOUNT_COPY.installUnsupported}
        </p>
      </div>
      {canPrompt && (
        <Button variant="secondary" size="sm" className="min-h-[44px] shrink-0" onClick={() => void install()}>
          {ACCOUNT_COPY.installButton}
        </Button>
      )}
      {ios && (
        <Button variant="secondary" size="sm" className="min-h-[44px] shrink-0" onClick={() => setShowSteps(true)}>
          {ACCOUNT_COPY.installHowTo}
        </Button>
      )}
      {/* Closing from here skips the 30-day dismissal the automatic sheet records. */}
      {ios && <IOSInstallDrawer open={showSteps} onClose={() => setShowSteps(false)} />}
    </div>
  );
}
