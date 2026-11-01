import { FestivalSet, FestivalDay, Priority, Stage } from '../types/domain';
import { getSetTimeBounds } from './setStatus';
import { PRIORITY_RANK, buildOverlapBreakdown } from './crewNudges';
import { stageWalkMinutes } from './geo';

// ── Set-time CLASH detection among the current user's OWN picks ───────────────
// Pure (RN + web safe) — no React/store/DOM deps. Given the user's picks on a
// day, find the groups of picks whose set times overlap, so the schedule UI can
// flag "you can't be in two places at once" and suggest which one to keep.
//
// Reuses the shared single sources of truth: getSetTimeBounds (TZ-safe, post-
// midnight-aware start/end ms) for the intervals, and PRIORITY_RANK +
// buildOverlapBreakdown from crewNudges so the keep-recommendation ordering and
// the "N must, M want" crew phrasing match the rest of the app.

/** One of my picks that participates in a clash, with resolved interval. */
export interface ConflictPick {
  set: FestivalSet;
  priority: Priority;
  startMs: number;
  endMs: number;
  durationMin: number;
  /** Distinct crew humans (≠ me) who also picked this set — only when crew context supplied. */
  crewCount?: number;
  /** "2 must, 1 want" over those crew humans' priorities — only when crew context supplied. */
  crewBreakdown?: string;
}

/**
 * A tight change counts only when the walk is at least this many minutes longer
 * than the gap, so neighbouring stages do not spam warnings.
 */
export const TIGHT_CHANGE_MIN_SHORTFALL = 5;

/** Two picks that clash: a strict overlap, or a tight change between stages. */
export interface ConflictPair {
  /** Starts first (tie: lower id). */
  setA: FestivalSet;
  setB: FestivalSet;
  /** 0 when they do not overlap. */
  overlapMinutes: number;
  /** 0 when they overlap. */
  gapMinutes: number;
  /** null when stages are not given or a pin is missing. */
  walkMinutes: number | null;
  /** No overlap, and walk - gap >= TIGHT_CHANGE_MIN_SHORTFALL. */
  tight: boolean;
}

/** A cluster of mutually-(transitively-)clashing picks. */
export interface ConflictGroup {
  /** Picks in the clash, sorted by startMs asc (tiebreak id asc). length >= 2. */
  picks: ConflictPick[];
  /** Id of the pick we recommend keeping (strongest priority, longest, earliest). */
  recommendedKeepId: string;
  /** The MAX pairwise overlap minutes within the group (rounded). */
  overlapMin: number;
  /** Every clashing pair in the group, in pick order. */
  pairs: ConflictPair[];
  /** True when every pair is a tight change. */
  tight: boolean;
}

interface ProfilePicks {
  userId: string;
  name?: string;
  picks: Record<string, Priority>;
}

export interface BuildPickConflictsInput {
  sets: FestivalSet[];
  myPicks: Record<string, Priority>;
  selectedDay: number;
  /** Festival days — required to resolve set dates; without them nothing resolves. */
  days?: FestivalDay[];
  /** Optional festival IANA zone, threaded to getSetTimeBounds. */
  timeZone?: string;
  /** All known profiles' picks — needed (with the two below) for crew context. */
  allProfiles?: ProfilePicks[];
  /** Crew member userIds — needed (with allProfiles + myUserId) for crew context. */
  crewMemberUserIds?: Set<string>;
  /** The current user's id — excluded from crew counts. */
  myUserId?: string;
  /** Stage pins. When given, walking time counts: a tight change between stages is a clash too. */
  stages?: ReadonlyArray<Pick<Stage, 'id' | 'latitude' | 'longitude'>>;
}

interface InternalPick extends ConflictPick {
  /** Stable index used only to seed the union-find of overlapping intervals. */
  idx: number;
}

/**
 * Detect time clashes among the current user's OWN picks on `selectedDay`.
 *
 * Considers only sets where `myPicks[set.id]` is set, the set is on
 * `selectedDay` ((set.dayIndex ?? 0) === selectedDay) and getSetTimeBounds
 * resolves. **`days` is required** — without it no set's date resolves, so the
 * function returns `[]`.
 *
 * Two picks clash when their `[startMs, endMs)` intervals strictly overlap
 * (`aStart < bEnd && bStart < aEnd`), or, when `stages` is given, when they
 * form a tight change: no overlap, but the walk between the stages is at least
 * `TIGHT_CHANGE_MIN_SHORTFALL` minutes longer than the gap. Back-to-back sets
 * on the same stage (or without `stages`) are NOT a clash. Transitively-clashing
 * picks are clustered into groups; only groups with >= 2 picks are returned.
 * Each group lists its clashing `pairs`.
 *
 * Crew context (each ConflictPick's `crewCount` / `crewBreakdown`) is only
 * populated when `allProfiles`, `crewMemberUserIds` AND `myUserId` are all
 * provided — it tells the user which side their crew is on. Otherwise those
 * fields are left `undefined`.
 */
