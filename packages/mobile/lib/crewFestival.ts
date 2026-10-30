/**
 * The festival a crew screen may frame its times with. A crew belongs to one
 * festival, but `currentFestival` follows the schedule tab, so the two can
 * differ. Returning null for a mismatch makes callers fall back to the device
 * zone instead of rendering festival A's meeting times with festival B's zone
 * and days.
 */
export function festivalForCrew<F extends { id: string }>(
  crew: { festivalId?: string | null } | null | undefined,
  currentFestival: F | null | undefined,
): F | null {
  if (!currentFestival) return null;
  return !crew?.festivalId || crew.festivalId === currentFestival.id ? currentFestival : null;
}
