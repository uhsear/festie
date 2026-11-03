import type { Festival, FestivalDay, FestivalSet, Priority } from '../types/domain';
import type { WrapCaughtSet, WrapCard, WrapFestival, WrapPlannedSet, WrapRatedSet, WrapResponse } from '../types/wrap';
import { ConflictDetected, detectConflicts } from './conflicts';
import { formatFestivalDateRange, timeToMinutes } from './format';
import { isFestivalOver, resolveFestivalTimeZone } from './festivalTime';
import { getSetTimeBounds } from './setStatus';

const UNKNOWN_ARTIST = 'Unknown artist';
const MAX_ROWS = 5;

type Row = NonNullable<WrapCard['rows']>[number];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const artistOf = (s: { artist: string | null }) => s.artist || UNKNOWN_ARTIST;
const startMin = (s: { startTime: string | null }) => (s.startTime ? timeToMinutes(s.startTime) : Infinity);
const byDayThenStart = (a: WrapPlannedSet, b: WrapPlannedSet) =>
  (a.dayIndex ?? Infinity) - (b.dayIndex ?? Infinity) || startMin(a) - startMin(b);
const anyCaughtMark = (planned: WrapPlannedSet[]) => planned.some((s) => s.caught !== null);

/** True once the festival is over, using the shared end rule (not a second one). */
export function isWrapUnlocked(festival: WrapFestival, now: Date = new Date()): boolean {
  return isFestivalOver(
    { id: festival.id, name: festival.name, timeZone: festival.timeZone } as Festival,
    festival.days,
    now,
  );
}

/** Picked sets that have ended and are not rated yet: yesterday first, then by start time. */
export function selectSetsToRate(
  planned: WrapPlannedSet[],
  festival: WrapFestival,
  nowMs: number = Date.now(),
): WrapPlannedSet[] {
  const days = festival.days as unknown as FestivalDay[];
  const zone = resolveFestivalTimeZone(festival);
  return planned
    .flatMap((set) => {
      if (set.rating !== null || !set.startTime || set.dayIndex === null) return [];
      const bounds = getSetTimeBounds(
        { startTime: set.startTime, endTime: set.endTime ?? '', dayIndex: set.dayIndex },
        days,
        zone,
      );
      return bounds && bounds.endMs <= nowMs ? [{ set, startMs: bounds.startMs }] : [];
    })
    .sort((a, b) => b.set.dayIndex! - a.set.dayIndex! || a.startMs - b.startMs)
    .map((x) => x.set);
}

export function summarizePlan(
  planned: WrapPlannedSet[],
  extra: WrapCaughtSet[] = [],
): {
  planned: number;
  mustSees: number;
  stages: number;
  days: number;
  hours: number;
  clashes: ConflictDetected[];
} {
  // Once the user marked any set, hours and stages count only the sets they saw (as the server's stats do).
  // Added sets (caught, not picked) count as seen.
  const seen: Array<WrapPlannedSet | WrapCaughtSet> =
    anyCaughtMark(planned) || extra.length > 0
      ? [...planned.filter((s) => s.caught === true), ...extra.filter((s) => s.caught === true)]
      : planned;
  let minutes = 0;
  for (const s of seen) {
    if (s.startTime && s.endTime) {
      minutes += (timeToMinutes(s.endTime) - timeToMinutes(s.startTime) + 1440) % 1440;
    }
  }
  const priorities = new Map<string, Priority>(planned.map((s) => [s.setId, s.priority]));
  const asSets = planned.map(
    (s) =>
      ({
        id: s.setId,
        artist: s.artist ?? undefined,
        startTime: s.startTime,
        endTime: s.endTime,
        dayIndex: s.dayIndex ?? undefined,
      }) as unknown as FestivalSet,
  );
  return {
    planned: planned.length,
    mustSees: planned.filter((s) => s.priority === 'must').length,
    stages: new Set(seen.map((s) => s.stageId).filter(Boolean)).size,
    days: new Set(planned.map((s) => s.dayIndex).filter((d) => d != null)).size,
    hours: minutes / 60,
    clashes: detectConflicts(asSets, (id) => priorities.get(id)),
  };
}

export function wrapByline(festival: WrapFestival, username: string | null, showHandle: boolean): string | null {
  const handle = showHandle && username ? `@${username}` : null;
  const dates = formatFestivalDateRange(festival.days[0]?.date, festival.days[festival.days.length - 1]?.date);
  const parts = [handle, dates].filter((p): p is string => !!p);
  return parts.length ? parts.join(' · ') : null;
}

function ratedRow(s: WrapRatedSet): Row {
  return { primary: artistOf(s), secondary: s.stageName, rating: s.rating };
}

