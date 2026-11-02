import { useCrewDaysIndex } from '@festie/shared/hooks';
import { memberDayChips } from '@festie/shared/utils';
import type { FestivalDay } from '@festie/shared/types';
import { cn } from '../../lib/utils';

/** Small per-day answer chips under a member's name. No answers: renders nothing. */
export default function MemberDayChips({
  userId,
  name,
  days,
}: {
  userId: string;
  name: string;
  days: FestivalDay[];
}) {
  const index = useCrewDaysIndex();
  const { chips, a11y } = memberDayChips(index, userId, days);
  if (chips.length === 0) return null;
  return (
    <ul aria-label={`${name}: ${a11y}`} className="mt-0.5 flex flex-wrap gap-1">
      {chips.map((c) => (
        <li
          key={c.dayIndex}
          aria-hidden="true"
          className={cn(
            'rounded-full border px-1.5 text-xs',
            c.answer === 'going' && 'border-accent-aqua bg-accent-aqua/20 text-text-primary',
            c.answer === 'maybe' && 'border-accent-aqua text-text-primary',
            c.answer === 'no' && 'border-border-light text-text-muted line-through',
          )}
        >
          {c.label}
        </li>
      ))}
    </ul>
  );
}
