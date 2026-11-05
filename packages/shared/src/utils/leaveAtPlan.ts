import type { FestivalDay, FestivalSet, Priority, Stage } from '../types/domain';
import { getSetTimeBounds } from './setStatus';
import { stageWalkMinutes, formatEta } from './geo';
import { formatTime } from './format';
import { PRIORITY_RANK } from './crewNudges';
import { leaveAtCopy, leaveAtHardCopy } from '../constants/copy';

/** Walk time assumed when either stage has no pin. Shown as "about". */
export const DEFAULT_WALK_MIN = 5;
/** Minimum minutes each set must keep inside the overlap, after the walk. */
export const MIN_SET_MIN = 10;

export interface LeaveAtPlan {
  kind: 'plan';
  /** Starts first: stay here until `leaveAtMs`. */
  stayAt: FestivalSet;
  /** Walk here and catch the rest of it. */
  thenSet: FestivalSet;
  leaveAtMs: number;
  walkMin: number;
  /** True when the walk is the default, not measured from stage pins. */
  walkEstimated: boolean;
  /** Minutes of `thenSet` left from arrival to its end. */
  catchMin: number;
  /** Wall-clock "10:14 PM" of `leaveAtMs` in the festival zone (device zone when none). */
  leaveAtLabel: string;
}

export interface HardChoice {
  kind: 'hard';
  /** Minutes both sets run at once. */
  overlapMin: number;
}

export interface LeaveAtInput {
  a: FestivalSet;
  b: FestivalSet;
  days: FestivalDay[];
  timeZone?: string;
  stages?: ReadonlyArray<Pick<Stage, 'id' | 'latitude' | 'longitude'>>;
  priorityA?: Priority | null;
  priorityB?: Priority | null;
}

/** Festival-zone "h:mm AM" for an instant; the zone is the festival's, not the device's. */
function clockLabel(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}),
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return formatTime(`${get('hour')}:${get('minute')}`);
}

/**
 * Split plan for two clashing picks, or null when they do not overlap, or the
 * times or day do not resolve (different dayIndex is no clash, as detectConflicts).
 *
 * Rule: after the walk, the overlap leaves `avail` minutes. The earlier-starting set keeps
 * half of it; a strictly stronger priority on one side takes two thirds. Each side keeps
 * at least MIN_SET_MIN, else it is a hard choice. A set nested inside the other is hard too.
 */
export function buildLeaveAtPlan(input: LeaveAtInput): LeaveAtPlan | HardChoice | null {
  const { days, timeZone, stages } = input;
  if (input.a.dayIndex != null && input.b.dayIndex != null && input.a.dayIndex !== input.b.dayIndex) return null;
  const ba = getSetTimeBounds(input.a, days, timeZone);
  const bb = getSetTimeBounds(input.b, days, timeZone);
  if (!ba || !bb) return null;

  const aFirst = ba.startMs !== bb.startMs ? ba.startMs < bb.startMs : input.a.id < input.b.id;
  const [first, second] = aFirst ? [ba, bb] : [bb, ba];
  const [firstSet, secondSet] = aFirst ? [input.a, input.b] : [input.b, input.a];
  const [firstPri, secondPri] = aFirst ? [input.priorityA, input.priorityB] : [input.priorityB, input.priorityA];

  const overlapMs = Math.min(first.endMs, second.endMs) - second.startMs;
  if (overlapMs <= 0) return null;
  const overlapMin = Math.round(overlapMs / 60000);

  const measured = stageWalkMinutes(stages, firstSet.stageId, secondSet.stageId);
  const walkMin = measured ?? DEFAULT_WALK_MIN;
  const avail = overlapMin - walkMin;
  // Nested: the later set ends first, so there is no "rest of it" to catch.
  if (second.endMs < first.endMs || avail < 2 * MIN_SET_MIN) return { kind: 'hard', overlapMin };

  let firstShare = Math.floor(avail / 2);
  const rank = (p?: Priority | null) => (p ? PRIORITY_RANK[p] : Infinity);
  if (rank(firstPri) < rank(secondPri)) firstShare = Math.ceil((avail * 2) / 3);
  else if (rank(secondPri) < rank(firstPri)) firstShare = Math.floor(avail / 3);
  firstShare = Math.min(Math.max(firstShare, MIN_SET_MIN), avail - MIN_SET_MIN);

  const leaveAtMs = second.startMs + firstShare * 60000;
  return {
    kind: 'plan',
    stayAt: firstSet,
    thenSet: secondSet,
    leaveAtMs,
    walkMin,
    walkEstimated: measured == null,
    catchMin: Math.round((second.endMs - (leaveAtMs + walkMin * 60000)) / 60000),
    leaveAtLabel: clockLabel(leaveAtMs, timeZone),
  };
}

/** One-line plan text for the clash prompt; `nameOf` turns a set into its display name. */
export function leaveAtLine(r: LeaveAtPlan | HardChoice, nameOf: (s: FestivalSet) => string): string {
  if (r.kind === 'hard') return leaveAtHardCopy(r.overlapMin);
  return leaveAtCopy({
    stayName: nameOf(r.stayAt), thenName: nameOf(r.thenSet), leaveAt: r.leaveAtLabel,
    walk: formatEta(r.walkMin), catchFor: formatEta(r.catchMin),
  });
}
