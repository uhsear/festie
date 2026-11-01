import type {
  Crew,
  CrewMeetingPoint,
  CrewMember,
  CrewMemberStatus,
  FestivalDay,
  FestivalSet,
  PeerLocation,
  Priority,
  SosEntry,
} from '../types/domain';
import {
  FESTIVAL_DAY_START_HOUR,
  createDateInLocalFrame,
  getSetTimeBounds,
  zoneOffsetMsAt,
  zonedWallTimeToMs,
} from './setStatus';
import { nextMeetingOccurrence } from './meetingTime';
import { isPeerStale } from './liveLocation';
import { timeAgo } from './timeAgo';

/**
 * Day-of selectors for the "Now" surface and the app-wide SOS banner. Pure and
 * platform-agnostic: `nowMs` is injected, and every set bound comes from
 * `getSetTimeBounds` (the one place that resolves dates, zones and the
 * past-midnight rollover).
 */

/** A set resolved to absolute bounds. `priority` is null in lineup (guest) mode. */
export interface DayOfSet {
  set: FestivalSet;
  start: number;
  end: number;
  priority: Priority | null;
}

/**
 * Where `now` sits in the festival:
 * - `none`: no usable days.
 * - `before`: earlier than the first festival day.
 * - `during`: inside a festival day (or a rest day between two).
 * - `after`: past the last festival day.
 */
export type DayOfPhase = 'none' | 'before' | 'during' | 'after';

export interface NowNextSelection {
  phase: DayOfPhase;
  /** Index of the logical festival day containing now, or null. */
  dayIndex: number | null;
  /** When the festival starts (earliest lineup set, else day 1). Set while `before`. */
  startsAt: number | null;
  /** False when `startsAt` is only a day boundary (no set time known), so surfaces show the weekday, not a clock. */
  startsAtTimed: boolean;
  /** Sets playing now, soonest-ending first. */
  current: DayOfSet[];
  /** Sets starting after now, soonest first, capped at `upcomingLimit`. */
  upcoming: DayOfSet[];
  /** How many source sets (picks, or the lineup) fall on the current logical day. */
  todayCount: number;
}

// A logical festival day runs 06:00 to 06:00 the next morning, because sets
// before 6 AM belong to the previous day (CONTEXT.md). Hour 30 of a date is
// 06:00 the next day: both converters normalize overflowing hours.
function wallMs(date: string, hours: number, timeZone?: string): number {
  return timeZone ? zonedWallTimeToMs(date, hours, 0, timeZone) : createDateInLocalFrame(date, hours, 0).getTime();
}

/** Index of the logical festival day that contains `nowMs`, or null. */
export function logicalDayIndexAt(days: ReadonlyArray<Pick<FestivalDay, 'date'>>, nowMs: number, timeZone?: string): number | null {
  for (let i = 0; i < days.length; i++) {
    const date = days[i]?.date;
    if (!date) continue;
    const start = wallMs(date, FESTIVAL_DAY_START_HOUR, timeZone);
    const end = wallMs(date, FESTIVAL_DAY_START_HOUR + 24, timeZone);
    if (nowMs >= start && nowMs < end) return i;
  }
  return null;
}

/**
 * Where "now" sits (0-100 %) inside the displayed festival day's time window,
 * or null when now is outside it. The window runs from `dayDate` 00:00 in the
 * festival's zone (device-local when `timeZone` is omitted) plus minMin..maxMin;
 * maxMin > 1440 covers sets that run past midnight into the next calendar day.
 * Date-aware, so a past or future festival never draws the line.
 */
export function nowPositionPercent(
  nowMs: number,
  dayDate: string | null | undefined,
  bounds: { minMin: number; maxMin: number },
  timeZone?: string,
): number | null {
  if (!dayDate || bounds.maxMin <= bounds.minMin) return null;
  const dayStartMs = timeZone
    ? zonedWallTimeToMs(dayDate, 0, 0, timeZone)
    : createDateInLocalFrame(dayDate, 0, 0).getTime();
  if (Number.isNaN(dayStartMs)) return null;
  const nowMin = (nowMs - dayStartMs) / 60_000;
  if (nowMin < bounds.minMin || nowMin > bounds.maxMin) return null;
  return ((nowMin - bounds.minMin) / (bounds.maxMin - bounds.minMin)) * 100;
}

