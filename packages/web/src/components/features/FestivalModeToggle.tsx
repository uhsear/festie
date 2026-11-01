import { Flame } from 'lucide-react';
import { Link, useLocation } from '@tanstack/react-router';
import { useHaptics } from '../../hooks/useHaptics';
import { cn } from '@/lib/utils';

export default function FestivalModeToggle() {
  const { select } = useHaptics();
  const location = useLocation();
  const active = location.pathname === '/festival-mode';

  return (
    <Link
      to="/festival-mode"
      onClick={select}
      // Same name as mobile's Now & Next screen; it contains the visible
      // "Now" (WCAG 2.5.3).
      aria-label="Now & Next"
      aria-current={active ? 'page' : undefined}
      title="Now & Next"
      data-testid="festival-mode-toggle"
      className={cn(
        'relative px-2.5 py-2 rounded-lg transition-[background-color,color,box-shadow] duration-300 min-h-11 min-w-11 flex items-center justify-center active:scale-95 motion-reduce:active:transform-none',
        active
          ? 'bg-accent-aqua text-[var(--text-on-light-accent)] shadow-lg shadow-accent-aqua/50'
          : 'bg-glass text-text-secondary hover:text-text-primary',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Flame className="w-5 h-5" aria-hidden="true" />
        <span className="text-sm font-semibold">Now</span>
      </div>
    </Link>
  );
}
