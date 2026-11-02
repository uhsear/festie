import { useUIStore } from '@festie/shared/stores/uiStore';
import Switch from '../ui/Switch';

export default function HapticsSection() {
  const enabled = useUIStore((s) => s.hapticsEnabled);
  const setEnabled = useUIStore((s) => s.setHapticsEnabled);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-card p-3">
      <div className="min-w-0 flex-1">
        <p id="haptics-title" className="text-sm font-semibold text-text-primary">Vibration</p>
        <p className="text-xs text-text-muted">Buzz on taps, saves and clashes. SOS alerts always vibrate.</p>
      </div>
      <Switch checked={enabled} onChange={setEnabled} labelledBy="haptics-title" data-testid="haptics-switch" />
    </div>
  );
}
