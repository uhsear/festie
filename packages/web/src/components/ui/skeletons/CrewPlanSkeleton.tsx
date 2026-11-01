/**
 * Skeleton for /crew/plan — back link, title line with a chip on the right,
 * the "Meet up" card and one list card with 4 rows. Matches crew-plan.tsx.
 */
export default function CrewPlanSkeleton() {
  return (
    <div className="space-y-4 pb-6 max-w-2xl mx-auto px-3 w-full" aria-busy="true" aria-label="Loading crew plan" role="status" aria-live="polite">
      <span className="sr-only">Loading crew plan…</span>
      {/* back link */}
      <div className="skeleton-shimmer h-4 w-24" />

      {/* title + chip */}
      <div className="flex items-center justify-between gap-2">
        <div className="skeleton-shimmer h-7 w-[55%]" />
        <div className="skeleton-shimmer h-6 w-20 rounded-full" />
      </div>

      {/* Meet up card */}
      <div className="space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4">
        <div className="skeleton-shimmer h-4 w-24" />
        <div className="skeleton-shimmer h-3.5 w-[60%]" />
        <div className="skeleton-shimmer h-3 w-[40%]" />
      </div>

      {/* list card, 4 rows */}
      <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4">
        <div className="skeleton-shimmer h-4 w-24" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3" data-testid="crew-plan-row">
            <div className="skeleton-shimmer h-8 w-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="skeleton-shimmer h-3.5 w-[55%]" />
              <div className="skeleton-shimmer h-2.5 w-[30%]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
