import { useFestivalStore, useFollowStore } from '@festie/shared/stores';
import { DISCOVER_COPY } from '@festie/shared/constants';
import FollowButton from './FollowButton';

/** Shown on a lineup whose sets have no start times yet. */
export default function SetTimesBanner() {
  const festival = useFestivalStore((s) => s.currentFestival);
  const sets = useFestivalStore((s) => s.sets);
  const hasProfile = useFestivalStore((s) => !!s.currentProfile);
  const following = useFollowStore((s) => (festival ? s.festivalIds.includes(festival.id) : false));

  if (!festival || sets.length === 0 || sets.some((s) => !!s.startTime)) return null;
  const copy = DISCOVER_COPY.banner;
  const joined = following || hasProfile;
  return (
    <section
      aria-labelledby="set-times-banner-heading"
      className="mx-auto mb-[var(--space-3)] flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-card px-4 py-3"
    >
      <div className="min-w-0">
        <h2 id="set-times-banner-heading" className="text-sm font-semibold text-text-primary">
          {copy.title}
        </h2>
        <p className="text-sm text-text-secondary">{joined ? copy.joined : copy.guest}</p>
      </div>
      {!joined && <FollowButton festivalId={festival.id} festivalName={festival.name} />}
    </section>
  );
}
