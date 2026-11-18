import type { FestivalDay, FestivalSet, InterestMark, LineupEntry, Priority, Stage } from '../types/domain';
import type { LineupCover } from './lineupCover';
import { lineupCoveringSets, lineupSetWhen } from './lineup';

// What the "Interested" view and the Picks group show for a user's marks. Web renders this today and
// mobile will in phase A5, so the two read one rule. The marks themselves live on the profile
// (signed in) or in guestInterests (guest); the server converts open marks into picks.

export type InterestRowStatus =
  /** No set covers the act yet. */
  | 'waiting'
  /** A set covers it but the mark is still open: conversion has not run, or the picks were full. */
  | 'has-set'
  /** Converted, and the user still has a pick on a covering set. */
  | 'in-picks'
  /** Converted, and no covering set is in the user's picks any more. */
  | 'not-in-picks'
  | 'cancelled';

export interface InterestRow {
  entry: LineupEntry;
  mark: InterestMark;
  cover: LineupCover;
  status: InterestRowStatus;
  /** "In your picks · Fri · 10:00 PM · Main Stage" for `in-picks`. */
  pickedWhen: string | null;
  /** The sets "Add to picks" would pick: every covering set, for `has-set` and `not-in-picks`. */
  addSetIds: string[];
}

/**
 * The user's marks as rows, open ones first and converted ones after, billing order inside each. A
 * converted row reads the user's real picks, not the mark: a pick the user removed shows as
 * "Not in your picks" with an "Add to picks" button. Marks on acts that left the lineup are skipped.
 */
export function interestedRows(input: {
  lineup: readonly LineupEntry[];
  marks: Record<string, InterestMark> | null | undefined;
  cover: Record<string, LineupCover>;
  picks: Record<string, Priority> | null | undefined;
  sets: readonly FestivalSet[];
  days: readonly FestivalDay[];
  stages: readonly Stage[];
}): InterestRow[] {
  const { lineup, marks, cover, picks, sets, days, stages } = input;
  if (!marks) return [];
  const rows: InterestRow[] = [];
  for (const entry of lineup) {
    const mark = marks[entry.id];
    const entryCover = cover[entry.id];
    if (!mark || !entryCover) continue;
    const covering = lineupCoveringSets(entryCover, sets);
    const picked = covering.filter((set) => picks?.[set.id]);
    let status: InterestRowStatus;
    if (entryCover.state === 'cancelled') status = 'cancelled';
    else if (mark.state === 'open') status = covering.length > 0 ? 'has-set' : 'waiting';
    else status = picked.length > 0 ? 'in-picks' : 'not-in-picks';
    rows.push({
      entry,
      mark,
      cover: entryCover,
      status,
      pickedWhen: status === 'in-picks' ? lineupSetWhen(picked[0]!, days, stages) : null,
      addSetIds: status === 'has-set' || status === 'not-in-picks' ? covering.map((set) => set.id) : [],
    });
  }
  const rank = (row: InterestRow) => (row.mark.state === 'open' ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b));
}

/** The marks the Picks tab lists under "Marked, no set yet": open marks on acts no set covers. */
export function markedWithoutSet(rows: readonly InterestRow[]): InterestRow[] {
  return rows.filter((row) => row.status === 'waiting');
}
