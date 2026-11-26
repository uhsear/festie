import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useAlsoPicked, useFestival } from '@festie/shared/hooks';
import { DISCOVER_COPY } from '@festie/shared/constants';
import { artistDisplayName, formatTime } from '@festie/shared/utils';
import type { FestivalSet } from '@festie/shared/types';
import ArtistName, { RowOpenButton } from './ArtistName';

/** "People who picked this also picked": hidden until the API returns sets. */
export default function AlsoPickedSection({ set }: { set: FestivalSet }) {
  const festivalId = useFestivalStore((s) => s.currentFestival?.id);
  const days = useFestivalStore((s) => s.days);
  const { getStageName } = useFestival();
  const setDetailSet = useUIStore((s) => s.setDetailSet);
  const { sets, status } = useAlsoPicked(festivalId, set.id);

  if (status !== 'ready' || sets.length === 0) return null;
  return (
    <section aria-labelledby="also-picked-heading">
      <h3
        id="also-picked-heading"
        className="mb-2 text-[length:var(--font-size-12)] uppercase tracking-wide text-text-muted"
      >
        {DISCOVER_COPY.alsoPicked.heading}
      </h3>
      <ul className="space-y-1">
        {sets.map((s) => {
          const day = days[s.dayIndex ?? -1];
          const detail = [
            day ? day.label || day.date : '',
            s.startTime ? formatTime(s.startTime) : '',
            getStageName(s.stageId) ?? '',
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={s.id}>
              <div className="relative w-full min-h-[44px] rounded-lg px-3 py-2 text-left hover:bg-bg-input">
                <RowOpenButton label={detail ? `${artistDisplayName(s)}, ${detail}` : artistDisplayName(s)} onClick={() => setDetailSet(s)} />
                <span className="block truncate text-sm font-semibold text-text-primary">
                  <ArtistName set={s} />
                </span>
                {detail && <span className="block truncate text-xs text-text-muted">{detail}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
