/**
 * Crew days: which festival days each member attends. Pure helpers shared by
 * web and mobile. No row means "no answer"; only an explicit `'no'` removes a
 * member from a day, so a crew where nobody answered behaves as before.
 */
import type { CrewDayAnswer, CrewMemberDay, FestivalDay } from '../types/domain';
import { formatDayChip } from './scheduleFormat';
import { createDateInLocalFrame } from './setStatus';

/** userId -> dayIndex -> answer */
export type CrewDaysIndex = Map<string, Map<number, CrewDayAnswer>>;

export function indexCrewDays(rows: CrewMemberDay[]): CrewDaysIndex {
  const index: CrewDaysIndex = new Map();
  for (const row of rows) {
    const byDay = index.get(row.userId) ?? new Map<number, CrewDayAnswer>();
    byDay.set(row.dayIndex, row.answer);
    index.set(row.userId, byDay);
  }
  return index;
}

/** False only for an explicit `'no'`. No answer and `'maybe'` both count as attending. */
export function isAttending(index: CrewDaysIndex, userId: string, dayIndex: number): boolean {
  return index.get(userId)?.get(dayIndex) !== 'no';
}

export function attendingDayCount(index: CrewDaysIndex, userId: string, dayCount: number): number {
  let count = 0;
  for (let d = 0; d < dayCount; d += 1) if (isAttending(index, userId, d)) count += 1;
  return count;
}

/** True when at least one of these users has answered at least one day. */
export function hasDayAnswers(index: CrewDaysIndex, userIds: string[]): boolean {
  return userIds.some((id) => (index.get(id)?.size ?? 0) > 0);
}

const WEEKDAY_LABEL = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*/i;

/** `Sat` from a weekday label (the festival's own name for the day, as `formatDayChip` shows); else from the date at noon; else the trimmed label; else `Day 3`. */
export function dayShortLabel(day: Pick<FestivalDay, 'date' | 'label'>, dayIndex: number): string {
  const named = WEEKDAY_LABEL.exec(day.label?.trim() ?? '');
  if (named) return named[1]!.charAt(0).toUpperCase() + named[1]!.slice(1).toLowerCase();
  const key = day.date?.slice(0, 10) ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const d = createDateInLocalFrame(key, 12, 0);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('en-US', { weekday: 'short' });
  }
  return day.label?.trim() || `Day ${dayIndex + 1}`;
}

export interface MemberDayChip {
  dayIndex: number;
  /** Short label. A `?` suffix marks Maybe so colour is never the only cue. */
  label: string;
  answer: CrewDayAnswer;
}

/**
 * One chip per answered day, in day order. `a11y` reads `going Saturday; maybe
 * Sunday`, without the member name (callers prefix `{name}: `).
 */
export function memberDayChips(
  index: CrewDaysIndex,
  userId: string,
  days: FestivalDay[],
): { chips: MemberDayChip[]; a11y: string | null } {
  const byDay = index.get(userId);
  const chips: MemberDayChip[] = [];
  const long: Record<CrewDayAnswer, string[]> = { going: [], maybe: [], no: [] };
  days.forEach((day, dayIndex) => {
    const answer = byDay?.get(dayIndex);
    if (!answer) return;
    const short = dayShortLabel(day, dayIndex);
    chips.push({ dayIndex, label: answer === 'maybe' ? `${short}?` : short, answer });
    long[answer].push(formatDayChip(day).label);
  });
  if (chips.length === 0) return { chips, a11y: null };
  const parts = (['going', 'maybe', 'no'] as const)
    .filter((a) => long[a].length > 0)
    .map((a) => `${a === 'no' ? 'not going' : a} ${long[a].join(', ')}`);
  return { chips, a11y: parts.join('; ') };
}

/** Your full answer set with `dayIndex` set to `answer` (`null` removes it), sorted by day. */
export function myDaysPayload(
  index: CrewDaysIndex,
  userId: string,
  dayIndex: number,
  answer: CrewDayAnswer | null,
): { days: Array<{ dayIndex: number; answer: CrewDayAnswer }> } {
  const mine = new Map(index.get(userId));
  if (answer === null) mine.delete(dayIndex);
  else mine.set(dayIndex, answer);
  const days = [...mine.entries()].map(([d, a]) => ({ dayIndex: d, answer: a })).sort((a, b) => a.dayIndex - b.dayIndex);
  return { days };
}
