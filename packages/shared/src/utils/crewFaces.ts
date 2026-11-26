import type { PeerLocation, Stage } from '../types/domain';
import { etaMinutes, haversineMeters, type Coord } from './geo';
import type { CrewWhereabout } from './dayOf';
import { RECENT_FIX_MS } from './mapPlace';

/** A member counts as "at" a stage when their fix is this close (metres). */
export const FACE_STAGE_RADIUS_M = 200;

export interface CrewFace {
  userId: string;
  name: string;
  /** The stage the member's last fix is at, or null (no fix, or between stages). */
  stageId: string | null;
  /** `4 min walk`, `Seen 12 min ago`, a status line, or `No signal yet`. */
  caption: string;
  sos: boolean;
}

export interface SelectCrewFacesInput {
  whereabouts: ReadonlyArray<CrewWhereabout>;
  peers: Readonly<Record<string, Pick<PeerLocation, 'lat' | 'lng'>>>;
  stages: ReadonlyArray<Pick<Stage, 'id' | 'latitude' | 'longitude'>>;
  /** The viewer's own last fix, used for walk time to a live member. */
  viewer: { coord: Coord | null; at: number | null };
  nowMs: number;
}

function nearestStageId(at: Coord, stages: SelectCrewFacesInput['stages']): string | null {
  let best: string | null = null;
  let bestM = FACE_STAGE_RADIUS_M;
  for (const s of stages) {
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
    const m = haversineMeters(at, { latitude: s.latitude as number, longitude: s.longitude as number });
    if (m <= bestM) {
      best = s.id;
      bestM = m;
    }
  }
  return best;
}

const minutesAgo = (thenMs: number, nowMs: number) => Math.max(1, Math.floor((nowMs - thenMs) / 60_000));

function captionFor(row: CrewWhereabout, walk: number | null, nowMs: number): string {
  if (row.sos) return 'SOS';
  if (row.live === 'live') return walk !== null ? `${walk} min walk` : 'Live now';
  if (row.live === 'stale' && row.liveAt) return `Seen ${minutesAgo(row.liveAt, nowMs)} min ago`;
  if (row.lostAt) return `Seen ${minutesAgo(row.lostAt, nowMs)} min ago`;
  return row.statusLabel ?? 'No signal yet';
}

/** One face per crewmate, in the order `whereabouts` already ranks them (SOS, live, stale, status). */
export function selectCrewFaces({ whereabouts, peers, stages, viewer, nowMs }: SelectCrewFacesInput): CrewFace[] {
  const viewerRecent = viewer.coord !== null && viewer.at !== null && nowMs - viewer.at <= RECENT_FIX_MS;
  return whereabouts.map((row) => {
    const peer = peers[row.userId];
    const coord = peer ? { latitude: peer.lat, longitude: peer.lng } : null;
    const walk = row.live === 'live' && coord && viewerRecent ? etaMinutes(viewer.coord, coord) : null;
    return {
      userId: row.userId,
      name: row.name,
      stageId: coord ? nearestStageId(coord, stages) : null,
      caption: captionFor(row, walk, nowMs),
      sos: row.sos,
    };
  });
}
