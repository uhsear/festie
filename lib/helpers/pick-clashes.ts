// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Keeps the co-picked set pairs that overlap in time, for the admin pick insight.
 */

import { validateTime } from './validation';
import { festivalStartMinutes } from '../time-zone';

export interface ClashCandidate { aId: string; bId: string; people: number }

interface FestivalLike {
  days?: Array<{ sets?: Array<{ id: string; startTime?: string | null; endTime?: string | null }> }>;
}

/**
 * Overlap is `aStart < bEnd && bStart < aEnd` in festival minutes (6 AM day rule;
 * an end not after its start rolls forward a day), as stageOverlapWarnings uses.
 * Sorted by people desc, then the later of the two starts, then aSetId.
 */
export function overlappingClashes(
  festival: FestivalLike,
  candidates: ClashCandidate[],
  limit = 50,
): Array<{ aSetId: string; bSetId: string; people: number }> {
  const ranges = new Map<string, { start: number; end: number }>();
  for (const day of festival?.days ?? []) {
    for (const set of day?.sets ?? []) {
      if (!validateTime(set?.startTime) || !validateTime(set?.endTime)) continue;
      const start = festivalStartMinutes(set.startTime as string);
      let end = festivalStartMinutes(set.endTime as string);
      if (end <= start) end += 1440;
      ranges.set(set.id, { start, end });
    }
  }

  const out: Array<{ aSetId: string; bSetId: string; people: number; overlapStart: number }> = [];
  for (const { aId, bId, people } of candidates) {
    const x = ranges.get(aId);
    const y = ranges.get(bId);
    if (!x || !y || !(x.start < y.end && y.start < x.end)) continue;
    const xFirst = x.start < y.start || (x.start === y.start && aId < bId);
    out.push({
      aSetId: xFirst ? aId : bId,
      bSetId: xFirst ? bId : aId,
      people,
      overlapStart: Math.max(x.start, y.start),
    });
  }

  out.sort((p, q) =>
    q.people - p.people
    || p.overlapStart - q.overlapStart
    || (p.aSetId < q.aSetId ? -1 : p.aSetId > q.aSetId ? 1 : 0));
  return out.slice(0, limit).map(({ aSetId, bSetId, people }) => ({ aSetId, bSetId, people }));
}
