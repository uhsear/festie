import type { Priority } from '../types/domain';
import type { ConflictGroup } from './pickConflicts';
import { artistDisplayName } from './format';
import { fmtDurationMinutes } from './scheduleFormat';
import { fmtZonedClock } from './dayOf';

// ── Clash fixes: Keep one, or Split between two ─────────────────────────────
// Pure planning for the clash cards. Each plan is a ClashChange: the pick and
// note writes to apply, plus the message to show. `invertChange` gives the
// Undo. A split plan lives as one line in the personal note of the set you
// leave, so it syncs, exports and lists like any other note.

export const SPLIT_PLAN_PREFIX = 'Split plan: ';
/** A split that leaves less than this much of a set is not worth offering. */
export const SPLIT_MIN_MINUTES = 10;
/** Matches the lib/config.ts MAX_NOTE_LENGTH default. */
export const NOTE_MAX_LENGTH = 1000;

export interface SplitPlan {
  /** Always the earlier set (setA). */
  leaveSetId: string;
  /** The later set (setB). */
  joinSetId: string;
  /** group.recommendedKeepId */
  keepSetId: string;
  leaveAtMs: number;
  walkMinutes: number | null;
  sentence: string;
}

export interface SplitContext {
  b2bSeparator?: string;
  timeZone?: string;
  stageName: (stageId: string) => string;
}

/**
 * One fix to apply. `null` as a pick's `to` removes the pick; `undefined` as a
 * note's `to` means the set had no note, and the write clears it.
 */
export interface ClashChange {
  picks: Array<{ setId: string; from: Priority | null; to: Priority | null }>;
  notes: Array<{ setId: string; from: string | undefined; to: string | undefined }>;
  message: string;
}

/** The two picks of a splittable group, earlier first; null when the group cannot split. */
function splitPair(group: ConflictGroup) {
  if (group.picks.length !== 2) return null;
  const [a, b] = group.picks as [ConflictGroup['picks'][number], ConflictGroup['picks'][number]];
  // A set that contains the other has no split.
  if (!(a.startMs < b.startMs && a.endMs < b.endMs)) return null;
  return { a, b };
}

/**
 * The split plan for a 2-pick group: see the start of the earlier set and
 * walk to the later one (keep the later), or see all of the earlier set and
 * catch the end of the later one (keep the earlier). Null when no split leaves
 * at least SPLIT_MIN_MINUTES of the set you split.
 */
export function buildSplitPlan(group: ConflictGroup, ctx: SplitContext): SplitPlan | null {
  const pair = splitPair(group);
  if (!pair) return null;
  const { a, b } = pair;
  const walk = group.pairs[0]?.walkMinutes ?? null;
  const walkMs = (walk ?? 0) * 60000;
  const nameA = artistDisplayName(a.set, ctx.b2bSeparator);
  const nameB = artistDisplayName(b.set, ctx.b2bSeparator);
  const stageB = ctx.stageName(b.set.stageId);
  const walks = walk != null && walk > 0;

  let leaveAtMs: number;
  let sentence: string;
  if (group.recommendedKeepId === b.set.id) {
    leaveAtMs = b.startMs - walkMs;
    const seeFirst = Math.round((leaveAtMs - a.startMs) / 60000);
    if (seeFirst < SPLIT_MIN_MINUTES) return null;
    const at = fmtZonedClock(leaveAtMs, ctx.timeZone);
    sentence = walks
      ? `See the first ${fmtDurationMinutes(seeFirst)} of ${nameA}, leave at ${at} and walk ${walk} min to ${stageB} for ${nameB}.`
      : `See the first ${fmtDurationMinutes(seeFirst)} of ${nameA}, then leave at ${at} for ${nameB} at ${stageB}.`;
  } else {
    leaveAtMs = a.endMs;
    const catchLast = Math.round((b.endMs - (a.endMs + walkMs)) / 60000);
    if (catchLast < SPLIT_MIN_MINUTES) return null;
    sentence = walks
      ? `See all of ${nameA}, then walk ${walk} min to ${stageB} for the last ${fmtDurationMinutes(catchLast)} of ${nameB}.`
      : `See all of ${nameA}, then go to ${stageB} for the last ${fmtDurationMinutes(catchLast)} of ${nameB}.`;
  }

  return {
    leaveSetId: a.set.id,
    joinSetId: b.set.id,
    keepSetId: group.recommendedKeepId,
    leaveAtMs,
    walkMinutes: walk,
    sentence,
  };
}

