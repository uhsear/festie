import { SkipForward } from 'lucide-react';
import type { FestivalSet } from '@festie/shared/types';
import { artistDisplayName, fmtStartsIn, fmtZonedClock, type DayOfSet } from '@festie/shared/utils';
import ArtistName, { RowOpenButton } from '../features/ArtistName';

interface Props {
  items: DayOfSet[];
  nowMs: number;
  timeZone?: string;
  b2bSeparator?: string;
  getStageName: (stageId: string) => string | undefined;
  onOpenSet: (set: FestivalSet) => void;
}

/** Compact rows for the sets after the one in the hero. */
export default function UpNextList({ items, nowMs, timeZone, b2bSeparator, getStageName, onOpenSet }: Props) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="fm-next-title" className="flex flex-col gap-2">
      <h2 id="fm-next-title" className="type-label font-semibold text-text-primary flex items-center gap-1">
        <SkipForward className="w-3.5 h-3.5" aria-hidden="true" />
        Up next
      </h2>
      <ul className="list-none m-0 p-0 rounded-lg border border-border bg-bg-card divide-y divide-border">
        {items.map(({ set, start }) => {
          const name = artistDisplayName(set, b2bSeparator);
          const stage = getStageName(set.stageId) || '';
          const startsIn = fmtStartsIn(start, nowMs, timeZone);
          return (
            <li key={set.id}>
              <div
                data-testid="fm-next-card"
                className="relative flex items-center gap-3 w-full text-left px-4 py-3 min-h-[56px] hover:bg-bg-card-hover transition-colors motion-reduce:transition-none"
              >
                <RowOpenButton
                  onClick={() => onOpenSet(set)}
                  label={`${name}${stage ? ` at ${stage}` : ''}, ${startsIn}. Open details`}
                />
                <span className="type-numeral text-text-primary w-18 shrink-0">{fmtZonedClock(start, timeZone)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block type-label text-text-primary font-semibold break-words">
                    <ArtistName set={set} separator={b2bSeparator} />
                  </span>
                  {stage && <span className="block type-caption text-text-secondary truncate">{stage}</span>}
                </span>
                <span className="type-caption text-accent-aqua tabular-nums shrink-0">{startsIn}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
