import { Sun } from 'lucide-react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import IconButton from '../ui/IconButton';
import { cn } from '@/lib/utils';

/** One-tap Daylight (high-contrast light) theme toggle. */
export default function DaylightToggle({ className }: { className?: string }) {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const on = theme === 'daylight';

  return (
    <IconButton
      label="Daylight mode"
      aria-pressed={on}
      data-testid="daylight-toggle"
      className={cn(className, on && 'bg-[var(--color-aqua-a12)] border border-[var(--color-aqua-a3)]')}
      icon={<Sun className={cn('w-5 h-5', on && 'text-accent-aqua')} aria-hidden="true" />}
      onClick={() => setTheme(on ? 'stage' : 'daylight')}
    />
  );
}
