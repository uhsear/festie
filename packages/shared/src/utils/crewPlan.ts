/**
 * Crew-plan digest assembly — the PURE, offline-native logic behind the web and
 * mobile "crew plan" screens. Both screens previously kept byte-identical copies
 * of `pickActiveMeetingPoint` + `buildSlots`; they now share this single source.
 *
 * Everything here reads only its arguments (no stores, no fetches, no globals) so
 * the screens stay thin wiring and a Vitest unit can exercise the logic directly.
 *
 * NOTE: this `pickActiveMeetingPoint(points, nowMs)` is the crew-plan variant
 * (soonest future-or-now timed point, else most-recent untimed). It is distinct
 * from `ongoingNotification.pickActiveMeetingPoint(points)`, which picks the most
 * recently-set active point for the ongoing-set notification — different inputs,
 * different intent, kept separate on purpose.
 */
import type {
  Crew,
  CrewMeetingPoint,
  CrewMember,
  Festival,
  FestivalDay,
  FestivalSet,
  Priority,
  Profile,
} from '../types/domain';
import { PRIORITY_WEIGHT } from './crewNudges';
import { festivalStartMinutes, getSetTimeBounds } from './setStatus';

/** Default number of upcoming start-time slots surfaced by `buildSlots`. */
export const CREW_PLAN_SLOTS = 3;

/** The soonest still-active meeting point with a future-or-now meet time. */
export function pickActiveMeetingPoint(points: CrewMeetingPoint[], nowMs: number): CrewMeetingPoint | null {
  const future = points
    .filter((p) => p.active && p.meet_at)
    .map((p) => ({ p, ms: new Date(p.meet_at as string).getTime() }))
    .filter(({ ms }) => Number.isFinite(ms) && ms >= nowMs)
    .sort((a, b) => a.ms - b.ms);
  if (future.length > 0) return future[0]!.p;
  // No timed future point — fall back to the most recent active untimed point so
  // a standing meetup (e.g. "the big tree") still shows.
  const untimed = points.filter((p) => p.active && !p.meet_at);
  return untimed[0] ?? null;
}

export interface SlotPick {
  memberId: string;
  memberName: string;
  set: FestivalSet;
  priority: Priority;
}

export interface Slot {
  startMs: number;
  startTime: string;
  picks: SlotPick[];
}

/**
 * Group future sets into the next `limit` start-time slots and, for each crew
 * member, surface their single highest-priority pick in that slot. Pass the
 * festival `timeZone` so slot times are real instants for a phone in another zone.
 */
export function buildSlots(
  sets: FestivalSet[],
  days: FestivalDay[],
  profiles: Profile[],
  nowMs: number,
  limit: number = CREW_PLAN_SLOTS,
  timeZone?: string,
): Slot[] {
  // Resolve each set's bounds once; keep only sets that haven't ended yet.
  const timed = sets
    .map((set) => ({ set, bounds: getSetTimeBounds(set, days, timeZone) }))
    .filter((x): x is { set: FestivalSet; bounds: { startMs: number; endMs: number } } => x.bounds != null)
    .filter((x) => x.bounds.endMs > nowMs);

  // Distinct start times become "slots", soonest first, capped to `limit`.
  const startTimes = Array.from(new Set(timed.map((x) => x.bounds.startMs)))
    .sort((a, b) => a - b)
    .slice(0, limit);

  return startTimes.map((startMs) => {
    const slotSets = timed.filter((x) => x.bounds.startMs === startMs).map((x) => x.set);
    const slotSetIds = new Set(slotSets.map((s) => s.id));
    const setsById = new Map(slotSets.map((s) => [s.id, s]));

    const picks: SlotPick[] = [];
    for (const profile of profiles) {
      // Highest-priority pick this member has among the slot's sets.
      let best: { setId: string; priority: Priority } | null = null;
      for (const [setId, priority] of Object.entries(profile.picks || {})) {
        if (!slotSetIds.has(setId)) continue;
        const p = priority as Priority;
        if (!best || PRIORITY_WEIGHT[p] > PRIORITY_WEIGHT[best.priority]) best = { setId, priority: p };
      }
      if (best) {
        picks.push({
          memberId: profile.id,
          memberName: profile.name || 'Crew member',
          set: setsById.get(best.setId)!,
          priority: best.priority,
        });
      }
    }
    // Strongest commitments first.
    picks.sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);

    const sampleStart = slotSets[0]?.startTime ?? '';
    return { startMs, startTime: sampleStart, picks };
  });
}

