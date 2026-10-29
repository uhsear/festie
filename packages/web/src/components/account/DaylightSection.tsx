import DaylightToggle from '../features/DaylightToggle';

export default function DaylightSection() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-card p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary">Daylight mode</p>
        <p className="text-xs text-text-muted">High contrast for bright sun</p>
      </div>
      <DaylightToggle />
    </div>
  );
}
