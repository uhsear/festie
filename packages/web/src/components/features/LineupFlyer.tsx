import { useAuthStore, useFestivalStore, useFollowStore } from '@festie/shared/stores';
import { DISCOVER_COPY } from '@festie/shared/constants';
import type { FlyerSize, LineupFlyerModel } from '@festie/shared/utils';
import BrandWordmark from '../brand/BrandWordmark';
import FollowButton from './FollowButton';

// Clash Display at three steps on the type ramp; the headliner is the biggest line on the flyer.
const SIZE_CLASS: Record<FlyerSize, string> = {
  headliner: 'text-[length:var(--font-size-32)] font-bold',
  support: 'text-[length:var(--font-size-24)] font-semibold',
  rest: 'text-[length:var(--font-size-20)] font-medium',
};

/**
 * The lineup as a flyer, shown while no set has a start time. It has no pick controls: they return
 * with the cards once times publish. A signed-out visitor also gets the lockup and one sentence on what Festie does.
 */
export default function LineupFlyer({ model }: { model: LineupFlyerModel }) {
  const festival = useFestivalStore((s) => s.currentFestival);
  const hasProfile = useFestivalStore((s) => !!s.currentProfile);
  const user = useAuthStore((s) => s.user);
  const following = useFollowStore((s) => (festival ? s.festivalIds.includes(festival.id) : false));
  if (!festival) return null;

  const copy = DISCOVER_COPY.banner;
  const joined = following || hasProfile;
  return (
    <section
      aria-labelledby="lineup-flyer-heading"
      className="mx-auto mb-[var(--space-4)] w-full max-w-[1440px] rounded-lg border border-border bg-bg-card px-4 py-6 md:px-8"
    >
      {!user && (
        <div className="mb-6 flex flex-col items-start gap-1">
          <BrandWordmark markSize={24} className="text-[length:var(--font-size-20)]" />
          <p className="text-[length:var(--font-size-16)] text-text-secondary">{DISCOVER_COPY.flyer.guestLine}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="lineup-flyer-heading" className="text-sm font-semibold text-text-primary">
            {copy.title}
          </h2>
          <p className="text-sm text-text-secondary">{joined ? copy.joined : copy.guest}</p>
        </div>
        <FollowButton festivalId={festival.id} festivalName={festival.name} />
      </div>
      <ul className="mt-6 flex flex-col gap-3 font-display text-text-primary" aria-label="Lineup">
        {model.rows.map((row) => (
          <li key={row.key} className={SIZE_CLASS[row.size]}>
            {row.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
