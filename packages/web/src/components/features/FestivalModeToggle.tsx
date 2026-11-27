import { Link, useLocation } from '@tanstack/react-router';
import { COPY } from '@festie/shared/constants';
import { useFestivalStore } from '@festie/shared/stores';
import { festivalStatus } from '@festie/shared/utils';
import { CONCEPT_ICON } from '@/lib/conceptIcons';
import { useHaptics } from '../../hooks/useHaptics';
import { cn } from '@/lib/utils';

const NowNextIcon = CONCEPT_ICON.nowNext;

export default function FestivalModeToggle() {
  const { select } = useHaptics();
  const location = useLocation();
  const active = location.pathname === '/festival-mode';
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const days = useFestivalStore((s) => s.days);
  // The glow says "it is happening"; a festival that has not started or has ended keeps the plain active fill.
  const glow = active && festivalStatus(currentFestival, days) === 'ongoing';

  return (
    <Link
      to="/festival-mode"
      onClick={select}
      // Same name as mobile's Now & Next screen; it equals the visible text
      // when shown (WCAG 2.5.3).
      aria-label={COPY.nowNext.name}
      aria-current={active ? 'page' : undefined}
      title={COPY.nowNext.name}
      data-testid="festival-mode-toggle"
      className={cn(
        'relative px-2.5 py-2 rounded-xl transition-[background-color,color,box-shadow,scale] duration-(--duration-slow) min-h-11 min-w-11 flex items-center justify-center press-scale',
        active
          ? cn('bg-accent-aqua text-[var(--text-on-light-accent)]', glow && 'shadow-lg shadow-accent-aqua/50')
          : 'bg-glass text-text-secondary hover:text-text-primary',
      )}
    >
      <div className="flex items-center gap-1.5">
        <NowNextIcon className="w-5 h-5" aria-hidden="true" />
        {/* Icon only below 360px so the header keeps the whole logo; aria-label keeps the name. */}
        <span className="text-sm font-semibold max-[359px]:hidden">{COPY.nowNext.name}</span>
      </div>
    </Link>
  );
}
