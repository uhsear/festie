import type { CrewMeetingPoint, FestivalDay, FestivalSet, Priority, Stage } from '../types/domain';
import type { ConflictGroup } from './pickConflicts';
import { clashBadgeBySetId } from './conflicts';
import { artistDisplayName } from './format';
import { stageWalkMinutes } from './geo';
import { meetAtTimeOfDay, meetingOccurrences } from './meetingTime';
import { fmtDurationMinutes } from './scheduleFormat';
import { createDateInLocalFrame, getSetTimeBounds, isSetScheduled, zonedWallTimeToMs } from './setStatus';

// ── My day: one itinerary for a festival day, plus the Reminders/Notes lists ──
// Pure (RN + web safe). Time math reuses getSetTimeBounds / meetingOccurrences,
// so a 00:30 set and a 01:00 meet-up land after midnight of the same night.

export type DayPart = 'afternoon' | 'evening' | 'late-night' | 'after-midnight';
export const DAY_PART_ORDER: readonly DayPart[] = ['afternoon', 'evening', 'late-night', 'after-midnight'];
/** A free hole shorter than this does not get its own row. */
export const MY_DAY_MIN_GAP_MINUTES = 30;

/** The part of a festival day a start hour (0-23) belongs to. */
export function dayPartForHour(hour: number): DayPart {
  if (hour < 6) return 'after-midnight';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'late-night';
}

