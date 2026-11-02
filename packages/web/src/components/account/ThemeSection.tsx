import { useUIStore, themeModeOf } from '@festie/shared/stores/uiStore';
import { THEME_MODE_OPTIONS } from '@festie/shared/constants';
import { cn } from '@/lib/utils';

export default function ThemeSection() {
  const theme = useUIStore((s) => s.theme);
  const followSystemTheme = useUIStore((s) => s.followSystemTheme);
  const setThemeMode = useUIStore((s) => s.setThemeMode);
  const mode = themeModeOf({ theme, followSystemTheme });

  return (
    <fieldset className="rounded-lg border border-border bg-bg-card p-3 space-y-2">
      <legend className="px-1 text-sm font-semibold text-text-primary">Theme</legend>
      {THEME_MODE_OPTIONS.map((o) => (
        <label
          key={o.value}
          htmlFor={`theme-mode-${o.value}`}
          className={cn(
            'flex items-center gap-3 rounded-lg border p-3 min-h-11 cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent-aqua',
            mode === o.value ? 'border-accent-aqua' : 'border-border',
          )}
        >
          <input
            id={`theme-mode-${o.value}`}
            type="radio"
            name="theme-mode"
            value={o.value}
            checked={mode === o.value}
            onChange={() => setThemeMode(o.value)}
            className="accent-[var(--color-accent-aqua)]"
          />
          <span className="min-w-0 flex-1 text-sm font-semibold text-text-primary">
            {o.label}
            <span className="block text-xs font-normal text-text-muted">{o.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