export interface SelectNowNextInput {
  sets: FestivalSet[];
  days: ReadonlyArray<Pick<FestivalDay, 'date'>>;
  /** The user's picks. Omit (guest) to read NOW/NEXT from the whole lineup. */
  picks?: Record<string, Priority> | null;
  nowMs: number;
  timeZone?: string;
  upcomingLimit?: number;
}

/**
 * Split picked sets (or the lineup, for a guest) into NOW and UP NEXT, and
 * place `now` within the festival so the surface can choose its empty state.
 */
export function selectNowNext({
  sets,
  days,
  picks,
  nowMs,
  timeZone,
  upcomingLimit = 5,
}: SelectNowNextInput): NowNextSelection {
  const dated = days.filter((d) => d?.date);
  if (!dated.length) {
    return { phase: 'none', dayIndex: null, startsAt: null, startsAtTimed: false, current: [], upcoming: [], todayCount: 0 };
  }

  const lineup: DayOfSet[] = [];
  const source: DayOfSet[] = [];
  for (const set of sets) {
    const bounds = getSetTimeBounds(set, days, timeZone);
    if (!bounds) continue;
    const priority = picks ? (picks[set.id] ?? null) : null;
    const timed = { set, start: bounds.startMs, end: bounds.endMs, priority };
    lineup.push(timed);
    if (!picks || priority) source.push(timed);
  }

  const firstStart = wallMs(dated[0]!.date, FESTIVAL_DAY_START_HOUR, timeZone);
  const lastEnd = wallMs(dated[dated.length - 1]!.date, FESTIVAL_DAY_START_HOUR + 24, timeZone);
  // A late set can run past the 06:00 boundary; it is still "during".
  const lastSetEnd = lineup.reduce((max, s) => Math.max(max, s.end), lastEnd);
  const earliestSet = lineup.reduce((min, s) => Math.min(min, s.start), Infinity);
  const festivalStart = Math.min(firstStart, earliestSet);

  let phase: DayOfPhase = 'during';
  if (nowMs < festivalStart) phase = 'before';
  else if (nowMs >= lastSetEnd) phase = 'after';

  const dayIndex = phase === 'during' ? logicalDayIndexAt(days, nowMs, timeZone) : null;

  return {
    phase,
    dayIndex,
    startsAt:
      phase === 'before' ? (Number.isFinite(earliestSet) ? earliestSet : wallMs(dated[0]!.date, 0, timeZone)) : null,
    startsAtTimed: Number.isFinite(earliestSet),
    current: source.filter((s) => s.start <= nowMs && s.end > nowMs).sort((a, b) => a.end - b.end),
    upcoming: source
      .filter((s) => s.start > nowMs)
      .sort((a, b) => a.start - b.start)
      .slice(0, upcomingLimit),
    todayCount: dayIndex === null ? 0 : source.filter((s) => s.set.dayIndex === dayIndex).length,
  };
}

/** `8:00 PM` in the festival zone (the same form as `formatTime`), or device-local when no zone is known. */
export function fmtZonedClock(ms: number, timeZone?: string): string {
  // Newer ICU puts a narrow no-break space before AM/PM; formatTime uses a plain space.
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  })
    .format(new Date(ms))
    .replace(/\s/g, ' ');
}

/** Short weekday plus clock, e.g. `Sat 8:00 PM`, in the festival zone. */
export function fmtZonedDayClock(ms: number, timeZone?: string): string {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', ...(timeZone ? { timeZone } : {}) }).format(
    new Date(ms),
  );
  return `${weekday} ${fmtZonedClock(ms, timeZone)}`;
}

/** `Sat` in the festival zone, or device-local when no zone is known. */
export function fmtZonedWeekday(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', ...(timeZone ? { timeZone } : {}) }).format(new Date(ms));
}

/** Calendar days from `fromMs` to `targetMs` in the festival zone (device-local when no zone is known): 1 = tomorrow. */
export function zonedCalendarDayDiff(fromMs: number, targetMs: number, timeZone?: string): number {
  const dayNumber = (ms: number) => {
    const offset = timeZone ? zoneOffsetMsAt(ms, timeZone) : -new Date(ms).getTimezoneOffset() * 60_000;
    return Math.floor((ms + offset) / 86_400_000);
  };
  return dayNumber(targetMs) - dayNumber(fromMs);
}

