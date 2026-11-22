export const UNFINISHED_ZONE_MESSAGE = 'Finish or cancel the zone you are drawing, then save the map.';

/** Hint shown while the zone tool is armed; from 3 points the zone can be finished. */
export function zoneDrawHint(pointCount: number): string {
  return pointCount >= 3
    ? `Finish the zone, or tap the map to add more points (${pointCount} added)`
    : `Tap the map to add zone points (${pointCount} added — need 3+)`;
}
