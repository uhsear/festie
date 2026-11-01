/**
 * Skeleton for /wrap — tab bar, title line and one centred 270 x 480 poster
 * block. Matches the Wrap page's poster layout so the route-chunk + ratings
 * fetch can land without jolt.
 */
export default function WrapSkeleton() {
  return (
    <div className="max-w-lg mx-auto space-y-4 px-4 pb-24" aria-busy="true" aria-label="Loading wrap" role="status" aria-live="polite">
      <span className="sr-only">Loading wrap…</span>
      {/* tab bar */}
      <div className="flex gap-2">
        <div className="skeleton-shimmer h-10 flex-1 rounded-lg" />
        <div className="skeleton-shimmer h-10 flex-1 rounded-lg" />
      </div>

      {/* title */}
      <div className="flex justify-center">
        <div className="skeleton-shimmer h-7 w-[200px]" />
      </div>

      {/* poster */}
      <div className="flex justify-center">
        <div className="skeleton-shimmer h-[480px] w-[270px] rounded-xl" data-testid="wrap-poster" />
      </div>
    </div>
  );
}
