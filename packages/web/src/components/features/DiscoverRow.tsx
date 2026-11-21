import { useMemo } from 'react';
import { useAuthStore, useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestival } from '@festie/shared/hooks';
import { DISCOVER_COPY } from '@festie/shared/constants';
import {
  artistDisplayName,
  discoverSets,
  festivalPhase,
  formatTime,
  isStageFilterActive,
  resolveFestivalTimeZone,
  topPickedGenres,
} from '@festie/shared/utils';
import { useNow } from '../../hooks/useSetStatus';
import ArtistName, { RowOpenButton } from './ArtistName';

/** "More like your picks": unpicked sets in the genres the user picks most. */
export default function DiscoverRow() {
  const user = useAuthStore((s) => s.user);
  const festival = useFestivalStore((s) => s.currentFestival);
  const profile = useFestivalStore((s) => s.currentProfile);
  const sets = useFestivalStore((s) => s.sets);
  const days = useFestivalStore((s) => s.days);
  const stages = useFestivalStore((s) => s.stages);
  const { getStageName } = useFestival();
  const searchQuery = useFestivalStore((s) => s.searchQuery);
  const activeStages = useFestivalStore((s) => s.activeStages);
  const activeGenres = useFestivalStore((s) => s.activeGenres);
  const setDetailSet = useUIStore((s) => s.setDetailSet);
  const nowMs = useNow();

  const picks = profile?.picks;
  const genres = useMemo(() => topPickedGenres(sets, picks), [sets, picks]);
  const found = useMemo(
    () =>
      genres.length === 0
        ? []
        : discoverSets({ sets, picks, genres, days, timeZone: resolveFestivalTimeZone(festival) ?? null, nowMs }),
    [genres, sets, picks, days, festival, nowMs],
  );

  const filtered =
    searchQuery.trim() !== '' || isStageFilterActive(activeStages, stages.length) || activeGenres.length > 0;
  if (!user || !profile || filtered || festivalPhase(festival, days) === 'post' || found.length === 0) return null;

  return (
    <section aria-labelledby="discover-row-heading" className="mx-auto mb-[var(--space-3)] w-full max-w-[1440px]">
      <h2 id="discover-row-heading" className="text-sm font-semibold text-text-primary">
        {DISCOVER_COPY.row.heading}
      </h2>
      <p className="mb-2 text-xs text-text-muted">{DISCOVER_COPY.row.sub(genres)}</p>
      <ul className="flex snap-x gap-3 overflow-x-auto pb-2">
        {found.map((s) => {
          const day = days[s.dayIndex ?? -1];
          const when = [day ? day.label || day.date : '', s.startTime ? formatTime(s.startTime) : '']
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={s.id} className="snap-start shrink-0">
              <div className="relative block w-[200px] min-h-[44px] rounded-xl border border-border bg-bg-card px-3 py-2 text-left hover:bg-bg-input">
                <RowOpenButton label={`${artistDisplayName(s)}${when ? `, ${when}` : ''}`} onClick={() => setDetailSet(s)} />
                <span className="block truncate text-sm font-semibold text-text-primary">
                  <ArtistName set={s} />
                </span>
                {when && <span className="block truncate text-xs text-text-secondary">{when}</span>}
                <span className="block truncate text-xs text-text-muted">
                  {getStageName(s.stageId) ?? ''}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
