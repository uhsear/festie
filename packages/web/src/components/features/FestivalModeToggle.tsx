import { m, useReducedMotion } from 'motion/react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useFestivalModeStore } from '@festie/shared';
import { COPY } from '@festie/shared/constants';
import { CONCEPT_ICON } from '@/lib/conceptIcons';
import { useHaptics } from '../../hooks/useHaptics';
import { cn } from '@/lib/utils';

// Where to send the user when they turn Festival Mode OFF. If they arrived at
// /festival-mode from another view we could remember that, but simplest
// correct behavior is to land on the main schedule — matches the legacy
// experience where turning off just unhid the original content.
const EXIT_ROUTE = '/cards';
const NowNextIcon = CONCEPT_ICON.nowNext;

export default function FestivalModeToggle() {
  const isFestivalMode = useFestivalModeStore((state) => state.isFestivalMode);
  const toggleFestivalMode = useFestivalModeStore((state) => state.toggleFestivalMode);
  const { select } = useHaptics();
  const navigate = useNavigate();
  const location = useLocation();
  // motion/react drives animations via rAF — our `@media (prefers-reduced-motion)`
  // rule in globals.css only clamps CSS `animation-duration` and has no effect
  // on this JS-driven pulse. Gate it explicitly so vestibular-sensitive users
  // actually get a still icon (infinite scale loop is exactly the kind of
  // motion WCAG 2.3.3 flags).
  const prefersReducedMotion = useReducedMotion();

  const onRoute = location.pathname === '/festival-mode';
  // Visiting the route directly (store off) still reads as "on" so the button
  // matches the screen; a tap then exits instead of re-entering.
  const active = isFestivalMode || onRoute;
  const lowPowerMode = useFestivalModeStore((state) => state.lowPowerMode);

  const handleToggle = () => {
    select();
    if (active) {
      if (isFestivalMode) toggleFestivalMode();
      if (onRoute) navigate({ to: EXIT_ROUTE });
    } else {
      toggleFestivalMode();
      navigate({ to: '/festival-mode' });
    }
  };

  return (
    <m.button
      onClick={handleToggle}
      whileTap={{ scale: 0.95 }}
      // Same name as mobile's Now & Next screen and as the visible text
      // (WCAG 2.5.3); aria-pressed carries on/off.
      aria-label={COPY.nowNext.name}
      aria-pressed={active}
      title={COPY.nowNext.name}
      data-testid="festival-mode-toggle"
      className={cn(
        'relative px-2.5 py-2 rounded-lg transition-[background-color,color,box-shadow] duration-300 min-h-11 min-w-11 flex items-center justify-center',
        active
          ? 'bg-accent-aqua text-[var(--text-on-light-accent)] shadow-lg shadow-accent-aqua/50'
          : 'bg-glass text-text-secondary hover:text-text-primary',
      )}
    >
      {isFestivalMode && !prefersReducedMotion && !lowPowerMode && (
        <m.div
          className="absolute inset-0 rounded-lg bg-accent-aqua -z-[1]"
          animate={{ scale: [1, 1.1, 1], opacity: [0.6, 0.25, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      <div className="flex items-center gap-1.5">
        <NowNextIcon className="w-5 h-5" aria-hidden="true" />
        <span className="text-sm font-semibold">{COPY.nowNext.name}</span>
      </div>
    </m.button>
  );
}
