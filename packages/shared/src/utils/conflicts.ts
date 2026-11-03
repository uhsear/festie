import { FestivalSet, Priority } from '../types/domain';
import { festivalStartMinutes, setMinuteRange } from './setStatus';
import { artistDisplayName } from './format';
import { fmtDurationMinutes } from './scheduleFormat';

export interface ConflictDetected {
  setA: FestivalSet;
  setB: FestivalSet;
  overlapMinutes: number;
  /** The user's pick priority for each side (for hard/soft clash classification). */
  priorityA: Priority;
  priorityB: Priority;
  /**
   * A "hard" clash: BOTH sides are `must`. These are the unavoidable
   * decisions worth an explicit "you have a conflict" prompt (Clashfinder
   * pattern) vs. a softer want/maybe overlap the user may happily double-book.
   */
  hard: boolean;
}

export type GetMyPickFn = (setId: string) => Priority | undefined | null;

/** True when both sides of a detected clash are `must` picks. */
export function isHardConflict(c: ConflictDetected): boolean {
  return c.priorityA === 'must' && c.priorityB === 'must';
}

export function detectConflicts(sets: FestivalSet[], getMyPick: GetMyPickFn): ConflictDetected[] {
  const picked = sets.filter((s) => getMyPick(s.id) && s.startTime && s.endTime);
  const conflicts: ConflictDetected[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) {
      const a = picked[i]!;
      const b = picked[j]!;

      // Same clock time on different festival days is NOT a conflict. Guard on
      // dayIndex when both are known; treat null as unknown (time-only fallback)
      // so single-day festivals and callers that don't stamp dayIndex still work.
      if (a.dayIndex != null && b.dayIndex != null && a.dayIndex !== b.dayIndex) continue;

      // Minutes from the logical day's midnight, so a 00:30 set sits after 23:30.
      const ra = setMinuteRange(a);
      const rb = setMinuteRange(b);
      if (!ra || !rb) continue;
      const { start: aS, end: aE } = ra;
      const { start: bS, end: bE } = rb;

      if (aS < bE && bS < aE) {
        const key = [a.id, b.id].sort().join('-');
        if (!seen.has(key)) {
          seen.add(key);
          const overlapStart = Math.max(aS, bS);
          const overlapEnd = Math.min(aE, bE);
          // Both sides are picked (filtered above), so getMyPick is non-null;
          // default to 'maybe' purely as a type-safe fallback.
          const priorityA = (getMyPick(a.id) as Priority) || 'maybe';
          const priorityB = (getMyPick(b.id) as Priority) || 'maybe';
          conflicts.push({
            setA: a,
            setB: b,
            overlapMinutes: overlapEnd - overlapStart,
            priorityA,
            priorityB,
            hard: priorityA === 'must' && priorityB === 'must',
          });
        }
      }
    }
  }

  return conflicts;
}

export function getConflictingSetIds(sets: FestivalSet[], getMyPick: GetMyPickFn): Set<string> {
  const conflicts = detectConflicts(sets, getMyPick);
  const ids = new Set<string>();
  conflicts.forEach(({ setA, setB }) => {
    ids.add(setA.id);
    ids.add(setB.id);
  });
  return ids;
}

export function hasConflict(setId: string, sets: FestivalSet[], getMyPick: GetMyPickFn): boolean {
  const conflictIds = getConflictingSetIds(sets, getMyPick);
  return conflictIds.has(setId);
}

/** The clash badge for one set: the other set it clashes with most, and the label to show. */
export interface ClashBadge {
  otherSetId: string;
  otherName: string;
  /** 0 for a tight change. */
  overlapMinutes: number;
  /** Other clashing sets beyond `otherSetId`. */
  more: number;
  /** True only when every pair for this set is a tight change. */
  tight: boolean;
  label: string;
}

interface BadgeCandidate {
  other: FestivalSet;
  overlapMinutes: number;
  tight: boolean;
}

const startKey = (s: FestivalSet): number => (s.startTime ? festivalStartMinutes(s.startTime) : Infinity);

/** Negative when `a` is the better "other" set for the badge. */
function compareCandidates(a: BadgeCandidate, b: BadgeCandidate): number {
  // Any overlap outranks a tight change.
  if (a.tight !== b.tight) return a.tight ? 1 : -1;
  if (a.overlapMinutes !== b.overlapMinutes) return b.overlapMinutes - a.overlapMinutes;
  const byStart = startKey(a.other) - startKey(b.other);
  if (byStart !== 0) return byStart;
  return a.other.id < b.other.id ? -1 : a.other.id > b.other.id ? 1 : 0;
}

/**
 * One badge per clashing set, from clash pairs (`ConflictDetected` or the
 * `ConflictPair`s of `buildPickConflicts`). The badge names the set with the
 * largest overlap; a tight pair ranks below any overlap; ties go to the
 * earlier-starting other set, then the lower id.
 */
export function clashBadgeBySetId(
  pairs: ReadonlyArray<{ setA: FestivalSet; setB: FestivalSet; overlapMinutes: number; tight?: boolean }>,
  b2bSeparator?: string,
): Map<string, ClashBadge> {
  const candidates = new Map<string, BadgeCandidate[]>();
  const add = (self: FestivalSet, candidate: BadgeCandidate) => {
    const list = candidates.get(self.id) ?? [];
    list.push(candidate);
    candidates.set(self.id, list);
  };
  for (const p of pairs) {
    const tight = !!p.tight;
    add(p.setA, { other: p.setB, overlapMinutes: p.overlapMinutes, tight });
    add(p.setB, { other: p.setA, overlapMinutes: p.overlapMinutes, tight });
  }

  const badges = new Map<string, ClashBadge>();
  for (const [setId, list] of candidates) {
    const best = list.reduce((a, b) => (compareCandidates(b, a) < 0 ? b : a));
    const otherName = artistDisplayName(best.other, b2bSeparator);
    const more = list.length - 1;
    const base = best.tight
      ? `Tight change with ${otherName}`
      : `Clashes with ${otherName} (${fmtDurationMinutes(best.overlapMinutes)})`;
    badges.set(setId, {
      otherSetId: best.other.id,
      otherName,
      overlapMinutes: best.tight ? 0 : best.overlapMinutes,
      more,
      tight: best.tight,
      label: more > 0 ? `${base} +${more}` : base,
    });
  }
  return badges;
}
