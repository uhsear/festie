import { useUIStore } from '@festie/shared/stores/uiStore';
import { ACCOUNT_COPY } from '@festie/shared/constants';
import { useHaptics } from '../../hooks/useHaptics';
import Switch from '../ui/Switch';

export default function HapticsSection() {
  const enabled = useUIStore((s) => s.hapticsEnabled);
  const setEnabled = useUIStore((s) => s.setHapticsEnabled);
  const { isSupported } = useHaptics();

  // A switch that cannot buzz (iPhone Safari, desktop) would only mislead.
  if (!isSupported) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-card p-3">
      <div className="min-w-0 flex-1">
        <p id="haptics-title" className="text-sm font-semibold text-text-primary">Vibration</p>
        <p className="text-xs text-text-muted">{ACCOUNT_COPY.vibrationHint}</p>
      </div>
      <Switch checked={enabled} onChange={setEnabled} labelledBy="haptics-title" data-testid="haptics-switch" />
    </div>
  );
}