export type CrewScreenStatus = 'ready' | 'loading' | 'error' | 'none';

/**
 * What a crew screen should render. With crews but none active, the auto-select
 * is about to run, so that case reads as `loading` unless it already failed.
 */
export function crewScreenStatus(i: {
  hasActiveCrew: boolean;
  crewCount: number;
  loading: boolean;
  error: string | null;
}): CrewScreenStatus {
  if (i.hasActiveCrew) return 'ready';
  if (i.loading) return 'loading';
  if (i.error) return 'error';
  return i.crewCount === 0 ? 'none' : 'loading';
}

/**
 * The festival a crew screen may frame its times with. A crew belongs to one
 * festival, but `currentFestival` follows the schedule tab, so the two can
 * differ. Returning null for a mismatch makes callers fall back to the device
 * zone instead of rendering festival A's meeting times with festival B's zone
 * and days.
 */
export function festivalForCrew<F extends { id: string }>(
  crew: { festivalId?: string | null } | null | undefined,
  currentFestival: F | null | undefined,
): F | null {
  if (!currentFestival) return null;
  return !crew?.festivalId || crew.festivalId === currentFestival.id ? currentFestival : null;
}

/** The crew's festival name from the festival list, else the current festival when it matches. */
export function crewFestivalName(
  crew: Pick<Crew, 'festivalId'> | null,
  festivals: Festival[],
  currentFestival: Festival | null,
): string | null {
  if (!crew?.festivalId) return currentFestival?.name ?? null;
  const listed = festivals.find((f) => f.id === crew.festivalId);
  if (listed) return listed.name;
  return currentFestival?.id === crew.festivalId ? currentFestival.name : null;
}

/** Profiles of the crew's members, one per user. Your own `myProfile` wins over the list copy. */
export function crewProfilesFor(
  allProfiles: Profile[],
  memberUserIds: Iterable<string>,
  myProfile: Profile | null,
): Profile[] {
  const ids = new Set(memberUserIds);
  const byUser = new Map<string, Profile>();
  for (const p of allProfiles) {
    if (ids.has(p.userId) && !byUser.has(p.userId)) byUser.set(p.userId, p);
  }
  if (myProfile && ids.has(myProfile.userId)) byUser.set(myProfile.userId, myProfile);
  return [...byUser.values()];
}

export function crewOwnerInfo(
  crew: Crew,
  members: CrewMember[],
  myUserId: string,
): { isOwner: boolean; ownerName: string | null } {
  const mine = members.find((m) => m.userId === myUserId);
  const owner = members.find((m) => m.role === 'owner') ?? members.find((m) => m.userId === crew.owner);
  return {
    isOwner: crew.owner === myUserId || mine?.role === 'owner',
    ownerName: owner?.name ?? owner?.username ?? null,
  };
}

export interface SlotGroup {
  set: FestivalSet;
  priority: Priority;
  names: string[];
  memberIds: string[];
}

/** One entry per set, in first-seen order, with the strongest priority among its pickers. */
export function groupSlotPicks(picks: SlotPick[]): SlotGroup[] {
  const groups = new Map<string, SlotGroup>();
  for (const p of picks) {
    const g = groups.get(p.set.id);
    if (!g) {
      groups.set(p.set.id, { set: p.set, priority: p.priority, names: [p.memberName], memberIds: [p.memberId] });
      continue;
    }
    g.names.push(p.memberName);
    g.memberIds.push(p.memberId);
    if (PRIORITY_WEIGHT[p.priority] > PRIORITY_WEIGHT[g.priority]) g.priority = p.priority;
  }
  return [...groups.values()];
}

/** Two names, then `+N`: `Ana, Ben +3`. */
export function memberSummary(names: string[]): string {
  const extra = names.length - 2;
  return extra > 0 ? `${names.slice(0, 2).join(', ')} +${extra}` : names.join(', ');
}

export interface CrewMixEntry {
  set: FestivalSet;
  count: number;
  total: number;
  topPriority: Priority;
  memberIds: string[];
}

/**
 * Sets that several crew members picked. Ranked by pickers, then summed priority
 * weight, then start time, then id. Pass `nowMs` to drop sets that already ended.
 */
