/**
 * Skeleton for /crew — crew selector + home-base card + 7 tab chips (one per
 * CrewTabBar tab) + the Meet panel (status card + live-location card). Matches
 * what CrewView shows first so the page doesn't jolt when the chunk + crew
 * fetch resolve.
 */
const TAB_COUNT = 7;

export default function CrewSkeleton() {
  return (
    <div className="crew-page space-y-4 pb-24" aria-busy="true" aria-label="Loading crew" role="status" aria-live="polite">
      <span className="sr-only">Loading crew…</span>
      {/* crew selector */}
      <div className="px-4">
        <div className="skeleton-shimmer h-10 w-full rounded-lg" />
      </div>

      <div className="space-y-4 px-4">
        {/* home-base card */}
        <div className="skeleton-shimmer h-24 w-full rounded-xl opacity-70" />

        {/* tab row */}
        <div className="flex gap-1.5 overflow-hidden">
          {Array.from({ length: TAB_COUNT }).map((_, i) => (
            <div key={i} className="skeleton-shimmer h-11 w-20 flex-shrink-0 rounded-md" data-testid="crew-tab-chip" />
          ))}
        </div>

        {/* Meet panel: status card + live-location card */}
        <div className="skeleton-shimmer h-32 w-full rounded-xl opacity-70" />
        <div className="skeleton-shimmer h-40 w-full rounded-xl opacity-70" />
      </div>
    </div>
  );
}
