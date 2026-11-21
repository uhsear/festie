import { Fragment, useMemo } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useInterestedRows } from '@festie/shared/hooks/useInterest';
import { lineupDays, lineupEntryBadge, markedWithoutSet } from '@festie/shared/utils';
import { lineupEntrySegments } from '@festie/shared/utils/artistSheet';
import { useNow } from '../../hooks/useSetStatus';
import { ArtistNameButton } from './ArtistName';

/**
 * The Picks tab group "Marked, no set yet": acts the user marked that no set covers. Each row has the
 * same badge as the lineup. A mark turns into a pick row once sets exist, so the group hides when empty.
 */
export default function MarkedNoSet({ className }: { className?: string }) {
  const rows = markedWithoutSet(useInterestedRows());
  const festival = useFestivalStore((s) => s.currentFestival);
  const days = useFestivalStore((s) => s.days);
  const sets = useFestivalStore((s) => s.sets);
  const nowMs = useNow();
  const lineup = useMemo(() => lineupDays(days, sets), [days, sets]);
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="marked-no-set-heading" className={className}>
      <h2 id="marked-no-set-heading" className="mt-2 mb-2 text-sm font-bold text-text-primary">
        Marked, no set yet
      </h2>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.entry.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1">
            <span className="inline-flex flex-wrap items-baseline gap-x-1 min-h-11 text-base font-medium text-text-primary">
              {lineupEntrySegments(row.entry, festival?.b2bSeparator, true).map((seg, i) => (
                <Fragment key={`${seg.label}-${i}`}>
                  {i > 0 && <span>{festival?.b2bSeparator || 'b2b'}</span>}
                  <ArtistNameButton target={seg.target}>{seg.label}</ArtistNameButton>
                </Fragment>
              ))}
            </span>
            {lineupEntryBadge(row.entry, row.cover, lineup, festival?.publishedAt, nowMs).map((badge) => (
              <span key={badge.kind} className="rounded-full border border-border px-2 py-0.5 text-xs text-text-secondary">
                {badge.text}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
