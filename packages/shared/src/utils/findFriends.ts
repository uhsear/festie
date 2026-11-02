/**
 * findFriends.ts — what the compass can point at, and which stage a crewmate is near.
 * Pure: shared by the mobile compass and both maps so they list and label the same way.
 */

import { LIVE_LOCATION } from '../constants/config';
import type { CrewMeetingPoint, PeerLocation } from '../types/domain';
import { nearestPin, type Coord } from './geo';
import { isPeerStale } from './liveLocation';

/** A crewmate within this many metres of a stage pin is "near" it. */
export const NEAR_STAGE_MAX_M = 150;

export interface CompassTarget {
  key: string; // 'mp:<id>' | 'peer:<userId>'
  kind: 'meeting-point' | 'peer';
  id: string; // meeting point id or user id
  label: string;
  latitude: number;
  longitude: number;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Active meeting points with coords first (timed ones by soonest `meet_at`, then
 * untimed ones in list order), then live crewmates by name.
 */
export function compassTargets(input: {
  meetingPoints: ReadonlyArray<CrewMeetingPoint>;
  peers: Readonly<Record<string, PeerLocation>>;
  selfUserId?: string | null;
  nowMs: number;
}): CompassTarget[] {
  const usable = input.meetingPoints.filter((p) => p.active && finite(p.latitude) && finite(p.longitude));
  const timed = usable
    .map((p) => ({ p, ms: p.meet_at ? Date.parse(p.meet_at) : NaN }))
    .filter(({ ms }) => Number.isFinite(ms))
    .sort((a, b) => a.ms - b.ms)
    .map(({ p }) => p);
  const untimed = usable.filter((p) => !timed.includes(p));
  const points: CompassTarget[] = [...timed, ...untimed].map((p) => ({
    key: `mp:${p.id}`,
    kind: 'meeting-point',
    id: p.id,
    label: p.label,
    latitude: p.latitude as number,
    longitude: p.longitude as number,
  }));

  // STALE_MS, not the 30 s default: a friend standing still may not publish for a while.
  const people: CompassTarget[] = Object.values(input.peers)
    .filter(
      (p) =>
        p.userId !== input.selfUserId &&
        finite(p.lat) &&
        finite(p.lng) &&
        !isPeerStale(p.serverAt, input.nowMs, LIVE_LOCATION.STALE_MS),
    )
    .map((p) => ({
      key: `peer:${p.userId}`,
      kind: 'peer' as const,
      id: p.userId,
      label: p.username || 'Crew member',
      latitude: p.lat,
      longitude: p.lng,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [...points, ...people];
}

/** The nearest stage's name when `coord` is within `maxM` of it, else null. */
export function nearStageName(
  coord: Coord | null | undefined,
  stagePins: ReadonlyArray<{ label: string; latitude: number; longitude: number }>,
  maxM: number = NEAR_STAGE_MAX_M,
): string | null {
  const near = nearestPin(coord, stagePins);
  return near && near.distanceM <= maxM ? near.pin.label : null;
}