/** The saved split-plan line (with its prefix) in the note of the set you leave, or null. */
export function findSplitPlanLine(
  group: ConflictGroup,
  notes: Record<string, string> | undefined,
  b2bSeparator?: string,
): string | null {
  const pair = splitPair(group);
  if (!pair) return null;
  const note = notes?.[pair.a.set.id];
  if (!note) return null;
  const nameB = artistDisplayName(pair.b.set, b2bSeparator);
  return note.split('\n').find((line) => line.startsWith(SPLIT_PLAN_PREFIX) && line.includes(nameB)) ?? null;
}

/** Keep one set: remove every other pick in the group. */
export function planKeep(group: ConflictGroup, keepSetId: string, b2bSeparator?: string): ClashChange {
  const keep = group.picks.find((p) => p.set.id === keepSetId);
  const removed = group.picks.filter((p) => p.set.id !== keepSetId);
  const keptName = keep ? artistDisplayName(keep.set, b2bSeparator) : keepSetId;
  const message =
    removed.length === 1
      ? `Kept ${keptName}. ${artistDisplayName(removed[0]!.set, b2bSeparator)} is off your picks.`
      : `Kept ${keptName}. ${removed.length} sets are off your picks.`;
  return {
    picks: removed.map((p) => ({ setId: p.set.id, from: p.priority, to: null })),
    notes: [],
    message,
  };
}

/** Split: keep both picks and append the plan to the note of the set you leave. */
export function planSplit(
  group: ConflictGroup,
  notes: Record<string, string> | undefined,
  ctx: SplitContext,
): ClashChange | { error: string } {
  const plan = buildSplitPlan(group, ctx);
  if (!plan) return { error: 'These sets cannot be split.' };
  const from = notes?.[plan.leaveSetId];
  const line = SPLIT_PLAN_PREFIX + plan.sentence;
  const to = from ? `${from}\n${line}` : line;
  const nameA = artistDisplayName(group.picks[0]!.set, ctx.b2bSeparator);
  if (to.length > NOTE_MAX_LENGTH) {
    return { error: `Your note on ${nameA} is full. Shorten it, then try Split again.` };
  }
  return {
    picks: [],
    notes: [{ setId: plan.leaveSetId, from, to }],
    message: `Split plan saved in your note on ${nameA}.`,
  };
}

/** Remove the saved split-plan line and keep the rest of the note. Null when there is no plan. */
export function planClearSplit(
  group: ConflictGroup,
  notes: Record<string, string> | undefined,
  b2bSeparator?: string,
): ClashChange | null {
  const line = findSplitPlanLine(group, notes, b2bSeparator);
  if (line == null) return null;
  const setId = group.picks[0]!.set.id;
  const from = notes![setId]!;
  const lines = from.split('\n');
  lines.splice(lines.indexOf(line), 1);
  return {
    picks: [],
    notes: [{ setId, from, to: lines.join('\n') }],
    message: 'Split plan removed.',
  };
}

/** The Undo of a change: every write swapped back. */
export function invertChange(change: ClashChange): ClashChange {
  return {
    picks: change.picks.map((p) => ({ setId: p.setId, from: p.to, to: p.from })),
    notes: change.notes.map((n) => ({ setId: n.setId, from: n.to, to: n.from })),
    message: change.message,
  };
}