function plannedRow(s: WrapPlannedSet): Row {
  return { primary: artistOf(s), secondary: s.stageName };
}

function hardestClash(clashes: ConflictDetected[]): ConflictDetected {
  return clashes.find((c) => c.hard) ?? clashes.reduce((best, c) => (c.overlapMinutes > best.overlapMinutes ? c : best));
}

function distinctCount(values: Array<string | number | null>): number {
  return new Set(values.filter((v) => v != null)).size;
}

export function buildWrapCards(wrap: WrapResponse): WrapCard[] {
  const { planned, topSets, allRatings, stats, crew } = wrap;
  const extra = wrap.caughtExtra ?? [];
  const plan = summarizePlan(planned, extra);
  const cards: WrapCard[] = [];

  const mustSees = planned.filter((s) => s.priority === 'must').sort(byDayThenStart);
  if (plan.planned > 0) {
    cards.push({
      kind: 'plan',
      kicker: 'YOUR PLAN',
      headline: `${plural(plan.planned, 'set', 'sets')} planned`,
      sub: `${plural(plan.mustSees, 'must-see', 'must-sees')} · ${plural(plan.days, 'day', 'days')} · ${plural(distinctCount(planned.map((s) => s.stageId)), 'stage', 'stages')}`,
      rows: mustSees.slice(0, MAX_ROWS).map(plannedRow),
    });
  }

  if (topSets.length > 0) {
    cards.push({
      kind: 'top',
      kicker: 'YOUR TOP SETS',
      headline: artistOf(topSets[0]!),
      sub: `#1 of ${plural(stats.totalRated, 'set', 'sets')} you rated`,
      rows: topSets.slice(0, MAX_ROWS).map(ratedRow),
    });
  }

  if (plan.clashes.length > 0) {
    const hardest = hardestClash(plan.clashes);
    cards.push({
      kind: 'clash',
      kicker: 'CLASHES SURVIVED',
      headline: `You survived ${plural(plan.clashes.length, 'clash', 'clashes')}`,
      sub: `Hardest call: ${hardest.setA.artist || UNKNOWN_ARTIST} vs ${hardest.setB.artist || UNKNOWN_ARTIST}`,
    });
  }

  const agreed = planned.filter((s) => (s.crewAlso ?? 0) >= 1);
  if (crew && agreed.length > 0) {
    const top = [...agreed].sort((a, b) => b.crewAlso! - a.crewAlso! || byDayThenStart(a, b)).slice(0, 3);
    cards.push({
      kind: 'crew',
      kicker: 'YOUR CREW',
      headline: `${crew.name} agreed on ${plural(agreed.length, 'set', 'sets')}`,
      rows: top.map((s) => ({ ...plannedRow(s), badge: `${s.crewAlso! + 1} of ${crew.memberCount}` })),
    });
  }

  const remembered = allRatings
    .filter((s) => s.note && s.note.trim() !== '')
    .sort((a, b) => b.rating - a.rating || (b.dayIndex ?? -1) - (a.dayIndex ?? -1))[0];
  if (remembered) {
    cards.push({
      kind: 'memory',
      kicker: 'A MOMENT TO REMEMBER',
      headline: artistOf(remembered),
      quote: {
        text: remembered.note!,
        by: [artistOf(remembered), remembered.stageName].filter(Boolean).join(' · '),
      },
    });
  }

  if (cards.length === 0 && !extra.some((s) => s.caught === true)) return [];

  const everyone = [...planned, ...extra, ...allRatings];
  const hours = plan.planned > 0 || extra.length > 0 ? plan.hours : stats.totalHours;
  const stages = anyCaughtMark(planned) || extra.length > 0 ? plan.stages : distinctCount(everyone.map((s) => s.stageId));
  cards.push({
    kind: 'summary',
    kicker: 'YOUR FESTIVAL WRAP',
    headline: `${hours.toFixed(1)} hours of music`,
    stats: [
      { label: 'Planned', value: String(plan.planned) },
      { label: 'Rated', value: String(stats.totalRated) },
      { label: 'Stages', value: String(stages) },
      { label: 'Days', value: String(distinctCount(everyone.map((s) => s.dayIndex))) },
    ],
    rows: topSets.length > 0 ? topSets.slice(0, 3).map(ratedRow) : mustSees.slice(0, 3).map(plannedRow),
  });
  return cards;
}

export function wrapCardShareText(card: WrapCard, festivalName: string): string {
  const kicker = card.kicker.charAt(0) + card.kicker.slice(1).toLowerCase();
  return [`My ${festivalName} wrap`, `${kicker}: ${card.headline}`, card.sub, 'festie.us'].filter(Boolean).join('\n');
}