export function buildCrewMix(i: {
  sets: FestivalSet[];
  days: FestivalDay[];
  profiles: Profile[];
  nowMs?: number;
  timeZone?: string;
  dayIndex?: number;
  minCount?: number;
  limit?: number;
}): CrewMixEntry[] {
  const { sets, days, profiles, nowMs, timeZone, dayIndex, minCount = 2, limit = 5 } = i;
  const entries: Array<CrewMixEntry & { weight: number }> = [];
  for (const set of sets) {
    if (dayIndex != null && set.dayIndex !== dayIndex) continue;
    if (nowMs != null) {
      const bounds = getSetTimeBounds(set, days, timeZone);
      if (bounds && bounds.endMs <= nowMs) continue;
    }
    let weight = 0;
    let top: Priority | null = null;
    const memberIds: string[] = [];
    for (const profile of profiles) {
      const priority = profile.picks?.[set.id] as Priority | undefined;
      if (!priority) continue;
      memberIds.push(profile.id);
      weight += PRIORITY_WEIGHT[priority];
      if (!top || PRIORITY_WEIGHT[priority] > PRIORITY_WEIGHT[top]) top = priority;
    }
    if (!top || memberIds.length < minCount) continue;
    entries.push({ set, count: memberIds.length, total: profiles.length, topPriority: top, memberIds, weight });
  }
  const start = (e: { set: FestivalSet }) => (e.set.startTime ? festivalStartMinutes(e.set.startTime) : Infinity);
  entries.sort(
    (a, b) =>
      b.count - a.count ||
      b.weight - a.weight ||
      start(a) - start(b) ||
      (a.set.id < b.set.id ? -1 : a.set.id > b.set.id ? 1 : 0),
  );
  return entries.slice(0, limit).map(({ weight: _weight, ...entry }) => entry);
}

export interface FreeSlot {
  startMs: number;
  endMs: number;
  minutes: number;
}

/**
 * Times on a day when none of the profiles has a pick, inside the span of that
 * day's lineup. With `nowMs`, gaps start no earlier than now.
 */
export function findFreeTogether(i: {
  sets: FestivalSet[];
  days: FestivalDay[];
  profiles: Profile[];
  dayIndex: number;
  nowMs?: number;
  timeZone?: string;
  minMinutes?: number;
  limit?: number;
}): FreeSlot[] {
  const { sets, days, profiles, dayIndex, nowMs, timeZone, minMinutes = 30, limit = 4 } = i;
  const picked = new Set<string>();
  for (const p of profiles) for (const id of Object.keys(p.picks || {})) picked.add(id);

  let windowStart = Infinity;
  let windowEnd = -Infinity;
  const busy: Array<[number, number]> = [];
  for (const set of sets) {
    if (set.dayIndex !== dayIndex) continue;
    const b = getSetTimeBounds(set, days, timeZone);
    if (!b) continue;
    windowStart = Math.min(windowStart, b.startMs);
    windowEnd = Math.max(windowEnd, b.endMs);
    if (picked.has(set.id)) busy.push([b.startMs, b.endMs]);
  }
  if (busy.length === 0) return [];

  busy.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of busy) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  const gaps: Array<[number, number]> = [];
  let cursor = windowStart;
  for (const [s, e] of merged) {
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (windowEnd > cursor) gaps.push([cursor, windowEnd]);

  const out: FreeSlot[] = [];
  for (const [gs, ge] of gaps) {
    const startMs = nowMs != null ? Math.max(gs, nowMs) : gs;
    const minutes = Math.round((ge - startMs) / 60000);
    if (minutes >= minMinutes) out.push({ startMs, endMs: ge, minutes });
  }
  return out.slice(0, limit);
}

/** `45 min`, `1 h`, `1 h 15 min`. */
export function formatGapLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const CREW_HUES = [35, 60, 95, 130, 220, 250, 280, 315];

/** Colours that differ by position. Hues avoid the aqua and coral bands, as `getAvatarColor` does. */
export function assignCrewColors(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  ids.forEach((id, idx) => {
    const lightness = idx < CREW_HUES.length ? 58 : 42;
    out[id] = `hsl(${CREW_HUES[idx % CREW_HUES.length]} 70% ${lightness}%)`;
  });
  return out;
}