/** The day's label, else the long weekday of its date (read at UTC noon, so no zone shifts it). */
export function nightLabelFor(day: { label?: string; date: string }): string {
  if (day.label) return day.label;
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${day.date.slice(0, 10)}T12:00:00Z`),
  );
}

export function dayPartTitle(part: DayPart, nightLabel: string): string {
  switch (part) {
    case 'afternoon':
      return 'Afternoon';
    case 'evening':
      return 'Evening';
    case 'late-night':
      return 'Late night';
    case 'after-midnight':
      return `After midnight (${nightLabel} night)`;
  }
}

export type MyDayItem =
  | {
      kind: 'set';
      key: string;
      set: FestivalSet;
      priority: Priority;
      startMs: number;
      endMs: number;
      walkFromPrev: { minutes: number; fromStageId: string } | null;
      clashLabel: string | null;
    }
  | { kind: 'meet'; key: string; meetingPointId: string; label: string; location: string; startMs: number }
  | { kind: 'gap'; key: string; minutes: number; startMs: number };

export interface MyDaySection {
  part: DayPart;
  title: string;
  items: MyDayItem[];
}

export interface MyDay {
  sections: MyDaySection[];
  /** Picks for the day without a time, and picks not on any known day. */
  unscheduled: FestivalSet[];
  /** Timed picks plus unscheduled picks. */
  pickCount: number;
}

export interface BuildMyDayInput {
  sets: FestivalSet[];
  myPicks: Record<string, Priority>;
  dayIndex: number;
  days: FestivalDay[];
  timeZone?: string;
  stages?: ReadonlyArray<Pick<Stage, 'id' | 'latitude' | 'longitude'>>;
  meetingPoints?: CrewMeetingPoint[];
  conflictGroups?: ConflictGroup[];
  b2bSeparator?: string;
}

type SetItem = Extract<MyDayItem, { kind: 'set' }>;
type MeetItem = Extract<MyDayItem, { kind: 'meet' }>;
type Placed = { item: SetItem | MeetItem; part: DayPart; endMs: number };

/** Wall-clock on `date` in the festival zone (device-local without one). Hours past 23 roll into the next day. */
function wallMs(date: string, hours: number, timeZone?: string): number {
  return timeZone ? zonedWallTimeToMs(date, hours, 0, timeZone) : createDateInLocalFrame(date, hours, 0).getTime();
}

function meetItems(input: BuildMyDayInput, day: FestivalDay | undefined): Placed[] {
  if (!day || !input.meetingPoints) return [];
  const from = wallMs(day.date, 6, input.timeZone);
  const to = wallMs(day.date, 30, input.timeZone);
  const out: Placed[] = [];
  for (const mp of input.meetingPoints) {
    if (!mp.active) continue;
    const tod = meetAtTimeOfDay(mp.meet_at, input.timeZone);
    if (!tod) continue;
    for (const occ of meetingOccurrences(mp.meet_at, mp.recurs_daily, input.days, input.timeZone)) {
      if (occ.ms < from || occ.ms >= to) continue;
      out.push({
        item: {
          kind: 'meet',
          key: `meet:${mp.id}:${occ.ms}`,
          meetingPointId: mp.id,
          label: mp.label,
          location: mp.location,
          startMs: occ.ms,
        },
        part: dayPartForHour(tod.hours),
        endMs: occ.ms,
      });
    }
  }
  return out;
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The day's picks and crew meet-ups in time order, grouped into day parts, with free gaps and walks. */
export function buildMyDay(input: BuildMyDayInput): MyDay {
  const { sets, myPicks, dayIndex, days, timeZone, stages, conflictGroups = [], b2bSeparator } = input;
  const badges = clashBadgeBySetId(
    conflictGroups.flatMap((g) => g.pairs),
    b2bSeparator,
  );

  const unscheduled: FestivalSet[] = [];
  const placed: Placed[] = [];
  for (const set of sets) {
    const priority = myPicks[set.id];
    if (!priority) continue;
    if (!isSetScheduled(set, days)) {
      unscheduled.push(set);
      continue;
    }
    if (set.dayIndex !== dayIndex) continue;
    const bounds = getSetTimeBounds(set, days, timeZone);
    if (!bounds) {
      unscheduled.push(set);
      continue;
    }
    placed.push({
      item: {
        kind: 'set',
        key: `set:${set.id}`,
        set,
        priority,
        startMs: bounds.startMs,
        endMs: bounds.endMs,
        walkFromPrev: null,
        clashLabel: badges.get(set.id)?.label ?? null,
      },
      part: dayPartForHour(Number(set.startTime.slice(0, 2))),
      endMs: bounds.endMs,
    });
  }
  const timedSetCount = placed.length;
  placed.push(...meetItems(input, days[dayIndex]));

  // Time order; at the same instant a meet-up comes first, then sets by end, then id.
  placed.sort((x, y) => {
    if (x.item.startMs !== y.item.startMs) return x.item.startMs - y.item.startMs;
    if (x.item.kind !== y.item.kind) return x.item.kind === 'meet' ? -1 : 1;
    if (x.endMs !== y.endMs) return x.endMs - y.endMs;
    return compareKeys(x.item.key, y.item.key);
  });

  const byPart = new Map<DayPart, MyDayItem[]>();
  let busyUntil = -Infinity;
  let prevSet: SetItem | null = null;
  for (const { item, part, endMs } of placed) {
    const items = byPart.get(part) ?? [];
    const freeMs = item.startMs - busyUntil;
    if (Number.isFinite(freeMs) && freeMs >= MY_DAY_MIN_GAP_MINUTES * 60000) {
      items.push({ kind: 'gap', key: `gap:${busyUntil}`, minutes: Math.round(freeMs / 60000), startMs: busyUntil });
    }
    if (item.kind === 'set') {
      if (prevSet && prevSet.set.stageId !== item.set.stageId) {
        const minutes = stageWalkMinutes(stages, prevSet.set.stageId, item.set.stageId);
        if (minutes != null && minutes > 0) item.walkFromPrev = { minutes, fromStageId: prevSet.set.stageId };
      }
      prevSet = item;
    }
    items.push(item);
    byPart.set(part, items);
    busyUntil = Math.max(busyUntil, endMs);
  }

  const day = days[dayIndex];
  const nightLabel = day ? nightLabelFor(day) : '';
  return {
    sections: DAY_PART_ORDER.filter((part) => byPart.has(part)).map((part) => ({
      part,
      title: dayPartTitle(part, nightLabel),
      items: byPart.get(part)!,
    })),
    unscheduled,
    pickCount: timedSetCount + unscheduled.length,
  };
}

export type PlanListKind = 'reminders' | 'notes';

export interface PlanListItem {
  set: FestivalSet;
  /** null when the set is not on a known day. */
  dayIndex: number | null;
  /** Trimmed personal note. */
  note: string | null;
  reminderMinutes: number | null;
  priority: Priority | null;
}

/**
 * Every set with a reminder, or every set with a note, picked or not, in
 * schedule order. Unscheduled sets go last. Iterates `sets`, so `crew:<setId>`
 * note keys never show.
 */
export function buildPlanList(
  kind: PlanListKind,
  input: {
    sets: FestivalSet[];
    days: FestivalDay[];
    timeZone?: string;
    notes?: Record<string, string>;
    reminders?: Record<string, number>;
    myPicks?: Record<string, Priority>;
  },
): PlanListItem[] {
  const { sets, days, timeZone, notes, reminders, myPicks } = input;
  const rows: Array<PlanListItem & { startMs: number; name: string }> = [];
  for (const set of sets) {
    const note = notes?.[set.id]?.trim() || null;
    const reminder = reminders?.[set.id];
    const reminderMinutes = typeof reminder === 'number' ? reminder : null;
    if (kind === 'notes' ? note == null : reminderMinutes == null) continue;
    const scheduled = isSetScheduled(set, days);
    rows.push({
      set,
      dayIndex: scheduled ? set.dayIndex! : null,
      note,
      reminderMinutes,
      priority: myPicks?.[set.id] ?? null,
      startMs: (scheduled && getSetTimeBounds(set, days, timeZone)?.startMs) || Infinity,
      name: artistDisplayName(set),
    });
  }
  rows.sort((a, b) => {
    const da = a.dayIndex ?? Infinity;
    const db = b.dayIndex ?? Infinity;
    if (da !== db) return da - db;
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return a.name.localeCompare(b.name);
  });
  return rows.map(({ startMs: _startMs, name: _name, ...row }) => row);
}

/** "At start", "30 min before", "1 h before". */
export function reminderLeadLabel(minutes: number): string {
  if (minutes <= 0) return 'At start';
  if (minutes < 60) return `${minutes} min before`;
  return `${fmtDurationMinutes(minutes)} before`;
}