/**
 * When a set starts, relative to now: `starting now`, `in 25m`, `in 3h 10m`,
 * then a weekday and clock (`Sat 20:00`) once it is 12 hours or more away.
 */
export function fmtStartsIn(startMs: number, nowMs: number, timeZone?: string): string {
  const mins = Math.floor((startMs - nowMs) / 60_000);
  if (mins < 1) return 'starting now';
  if (mins < 60) return `in ${mins}m`;
  if (mins < 12 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  return fmtZonedDayClock(startMs, timeZone);
}

/** Minutes left in a live set, as `12m left` or `1h 5m left`. */
export function fmtTimeLeft(endMs: number, nowMs: number): string {
  const mins = Math.max(0, Math.round((endMs - nowMs) / 60_000));
  if (mins < 60) return `${mins}m left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m left` : `${h}h left`;
}

// ── SOS ──────────────────────────────────────────────────────────────────────

/**
 * Active SOS entries for the open crew, newest first. A null crew id keeps
 * every entry, matching the store's own guard while it is unscoped.
 */
export function selectActiveSos(activeSosList: ReadonlyArray<SosEntry>, crewId: string | null | undefined): SosEntry[] {
  return activeSosList
    .filter((e) => !crewId || e.crewId === crewId)
    .sort((a, b) => new Date(b.raisedAt).getTime() - new Date(a.raisedAt).getTime());
}

/** Who raised the SOS, from the viewer's side. */
export function sosRaiserName(entry: SosEntry, selfUserId?: string | null): string {
  return entry.userId === selfUserId ? 'You' : entry.username || 'A crew member';
}

/**
 * Banner headline without a time, so it only changes when the set of SOS
 * entries changes: safe to announce through a live region.
 * `Dani needs help`, `You sent an SOS`, `Dani and 2 others need help`.
 */
export function sosHeadline(entries: ReadonlyArray<SosEntry>, selfUserId?: string | null): string {
  const first = entries[0];
  if (!first) return '';
  const name = sosRaiserName(first, selfUserId);
  if (entries.length === 1) return name === 'You' ? 'You sent an SOS' : `${name} needs help`;
  const others = entries.length - 1;
  return `${name} and ${others} other${others === 1 ? '' : 's'} need help`;
}

/** `SOS 4m ago`, from the newest entry. Reads Date.now() like `timeAgo`. */
export function sosWhen(entries: ReadonlyArray<SosEntry>): string {
  const ms = entries[0] ? new Date(entries[0].raisedAt).getTime() : NaN;
  return Number.isFinite(ms) ? `SOS ${timeAgo(ms)}` : 'SOS';
}

// ── Crew whereabouts ─────────────────────────────────────────────────────────

const STATUS_LABEL: Record<NonNullable<CrewMemberStatus['status']>, string> = {
  'on-my-way': 'On the way',
  here: 'Here',
  delayed: 'Running late',
};

export interface CrewWhereabout {
  userId: string;
  name: string;
  /** `Here · Main Stage`, `On the way · ~5 min`, or null with no status. */
  statusLabel: string | null;
  /** When the status last synced (epoch ms), or null. */
  statusAt: number | null;
  /** Live location: `live` (fresh fix), `stale` (aging fix), or null (not sharing). */
  live: 'live' | 'stale' | null;
  /** When the last live fix reached the server (epoch ms), or null. */
  liveAt: number | null;
  sos: boolean;
}

export interface SelectCrewWhereaboutsInput {
  members: ReadonlyArray<CrewMember>;
  statuses: ReadonlyArray<CrewMemberStatus>;
  peers: Readonly<Record<string, PeerLocation>>;
  sos: ReadonlyArray<SosEntry>;
  meetingPoints: ReadonlyArray<Pick<CrewMeetingPoint, 'id' | 'label'>>;
  selfUserId?: string | null;
  nowMs: number;
}

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * One row per other crew member: their last status, and live-location
 * freshness. SOS raisers sort first, then live sharers, then the most
 * recent status, then by name.
 */
export function selectCrewWhereabouts({
  members,
  statuses,
  peers,
  sos,
  meetingPoints,
  selfUserId,
  nowMs,
}: SelectCrewWhereaboutsInput): CrewWhereabout[] {
  const statusByUser = new Map(statuses.map((s) => [s.user_id, s]));
  const pointLabel = new Map(meetingPoints.map((p) => [p.id, p.label]));
  const sosUsers = new Set(sos.map((e) => e.userId));

  const rows = members
    .filter((m) => m.userId !== selfUserId)
    .map((m): CrewWhereabout => {
      const st = statusByUser.get(m.userId);
      const peer = peers[m.userId];
      let statusLabel: string | null = null;
      if (st?.status) {
        const target = st.target_meeting_point_id ? pointLabel.get(st.target_meeting_point_id) : undefined;
        const detail = target ?? (st.status === 'on-my-way' && st.eta_minutes != null ? `~${st.eta_minutes} min` : null);
        statusLabel = detail ? `${STATUS_LABEL[st.status]} · ${detail}` : STATUS_LABEL[st.status];
      }
      return {
        userId: m.userId,
        name: m.name || m.username || 'Crew member',
        statusLabel,
        statusAt: st?.status ? toMs(st.updated_at) : null,
        live: peer ? (isPeerStale(peer.serverAt, nowMs) ? 'stale' : 'live') : null,
        liveAt: peer ? toMs(peer.serverAt) : null,
        sos: sosUsers.has(m.userId),
      };
    });

  const rank = (r: CrewWhereabout) => (r.sos ? 0 : r.live === 'live' ? 1 : r.live === 'stale' ? 2 : r.statusLabel ? 3 : 4);
  return rows.sort(
    (a, b) => rank(a) - rank(b) || (b.statusAt ?? 0) - (a.statusAt ?? 0) || a.name.localeCompare(b.name),
  );
}

// ── Meeting point / Home Base ────────────────────────────────────────────────

export interface ActiveMeet {
  kind: 'meeting-point' | 'home-base';
  /** Meeting point id; null for Home Base. */
  id: string | null;
  label: string;
  /** Where, in words (meeting point `location`, or the Home Base text). */
  location: string | null;
  /** Next occurrence (epoch ms), or null when untimed. */
  atMs: number | null;
  /** Home Base time-of-day text as the owner wrote it, e.g. `23:30`. */
  timeText: string | null;
}

// A meeting time stays "the" meeting point for this long after it passes,
// so a crew arriving late still sees where they agreed to meet.
const MEET_GRACE_MS = 30 * 60_000;

export interface SelectActiveMeetInput {
  meetingPoints: ReadonlyArray<CrewMeetingPoint>;
  crew: Pick<Crew, 'homeBaseLocation' | 'homeBaseTime'> | null | undefined;
  days: ReadonlyArray<Pick<FestivalDay, 'date'>>;
  nowMs: number;
  timeZone?: string;
}

/**
 * The meeting point to show on the Now surface: the timed point whose next
 * occurrence is soonest (including one that passed under 30 minutes ago),
 * else the newest untimed active point, else the crew's Home Base.
 */
export function selectActiveMeet({ meetingPoints, crew, days, nowMs, timeZone }: SelectActiveMeetInput): ActiveMeet | null {
  const now = new Date(nowMs - MEET_GRACE_MS);
  let best: { mp: CrewMeetingPoint; at: number } | null = null;
  let untimed: CrewMeetingPoint | null = null;
  for (const mp of meetingPoints) {
    if (mp.active === false) continue;
    if (mp.expires_at && (toMs(mp.expires_at) ?? Infinity) <= nowMs) continue;
    if (!mp.meet_at) {
      if (!untimed || (toMs(mp.created_at) ?? 0) > (toMs(untimed.created_at) ?? 0)) untimed = mp;
      continue;
    }
    const next = nextMeetingOccurrence(mp.meet_at, mp.recurs_daily, days, now, timeZone);
    if (!next || next.ms < now.getTime()) continue;
    if (!best || next.ms < best.at) best = { mp, at: next.ms };
  }
  const pick = best?.mp ?? untimed;
  if (pick) {
    return {
      kind: 'meeting-point',
      id: pick.id,
      label: pick.label,
      location: pick.location || null,
      atMs: best ? best.at : null,
      timeText: null,
    };
  }
  if (crew?.homeBaseLocation) {
    return {
      kind: 'home-base',
      id: null,
      label: 'Home Base',
      location: crew.homeBaseLocation,
      atMs: null,
      timeText: crew.homeBaseTime || null,
    };
  }
  return null;
}