export function buildPickConflicts(input: BuildPickConflictsInput): ConflictGroup[] {
  const { sets, myPicks, selectedDay, days, timeZone, allProfiles, crewMemberUserIds, myUserId, stages } = input;

  // Without festival days no set's date resolves → nothing to compare.
  if (!days) return [];

  const wantCrew = !!allProfiles && !!crewMemberUserIds && myUserId != null;

  // 1. Resolve my eligible picks on this day to absolute intervals.
  const picks: InternalPick[] = [];
  for (const set of sets) {
    const priority = myPicks[set.id];
    if (!priority) continue;
    if ((set.dayIndex ?? 0) !== selectedDay) continue;
    const bounds = getSetTimeBounds(set, days, timeZone);
    if (!bounds) continue;

    const durationMin = Math.round((bounds.endMs - bounds.startMs) / 60000);
    const pick: InternalPick = {
      idx: picks.length,
      set,
      priority,
      startMs: bounds.startMs,
      endMs: bounds.endMs,
      durationMin,
    };

    if (wantCrew) {
      // Distinct crew humans (≠ me) who picked this set, at their highest priority.
      const byUser = new Map<string, Priority>();
      for (const profile of allProfiles!) {
        if (profile.userId === myUserId) continue;
        if (!crewMemberUserIds!.has(profile.userId)) continue;
        const p = profile.picks?.[set.id];
        if (!p) continue;
        const existing = byUser.get(profile.userId);
        if (!existing || PRIORITY_RANK[p] < PRIORITY_RANK[existing]) byUser.set(profile.userId, p);
      }
      pick.crewCount = byUser.size;
      pick.crewBreakdown = buildOverlapBreakdown(Array.from(byUser.values()).map((p) => ({ priority: p })));
    }

    picks.push(pick);
  }

  if (picks.length < 2) return [];

  // 2. Union-find over strictly-overlapping intervals (transitive clustering).
  const parent = picks.map((_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[x] !== root) {
      const next = parent[x]!;
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // Clashing pairs keyed by "<earlier id> <later id>", read back in group order below.
  const pairByKey = new Map<string, ConflictPair>();
  for (let i = 0; i < picks.length; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      const pair = clashPair(picks[i]!, picks[j]!, stages);
      if (!pair) continue;
      union(i, j);
      pairByKey.set(pairKey(pair.setA.id, pair.setB.id), pair);
    }
  }

  // 3. Bucket picks by cluster root.
  const clusters = new Map<number, InternalPick[]>();
  for (let i = 0; i < picks.length; i++) {
    const root = find(i);
    const bucket = clusters.get(root) ?? [];
    bucket.push(picks[i]!);
    clusters.set(root, bucket);
  }

  const groups: ConflictGroup[] = [];
  for (const bucket of clusters.values()) {
    if (bucket.length < 2) continue;

    // Sort picks within the group by startMs asc, tiebreak id asc.
    bucket.sort((a, b) => {
      if (a.startMs !== b.startMs) return a.startMs - b.startMs;
      return a.set.id < b.set.id ? -1 : a.set.id > b.set.id ? 1 : 0;
    });

    // recommendedKeepId: strongest priority (rank asc), then longer duration,
    // then earlier start, then id asc.
    const keep = bucket.reduce((best, cur) => {
      const r = PRIORITY_RANK[cur.priority] - PRIORITY_RANK[best.priority];
      if (r !== 0) return r < 0 ? cur : best;
      if (cur.durationMin !== best.durationMin) return cur.durationMin > best.durationMin ? cur : best;
      if (cur.startMs !== best.startMs) return cur.startMs < best.startMs ? cur : best;
      return cur.set.id < best.set.id ? cur : best;
    });

    // overlapMin: MAX pairwise overlap minutes within the group.
    let maxOverlapMs = 0;
    const pairs: ConflictPair[] = [];
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        const overlap = Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
        if (overlap > maxOverlapMs) maxOverlapMs = overlap;
        const pair = pairByKey.get(pairKey(a.set.id, b.set.id));
        if (pair) pairs.push(pair);
      }
    }

    groups.push({
      picks: bucket.map(({ idx: _idx, ...p }) => p),
      recommendedKeepId: keep.set.id,
      overlapMin: Math.round(maxOverlapMs / 60000),
      pairs,
      tight: pairs.every((p) => p.tight),
    });
  }

  // Sort groups by their earliest pick's startMs (picks already start-sorted).
  groups.sort((a, b) => a.picks[0]!.startMs - b.picks[0]!.startMs);

  return groups;
}

const pairKey = (earlierId: string, laterId: string): string => `${earlierId}\u0000${laterId}`;

/** The clash between two picks, or null when they do not clash. */
function clashPair(x: ConflictPick, y: ConflictPick, stages: BuildPickConflictsInput['stages']): ConflictPair | null {
  const xFirst = x.startMs !== y.startMs ? x.startMs < y.startMs : x.set.id < y.set.id;
  const [a, b] = xFirst ? [x, y] : [y, x];
  const walkMinutes = stages ? stageWalkMinutes(stages, a.set.stageId, b.set.stageId) : null;
  // Strict overlap; touching endpoints (a.endMs === b.startMs) is NOT an overlap.
  if (a.startMs < b.endMs && b.startMs < a.endMs) {
    const overlapMs = Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
    return {
      setA: a.set,
      setB: b.set,
      overlapMinutes: Math.round(overlapMs / 60000),
      gapMinutes: 0,
      walkMinutes,
      tight: false,
    };
  }
  const gapMinutes = Math.round((b.startMs - a.endMs) / 60000);
  if (walkMinutes == null || walkMinutes - gapMinutes < TIGHT_CHANGE_MIN_SHORTFALL) return null;
  return { setA: a.set, setB: b.set, overlapMinutes: 0, gapMinutes, walkMinutes, tight: true };
}
