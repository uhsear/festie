import { useUIStore } from '@festie/shared/stores/uiStore';
import { cn } from '@/lib/utils';

export default function HapticsSection() {
  const enabled = useUIStore((s) => s.hapticsEnabled);
  const setEnabled = useUIStore((s) => s.setHapticsEnabled);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-card p-3">
      <div className="min-w-0 flex-1">
        <p id="haptics-title" className="text-sm font-semibold text-text-primary">Vibration</p>
        <p className="text-xs text-text-muted">Buzz on taps, saves and clashes. SOS alerts always vibrate.</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby="haptics-title"
        data-testid="haptics-switch"
        onClick={() => setEnabled(!enabled)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors',
          enabled ? 'bg-accent-aqua' : 'bg-bg-card',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-4 w-4 rounded-full bg-white transition-transform',
            enabled ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
}
