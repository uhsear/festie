import type { Priority } from '../types';
import { PRIORITY_WEIGHT } from './crewNudges';

/** Avatars drawn on one grid tile; the rest collapse into "+N". */
export const GRID_CREW_AVATAR_MAX = 3;

export interface GridCrewProfile {
  id: string;
  userId?: string;
  name?: string;
  avatarUrl?: string | null;
}

export interface GridCrewAvatar {
  key: string;
  name: string;
  avatarUrl?: string | null;
  priority: Priority;
}

export interface GridCrewAvatars {
  /** Distinct crew members who picked the set. */
  total: number;
  /** At most GRID_CREW_AVATAR_MAX members, strongest pick first. Empty in the no-crew count fallback. */
  shown: GridCrewAvatar[];
  overflow: number;
  /** Screen-reader phrase for the tile, e.g. "3 crew members picked this". */
  label: string;
}

type CrewPick = { profileId: string; priority: Priority };

/**
 * Shape one set's crew-scoped picks for a grid tile. Feed it the output of
 * getCrewScopedOtherPicks so it can never include people outside the crew.
 * One entry per human (a user id, else the profile id), keeping their strongest
 * pick; ordered must > want > maybe, then by name.
 */
export function buildGridCrewAvatars(
  picks: readonly CrewPick[],
  profilesById: ReadonlyMap<string, GridCrewProfile>,
  max: number = GRID_CREW_AVATAR_MAX,
): GridCrewAvatars | null {
  const byHuman = new Map<string, GridCrewAvatar>();
  for (const pick of picks) {
    const profile = profilesById.get(pick.profileId);
    const key = profile?.userId || pick.profileId;
    const seen = byHuman.get(key);
    if (seen && PRIORITY_WEIGHT[seen.priority] >= PRIORITY_WEIGHT[pick.priority]) continue;
    byHuman.set(key, {
      key,
      name: profile?.name?.trim() || 'Crew member',
      avatarUrl: profile?.avatarUrl,
      priority: pick.priority,
    });
  }
  const total = byHuman.size;
  if (total === 0) return null;
  const ordered = [...byHuman.values()].sort(
    (a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
  );
  return {
    total,
    shown: ordered.slice(0, max),
    overflow: Math.max(0, total - max),
    label: `${total} crew ${total === 1 ? 'member' : 'members'} picked this`,
  };
}

export interface GridCrewSource {
  hasActiveCrew: boolean;
  /** getCrewScopedOtherPicks */
  getCrewPicks: (setId: string) => readonly CrewPick[];
  /** getOtherPicks, the set sheet's fallback when there is no crew */
  getOtherPicks: (setId: string) => readonly CrewPick[];
}

/**
 * Per-set map for a whole grid; sets with no overlap are left out. With an active
 * crew the entries carry avatars (crew-scoped only). Without one the grid keeps its
 * plain count from getOtherPicks (no avatars: `shown` is empty), like the set sheet.
 */
export function buildGridCrewAvatarsBySet(
  setIds: readonly string[],
  source: GridCrewSource,
  profiles: readonly GridCrewProfile[],
): Map<string, GridCrewAvatars> {
  const profilesById = new Map(profiles.map((p) => [p.id, p]));
  const bySet = new Map<string, GridCrewAvatars>();
  for (const id of setIds) {
    if (source.hasActiveCrew) {
      const crew = buildGridCrewAvatars(source.getCrewPicks(id), profilesById);
      if (crew) bySet.set(id, crew);
      continue;
    }
    const total = source.getOtherPicks(id).length;
    if (total > 0) {
      bySet.set(id, { total, shown: [], overflow: 0, label: `${total} ${total === 1 ? 'other person' : 'others'} picked this` });
    }
  }
  return bySet;
}
