// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

//
// M3 "Re-engagement triggers" — after-festival growth loops.
//
// Event-gated push/email notifications:
//   • lineup_drop    — a recurring (same-named) festival publishes its lineup →
//                      notify users who attended a PRIOR edition of that festival
//                      and users who follow it.
//   • set_times_out  — an admin releases a festival date's set times ("Send set-times alert") →
//                      notify its followers and everyone with a profile in it, once per
//                      date (festival_time_releases holds the claim for each date).
//   • days_out       — an admin announces that acts have days ("Announce days") → notify followers
//                      and profile holders, once per user per festival.
//   • crew_reformed  — a prior crew is reformed for a new festival → notify the
//                      INVITED prior members (handed in by the reform route).
//   • wrap_ready     — a festival is over → notify its attendees that the recap
//                      is ready (`sendWrapReady(festivalId)`).
//   • rate_prompt    — the morning after a festival day (10:00-20:00 festival
//                      time) → push people who picked that day's sets and left
//                      some unrated (`sendRatePrompt(festivalId)`). Push only.
//
// HARD RULES (enforced here + in send.ts):
//   - strictly event-gated (called from real events, never a cron sweep);
//   - per-type opt-out (PREF_MAP → notification_preferences columns) gates push
//     (checked in send.ts) and email (checked in emailFanout);
//   - DND-respecting (isInDndWindow, checked in send.ts);
//   - deduped once-per-event-per-user via notification_log.existsForEvent on a
//     stable `eventKey` we stash in the notification data (data_json.eventKey).
//
// FAN-OUT: all four triggers push to EVERY eligible (deduped, pref/DND-passing)
// recipient via `pushFanout` — bounded-concurrency chunks (25 at a time) so a
// large prior-year/attendee fan-out neither drops the tail nor stampedes the
// push provider. Email is best-effort and degrades when RESEND_API_KEY is unset.

import crypto from 'crypto';
import {
  sendWrapReadyEmail,
  sendLineupDropEmail,
  sendDaysOutEmail,
  sendCrewReformEmail,
  sendSetTimesOutEmail,
} from '../email.js';
import { actsDayCoverage } from '../lineup.js';
import { PREF_MAP } from './send.js';
import { FESTIVAL_DAY_START_HOUR, zonedWallTimeToMs } from '../time-zone.js';
import { appLink, appOrigin } from './links.js';
import { MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from './payload.js';

/**
 * Backend mirror of `@festie/shared` `isFestivalOver`: true once the festival's
 * last night has ended, at 06:00 the morning after the last day. Kept inline
 * rather than importing shared runtime code across the package boundary (the backend runs via tsx and shared ships
 * ESM with .js specifiers). `days` is the festival's day array ([{date}], from
 * festivals.getById).
 *
 * The cutoff is anchored in the festival's IANA `timeZone` (the same
 * `zonedWallTimeToMs` the reminder scheduler uses) so "over" reflects the
 * festival's actual local 06:00, not the server's zone. When `timeZone` is
 * null/absent — or invalid — it falls back to UTC (NOT server-local), so the
 * cutoff is deterministic across deployments.
 */
export function isFestivalOver(days: Array<{ date?: string | null }> | null | undefined, timeZone?: string | null): boolean {
  const arr = days || [];
  if (!arr.length) return false;
  const last = arr[arr.length - 1];
  if (!last?.date) return false;
  const parts = String(last.date).split('-');
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) return false;
  let cutoffMs: number;
  if (timeZone) {
    cutoffMs = zonedWallTimeToMs(y, mo, d + 1, FESTIVAL_DAY_START_HOUR, 0, timeZone);
    if (Number.isNaN(cutoffMs)) {
      // Invalid zone → fall back to UTC.
      cutoffMs = Date.UTC(y, mo - 1, d + 1, FESTIVAL_DAY_START_HOUR, 0, 0);
    }
  } else {
    // No festival zone → UTC (deterministic, not server-local).
    cutoffMs = Date.UTC(y, mo - 1, d + 1, FESTIVAL_DAY_START_HOUR, 0, 0);
  }
  return cutoffMs < Date.now();
}

/** Re-engagement emails a day across all types: the mail provider's free plan allows 100, and the rest is kept for account mail. */
export const EMAIL_DAILY_BUDGET = 90;

/** Morning window (festival-local hours) in which the rate prompt for the previous day may fire. */
const RATE_PROMPT_START_HOUR = 10;
const RATE_PROMPT_END_HOUR = 20;

/**
 * Index of the festival day whose rate-prompt window holds `nowMs`: 10:00 to
 * 20:00, festival time, on the calendar date after that day. A null or invalid
 * zone falls back to UTC, like `isFestivalOver`. Returns -1 when no day is due.
 */
export function findRatePromptDay(
  days: Array<{ date?: string | null }> | null | undefined,
  timeZone: string | null | undefined,
  nowMs: number,
): number {
  const at = (y: number, mo: number, d: number, h: number) => {
    const ms = timeZone ? zonedWallTimeToMs(y, mo, d, h, 0, timeZone) : NaN;
    return Number.isNaN(ms) ? Date.UTC(y, mo - 1, d, h, 0, 0) : ms;
  };
  const arr = days || [];
  for (let i = 0; i < arr.length; i++) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(arr[i]?.date || ''));
    if (!m) continue;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    // d + 1 rolls over month/year ends inside Date.UTC.
    if (at(y, mo, d + 1, RATE_PROMPT_START_HOUR) <= nowMs && nowMs < at(y, mo, d + 1, RATE_PROMPT_END_HOUR)) return i;
  }
  return -1;
}

/** "Friday", "Friday and Saturday", "Fri, Sat and Sun". */
function joinDayLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

const TIME_RELEASE_BODY = 'See who plays when and build your plan.';

/**
 * Push title and body of a per-date set-times alert. The title names the days; when that would pass
 * MAX_TITLE_LENGTH it falls back to "<Festival> set times are out" and the body names them. The
 * admin's note replaces the fixed body. The preview in the release panel calls this too.
 */
export function timeReleaseCopy(
  festivalName: string,
  dayLabels: string[],
  note?: string | null,
): { title: string; body: string } {
  const name = festivalName || 'Your festival';
  const days = joinDayLabels(dayLabels);
  const dayTitle = `${name}: ${days} set times are out`;
  const body = note?.trim() || TIME_RELEASE_BODY;
  if (!days || dayTitle.length <= MAX_TITLE_LENGTH) return { title: dayTitle, body };
  return {
    title: `${name} set times are out`.slice(0, MAX_TITLE_LENGTH),
    body: `${days}. ${body}`.slice(0, MAX_BODY_LENGTH),
  };
}

/**
 * Build the re-engagement trigger surface.
 *
 * @param deps.stores  DB stores (profiles, users, notificationLog, pool, ...)
 * @param deps.config  App config (PUBLIC_ORIGIN, RESEND_API_KEY, ...)
 * @param deps.log     Logger
 * @param deps.notificationService  The push service ({ send, sendToOfflineUsers, isConfigured })
 * @param deps.pool    Optional pg Pool override (defaults to stores.pool) — handy for tests.
 */
export function createReengagementTriggers({ stores, config, log, notificationService, pool }: any) {
  const db = pool || stores?.pool;
  const notify = notificationService || {};

  /** Fetch {id, email, username} for a set of user ids that still have an email. */
  async function loadUsers(userIds: string[]): Promise<Map<string, any>> {
    if (!userIds.length || !stores?.users?.getByIds) return new Map();
    try {
      return await stores.users.getByIds(userIds);
    } catch (err: any) {
      log?.warn?.('reengagement: loadUsers failed', { error: err?.message });
      return new Map();
    }
  }

  /**
   * Batch dedup: return ONLY the user ids that have NOT already seen this event,
   * using a single existsForEvents query (no N+1). Intentionally does NOT
   * fail-open — if the dedup read throws it PROPAGATES so the BullMQ worker marks
   * the job failed and retries later (safe: retries are idempotent), rather than
   * re-blasting every recipient on a transient DB blip. Falls back to "all
   * fresh" only when the store doesn't expose existsForEvents at all.
   */
  async function filterFresh(userIds: string[], type: string, eventKey: string): Promise<string[]> {
    if (!userIds.length) return [];
    if (!stores?.notificationLog?.existsForEvents) return [...userIds];
    const seen: Set<string> = await stores.notificationLog.existsForEvents(userIds, type, eventKey);
    return userIds.filter((uid) => !seen.has(uid));
  }

  // ── wrap_ready ──────────────────────────────────────────────────────────
  //
  // Fires when a festival is over. Reuses the SAME isFestivalOver logic that
  // gates wrap.tsx. Idempotent: deduped per user on eventKey `wrap:<festivalId>`.
  // The push goes through sendToOfflineUsers (capped + pref/DND-filtered); email
  // is best-effort to attendees with an address.
  async function sendWrapReady(festivalId: string) {
    if (!festivalId) return { sent: 0, reason: 'no_festival' };

    // Load the festival + its days to gate on isFestivalOver (same as wrap.tsx).
    let festival: any = null;
    try {
      festival = await stores?.festivals?.getById?.(festivalId);
    } catch (err: any) {
      log?.warn?.('sendWrapReady: festival load failed', { festivalId, error: err?.message });
    }
    if (!festival) return { sent: 0, reason: 'festival_not_found' };
    if (!isFestivalOver(festival.days, festival.timeZone)) {
      log?.debug?.('sendWrapReady: festival not over yet — skipping', { festivalId });
      return { sent: 0, reason: 'not_over' };
    }

    const festivalName = festival.name || 'your festival';
    const eventKey = `wrap:${festivalId}`;

    // Attendees of THIS festival.
    let attendeeIds: string[] = [];
    try {
      attendeeIds = (await stores?.profiles?.userIdsByFestival?.(festivalId)) || [];
    } catch (err: any) {
      log?.warn?.('sendWrapReady: attendee lookup failed', { festivalId, error: err?.message });
    }

    // Push (deduped per user). sendToOfflineUsers itself enforces pref+DND+cap.
    // ONE batch dedup query pre-filters already-notified users so a re-run never
    // re-pushes; a dedup read failure propagates (no fail-open re-blast).
    const fresh = await filterFresh(attendeeIds, 'wrap_ready', eventKey);

    // Push to ALL fresh attendees in bounded chunks (no MAX_PUSH_BATCH drop).
    const deepLink = `${appOrigin(config)}/wrap?festival=${encodeURIComponent(festivalId)}`;
    const pushSent = await pushFanout(fresh, () => ({
      type: 'wrap_ready',
      title: `${festivalName}: your wrap is ready`,
      body: 'Relive your top sets and crew superlatives.',
      data: { festivalId, eventKey, deepLink },
    }));

    // Email (best-effort; degrades when RESEND_API_KEY unset). Gets the full list, not
    // `fresh`: its own '#email' dedup must decide, so a failed email retries after push logged.
    const emailSent = await emailFanout(attendeeIds, 'wrap_ready', eventKey, async (user) =>
      sendWrapReadyEmail({
        to: user.email,
        username: user.username,
        festivalName,
        festivalId,
        config,
        log,
      }),
    );

    log?.info?.('sendWrapReady: done', { festivalId, attendees: attendeeIds.length, pushSent, emailSent });
    return { sent: pushSent, emailSent, eventKey };
  }

  // ── rate_prompt ─────────────────────────────────────────────────────────
  //
  // Fires from the hourly leader-only sweep (lib/shutdown.ts). On the morning
  // after a festival day, pushes each person who picked sets on that day and has
  // not rated all of them. Deduped per user on eventKey `rate:<festivalId>:<day>`,
  // so the hourly sweep sends once per day. Push only, gated by the wrapReady pref.
  async function sendRatePrompt(festivalId: string, nowMs = Date.now()) {
    if (!festivalId) return { sent: 0, reason: 'no_festival' };

    let festival: any = null;
    try {
      festival = await stores?.festivals?.getById?.(festivalId);
    } catch (err: any) {
      log?.warn?.('sendRatePrompt: festival load failed', { festivalId, error: err?.message });
    }
    if (!festival) return { sent: 0, reason: 'festival_not_found' };

    const dayIndex = findRatePromptDay(festival.days, festival.timeZone, nowMs);
    if (dayIndex < 0) return { sent: 0, reason: 'not_due' };
    if (!db) return { sent: 0, reason: 'no_db' };

    let unratedByUser: Map<string, number>;
    try {
      const { rows } = await db.query(
        `
        SELECT p.user_id AS "userId", COUNT(*)::int AS "unrated"
        FROM festival_profiles p
        JOIN festival_profile_picks pp ON pp.profile_id = p.id
        JOIN festival_sets s ON s.id = pp.set_id AND s.festival_id = $1 AND s.day_index = $2
        WHERE p.festival_id = $1 AND p.deleted_at IS NULL AND p.user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM set_ratings r WHERE r.user_id = p.user_id AND r.set_id = s.id)
        GROUP BY p.user_id
        `,
        [festivalId, dayIndex],
      );
      unratedByUser = new Map(rows.filter((r: any) => r.userId && r.unrated > 0).map((r: any) => [r.userId, r.unrated]));
    } catch (err: any) {
      log?.warn?.('sendRatePrompt: recipient query failed', { festivalId, dayIndex, error: err?.message });
      return { sent: 0, reason: 'query_failed' };
    }

    const eventKey = `rate:${festivalId}:${dayIndex}`;
    const fresh = await filterFresh([...unratedByUser.keys()], 'rate_prompt', eventKey);

    const festivalName = festival.name || 'your festival';
    const dayLabel = festival.days[dayIndex]?.label || `Day ${dayIndex + 1}`;
    const title = `How was ${dayLabel} at ${festivalName}?`.slice(0, MAX_TITLE_LENGTH);
    const deepLink = `${appOrigin(config)}/rate?festival=${encodeURIComponent(festivalId)}`;
    const sent = await pushFanout(fresh, (uid) => ({
      type: 'rate_prompt',
      title,
      body: `Rate the ${unratedByUser.get(uid)} sets you picked while you still remember them.`,
      data: { festivalId, eventKey, deepLink },
    }));

    log?.info?.('sendRatePrompt: done', { festivalId, dayIndex, recipients: unratedByUser.size, sent });
    return { sent, eventKey, dayIndex };
  }

  // ── lineup_drop ─────────────────────────────────────────────────────────
  //
  // Fires from the admin "Announce lineup" action (routes/lineup-announce.ts). Two audiences:
  // followers of the festival who have not joined it, and PRIOR-year attendees of the SAME-NAMED
  // recurring festival (the inverse of getAttendedFestivals: users who attended an earlier edition
  // but NOT the new one). Both get the push and the inbox row. Only followers get the email,
  // because a name match can hit the wrong series. Deduped per user on eventKey `lineup:<festivalId>`.
  async function resolveLineupDropRecipients(festivalId: string): Promise<
    | {
        festivalName: string;
        hasTimes: boolean;
        followerIds: string[];
        priorEditionIds: string[];
        matchedFestivalNames: string[];
        fresh: string[];
      }
    | { reason: string }
  > {
    if (!festivalId || !db) return { reason: 'no_festival' };

    // Resolve the new festival's name, and whether any set has a time (the copy depends on it).
    let festivalName = '';
    let hasTimes = false;
    try {
      const { rows } = await db.query(
        `
  SELECT
    name,
    EXISTS (
      SELECT
        1
      FROM
        festival_sets
      WHERE
        festival_id = $1
        AND start_time IS NOT NULL
        AND start_time <> ''
    ) AS "hasTimes"
  FROM
    festivals
  WHERE
    id = $1
    AND deleted_at IS NULL
`,
        [festivalId],
      );
      festivalName = rows[0]?.name || '';
      hasTimes = !!rows[0]?.hasTimes;
    } catch (err: any) {
      log?.warn?.('sendLineupDrop: name lookup failed', { festivalId, error: err?.message });
    }
    if (!festivalName) return { reason: 'festival_not_found' };

    let followerIds: string[];
    let priorRows: Array<{ userId: string; festivalName: string }>;
    try {
      // Followers of THIS festival who have not joined it. Excludes deleted users.
      const followers = await db.query(
        `
        SELECT ff.user_id AS "userId"
        FROM festival_follows ff
        JOIN users u ON u.id = ff.user_id AND u.deleted_at IS NULL
        WHERE ff.festival_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM festival_profiles cur
            WHERE cur.user_id = ff.user_id AND cur.festival_id = $1 AND cur.deleted_at IS NULL
          )
        `,
        [festivalId],
      );
      followerIds = followers.rows.map((r: any) => r.userId).filter(Boolean);

      // Prior-edition attendees: users with a profile in an EARLIER festival whose name matches once a
      // trailing year is ignored, who do NOT already have a profile in THIS one. A separate statement,
      // so an organizer filter is one more AND here. Excludes deleted.
      // shortcut: name-minus-year match, replace with a festivals.series_id when editions need explicit links
      const prior = await db.query(
        `
        SELECT DISTINCT p.user_id AS "userId", fp.name AS "festivalName"
        FROM festival_profiles p
        JOIN festivals fp ON fp.id = p.festival_id AND fp.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
          AND p.user_id IS NOT NULL
          AND fp.id <> $1
          AND regexp_replace(lower(fp.name), '\\s*(19|20)\\d{2}\\s*$', '')
            = regexp_replace((SELECT lower(name) FROM festivals WHERE id = $1), '\\s*(19|20)\\d{2}\\s*$', '')
          AND NOT EXISTS (
            SELECT 1 FROM festival_profiles cur
            WHERE cur.user_id = p.user_id AND cur.festival_id = $1 AND cur.deleted_at IS NULL
          )
        `,
        [festivalId],
      );
      priorRows = prior.rows.filter((r: any) => r.userId);
    } catch (err: any) {
      log?.warn?.('sendLineupDrop: recipient query failed', { festivalId, error: err?.message });
      return { reason: 'query_failed' };
    }
    // A follower who also attended before is a follower: they get the email, so they leave the prior list.
    const followerSet = new Set(followerIds);
    const priorOnly = priorRows.filter((r) => !followerSet.has(r.userId));
    const priorEditionIds = [...new Set(priorOnly.map((r) => r.userId))];
    const matchedFestivalNames = [...new Set(priorOnly.map((r) => r.festivalName))].sort();
    const everyone = [...followerIds, ...priorEditionIds];
    const fresh = everyone.length ? await filterFresh(everyone, 'lineup_drop', `lineup:${festivalId}`) : [];
    return { festivalName, hasTimes, followerIds, priorEditionIds, matchedFestivalNames, fresh };
  }

  /** Dry run for the admin "Announce lineup" button: who would be notified, and how many get no email. */
  async function countLineupDrop(festivalId: string) {
    const r = await resolveLineupDropRecipients(festivalId);
    if ('reason' in r) {
      return {
        festivalName: '',
        recipients: 0,
        followers: 0,
        priorAttendees: 0,
        matchedFestivalNames: [] as string[],
        emailRecipients: 0,
        emailCut: 0,
        emailOff: null as string | null,
        reason: r.reason,
      };
    }
    // recipients counts push-fresh users; the email goes to followers only.
    return {
      festivalName: r.festivalName,
      recipients: r.fresh.length,
      followers: r.followerIds.length,
      priorAttendees: r.priorEditionIds.length,
      matchedFestivalNames: r.matchedFestivalNames,
      ...(await planAlertEmail(r.followerIds, 'lineup_drop', `lineup:${festivalId}`)),
    };
  }

  async function sendLineupDrop(festivalId: string) {
    const r = await resolveLineupDropRecipients(festivalId);
    if ('reason' in r) return { sent: 0, reason: r.reason };
    const { festivalName, hasTimes, followerIds, priorEditionIds, fresh } = r;
    if (followerIds.length + priorEditionIds.length === 0) return { sent: 0, reason: 'no_recipients' };
    const eventKey = `lineup:${festivalId}`;

    // Neither list has joined the new festival, so we push per-user (each respects pref + DND) over
    // ALL of them in bounded chunks instead of dropping the tail past MAX_PUSH_BATCH.
    const deepLink = appLink(config, '/?festival=' + encodeURIComponent(festivalId));
    const pushSent = await pushFanout(fresh, () => ({
      type: 'lineup_drop',
      title: hasTimes ? `${festivalName} lineup just dropped` : `${festivalName} lineup is out`,
      body: hasTimes ? 'Start picking your sets.' : "See who is playing. We'll tell you when set times are out.",
      data: { festivalId, eventKey, deepLink },
    }));

    const emailSent = await alertEmailFanout(followerIds, 'lineup_drop', eventKey, async (user) =>
      sendLineupDropEmail({ to: user.email, username: user.username, festivalName, festivalId, hasTimes, config, log }),
    );

    log?.info?.('sendLineupDrop: done', { festivalId, followers: followerIds.length, priorEdition: priorEditionIds.length, pushSent, emailSent });
    return { sent: pushSent, emailSent, eventKey, recipients: followerIds.length + priorEditionIds.length };
  }

  // ── days_out ────────────────────────────────────────────────────────────
  //
  // Fires only from the admin "Announce days" action (routes/lineup-announce.ts). No save, import or
  // publish sends it, so act 1 of 118 getting a day alerts nobody. Followers and profile holders hear
  // once per festival, deduped per user on eventKey `days:<festivalId>`. A second press reaches only
  // people who joined since, or whose email the daily budget cut.

  /**
   * Followers plus profile holders of a festival, one id each: the audience of every alert that
   * goes to "everyone who is in or following". "Announce days" and the per-date set-times release
   * both use it.
   */
  async function resolveFollowersAndProfileHolders(festivalId: string): Promise<string[]> {
    if (!festivalId || !db) return [];
    const { rows } = await db.query(
      `
  SELECT
    f.user_id AS "userId"
  FROM
    festival_follows f
    JOIN users u ON u.id = f.user_id
    AND u.deleted_at IS NULL
  WHERE
    f.festival_id = $1
  UNION
  SELECT
    p.user_id
  FROM
    festival_profiles p
    JOIN users u ON u.id = p.user_id
    AND u.deleted_at IS NULL
  WHERE
    p.festival_id = $1
    AND p.deleted_at IS NULL
    AND p.user_id IS NOT NULL
`,
      [festivalId],
    );
    return rows.map((r: any) => r.userId).filter(Boolean);
  }

  /** True once any date's set times were released (festivals.set_times_out_at, written on the first release). */
  async function setTimesAlreadyOut(festivalId: string): Promise<boolean> {
    const { rows } = await db.query('SELECT set_times_out_at IS NOT NULL AS "out" FROM festivals WHERE id = $1', [
      festivalId,
    ]);
    return rows[0]?.out === true;
  }

  async function resolveDaysOut(festivalId: string) {
    const refused = (reason: string, extra: object = {}) => ({
      festivalName: '',
      actsWithDay: 0,
      actsTotal: 0,
      userIds: [] as string[],
      fresh: [] as string[],
      reason,
      ...extra,
    });
    if (!festivalId || !db) return refused('no_festival');

    let festival: any = null;
    try {
      festival = await stores?.festivals?.getById?.(festivalId);
    } catch (err: any) {
      log?.warn?.('sendDaysOut: festival load failed', { festivalId, error: err?.message });
    }
    if (!festival) return refused('festival_not_found');

    const coverage = actsDayCoverage(festival);
    const named = { festivalName: festival.name || '', ...coverage };
    if (!festival.publishedAt) return refused('draft', named);
    if (await setTimesAlreadyOut(festivalId)) return refused('set_times_out', named);
    if (coverage.actsWithDay === 0) return refused('no_days', named);

    const userIds = await resolveFollowersAndProfileHolders(festivalId);
    if (userIds.length === 0) return refused('no_audience', named);
    const fresh = await filterFresh(userIds, 'days_out', `days:${festivalId}`);
    return { ...named, userIds, fresh, reason: undefined as string | undefined };
  }

  /** Dry run for the admin "Announce days" button. `reason` names why a send would be refused. */
  async function countDaysOut(festivalId: string) {
    const { userIds, fresh, reason, ...rest } = await resolveDaysOut(festivalId);
    const email = reason ? { emailRecipients: 0, emailCut: 0, emailOff: null } : await planAlertEmail(userIds, 'days_out', `days:${festivalId}`);
    const heard = !reason && fresh.length === 0 && email.emailRecipients + email.emailCut === 0;
    return {
      ...rest,
      recipients: fresh.length,
      audience: userIds.length,
      ...email,
      ...(reason || heard ? { reason: reason ?? 'already_heard' } : {}),
    };
  }

  async function sendDaysOut(festivalId: string) {
    const { userIds, fresh, reason, festivalName } = await resolveDaysOut(festivalId);
    if (reason) return { sent: 0, reason };
    const eventKey = `days:${festivalId}`;

    const deepLink = appLink(config, '/?festival=' + encodeURIComponent(festivalId));
    const pushSent = await pushFanout(fresh, () => ({
      type: 'days_out',
      title: `${festivalName || 'Your festival'} days are out`,
      body: 'See who plays which day. Set times come later.',
      data: { festivalId, eventKey, deepLink },
    }));
    const emailSent = await alertEmailFanout(userIds, 'days_out', eventKey, async (user) =>
      sendDaysOutEmail({ to: user.email, username: user.username, festivalName, festivalId, config, log }),
    );

    log?.info?.('sendDaysOut: done', { festivalId, recipients: userIds.length, pushSent, emailSent });
    return { sent: pushSent, emailSent, eventKey, recipients: userIds.length };
  }

  // ── set_times_out ───────────────────────────────────────────────────────
  //
  // Fires only from the admin release panel (routes/time-releases.ts), once per festival date. No save,
  // import or publish sends it. The route claims each date in festival_time_releases first, then
  // enqueues one job per event key; this reads the claimed rows for that key, sends, and stamps them.
  // It sends first and stamps after: a crash between the two is retried by the admin, the stuck row
  // keeps its event key, and the per-user dedup on that key stops repeat sends.
  async function sendTimeRelease(festivalId: string, eventKey: string) {
    if (!festivalId || !eventKey || !db) return { sent: 0, reason: 'no_festival' };

    const { rows: releases } = await db.query(
      'SELECT day_date AS "date", note FROM festival_time_releases WHERE festival_id = $1 AND event_key = $2 ORDER BY day_date',
      [festivalId, eventKey],
    );
    if (releases.length === 0) return { sent: 0, reason: 'no_release' };

    let festival: any = null;
    try {
      festival = await stores?.festivals?.getById?.(festivalId);
    } catch (err: any) {
      log?.warn?.('sendTimeRelease: festival load failed', { festivalId, error: err?.message });
    }
    if (!festival) return { sent: 0, reason: 'festival_not_found' };
    if (!festival.publishedAt) return { sent: 0, reason: 'draft' };

    // The days and the note come from the claimed rows of this key, never from the request that made them.
    const labelOf = (date: string) => (festival.days || []).find((d: any) => d.date === date)?.label || date;
    const dayLabels: string[] = releases.map((r: any) => labelOf(r.date));
    const note: string | null = releases[0].note ?? null;
    const festivalName = festival.name || 'Your festival';
    const { title, body } = timeReleaseCopy(festivalName, dayLabels, note);

    const userIds = await resolveFollowersAndProfileHolders(festivalId);
    const fresh = await filterFresh(userIds, 'set_times_out', eventKey);
    const deepLink = appLink(config, '/?festival=' + encodeURIComponent(festivalId));
    const pushSent = await pushFanout(fresh, () => ({
      type: 'set_times_out',
      title,
      body,
      data: { festivalId, eventKey, deepLink },
    }));
    // No postal address, no email (CAN-SPAM). The push and the inbox row do not depend on it.
    const emailSent = hasPostalAddress()
      ? await emailFanout(userIds, 'set_times_out', eventKey, async (user) =>
          sendSetTimesOutEmail({
            to: user.email,
            username: user.username,
            festivalName,
            festivalId,
            dayLabels,
            note,
            config,
            log,
          }),
        )
      : 0;

    // People this release reached by inbox, push or email, retries included.
    const { rows: reached } = await db.query(
      `SELECT COUNT(DISTINCT user_id)::int AS "reached" FROM notification_log
       WHERE type = 'set_times_out' AND status <> 'failed' AND data_json->>'eventKey' = ANY($1::text[])`,
      [[eventKey, `${eventKey}#email`]],
    );
    const recipients: number = reached[0]?.reached ?? 0;
    await db.query(
      'UPDATE festival_time_releases SET sent_at = NOW(), recipients = $3 WHERE festival_id = $1 AND event_key = $2 AND sent_at IS NULL',
      [festivalId, eventKey, recipients],
    );
    // The first release also writes the marker that "Announce days" and older builds still read.
    await db.query('UPDATE festivals SET set_times_out_at = NOW() WHERE id = $1 AND set_times_out_at IS NULL', [festivalId]);

    log?.info?.('sendTimeRelease: done', {
      festivalId,
      eventKey,
      days: releases.length,
      audience: userIds.length,
      recipients,
      pushSent,
      emailSent,
    });
    return { sent: pushSent, emailSent, eventKey, recipients };
  }

  // ── crew_reformed ─────────────────────────────────────────────────────────
  //
  // Fires from the reform route. The route already computed the INVITED prior
  // members (who lack a target-festival profile). Notify exactly those users.
  // Deduped per user on eventKey `reform:<newCrewId>`.
  async function sendCrewReformed({ newCrewId, crewName, festivalName, invitedUserIds, inviteUrl }: any) {
    const invited = (invitedUserIds || []).filter(Boolean);
    if (!newCrewId || invited.length === 0) return { sent: 0, reason: 'no_invitees' };

    const eventKey = `reform:${newCrewId}`;
    const fresh = await filterFresh(invited, 'crew_reformed', eventKey);

    const reformDeepLink = inviteUrl || appLink(config, '/crew');
    const pushSent = await pushFanout(fresh, () => ({
      type: 'crew_reformed',
      title: `${crewName || 'Your crew'} reformed`,
      body: festivalName ? `Back together for ${festivalName}. Jump in.` : 'Back together. Jump in.',
      data: { crewId: newCrewId, eventKey, deepLink: reformDeepLink },
    }));

    const emailSent = await emailFanout(invited, 'crew_reformed', eventKey, async (user) =>
      sendCrewReformEmail({
        to: user.email,
        username: user.username,
        crewName,
        festivalName,
        crewId: newCrewId,
        inviteUrl,
        config,
        log,
      }),
    );

    log?.info?.('sendCrewReformed: done', { newCrewId, invited: invited.length, pushSent, emailSent });
    return { sent: pushSent, emailSent, eventKey };
  }

  // ── shared helpers ────────────────────────────────────────────────────────

  /**
   * Push to EVERY user in `userIds` via per-user `notify.send` (each respects
   * pref + DND), in bounded-concurrency chunks so a large fan-out neither drops
   * the tail (the old MAX_PUSH_BATCH cap) nor stampedes the push provider.
   * Returns the total number of pushes delivered.
   */
  async function pushFanout(userIds: string[], buildPayload: (uid: string) => any): Promise<number> {
    if (!userIds.length || !notify.isConfigured || typeof notify.send !== 'function') return 0;
    const CHUNK = 25;
    let sent = 0;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const batch = userIds.slice(i, i + CHUNK);
      const results = await Promise.all(
        batch.map(async (uid) => {
          try {
            const r = await notify.send({ userId: uid, ...buildPayload(uid) });
            return r?.sent || 0;
          } catch (err: any) {
            log?.debug?.('pushFanout: send failed', { userId: uid, error: err?.message });
            return 0;
          }
        }),
      );
      sent += results.reduce((a: number, b: number) => a + b, 0);
    }
    return sent;
  }

  /**
   * Who an email would go to, in send order: the users that have not had this event's email, still
   * have an address and have the type's switch on. Quiet hours do not apply to email.
   * `noPushFirst` puts people with no push token first, because the email is their only way to hear.
   */
  async function emailPlan(userIds: string[], type: string, eventKey: string, { noPushFirst = false } = {}) {
    if (!userIds.length) return { ids: [] as string[], users: new Map<string, any>() };
    const users = await loadUsers(userIds);
    // Email dedup shares the eventKey but uses a distinct type suffix so a push
    // log row does not suppress the email (and vice-versa). ONE batch dedup
    // query for the whole fan-out (no N+1); a read failure propagates rather
    // than fail-open re-blasting every address.
    const fresh = await filterFresh(userIds, type, `${eventKey}#email`);
    const prefKey = PREF_MAP[type];
    let ids: string[] = [];
    const withEmail = fresh.filter((uid) => users.get(uid)?.email);
    // One batched read (the admin dry runs call this per panel load); a store without getMany reads per user.
    let prefsByUser = new Map<string, any>();
    if (stores?.notificationPrefs?.getMany) prefsByUser = await stores.notificationPrefs.getMany(withEmail);
    else for (const uid of withEmail) prefsByUser.set(uid, await stores?.notificationPrefs?.get?.(uid));
    for (const uid of withEmail) {
      // Per-type opt-out gates email as well as push.
      const prefs = prefsByUser.get(uid);
      if (prefs && prefKey && !prefs[prefKey]) continue; // store returns 0/1, same falsy check as send.ts
      ids.push(uid);
    }
    if (noPushFirst && ids.length && stores?.deviceTokens?.listByUsers) {
      const withPush = new Set<string>((await stores.deviceTokens.listByUsers(ids)).map((d: any) => d.userId));
      ids = [...ids.filter((uid) => !withPush.has(uid)), ...ids.filter((uid) => withPush.has(uid))];
    }
    return { ids, users };
  }

  /**
   * Send the per-type email to each user that has an address, deduping per user
   * on the same eventKey as the push (so a user opted out of push but kept email,
   * or vice-versa, still gets exactly one of each per event). Best-effort: a
   * failed send (incl. RESEND_API_KEY unset) is logged and counted as not-sent.
   * `limit` stops after that many sent; the rest stay un-emailed and a later run picks them up.
   * `budgetLeft` is re-read before each send, so two jobs running at once share the budget.
   */
  async function emailFanout(
    userIds: string[],
    type: string,
    eventKey: string,
    sendFn: (user: any) => Promise<boolean>,
    { limit = Infinity, noPushFirst = false, budgetLeft }: { limit?: number; noPushFirst?: boolean; budgetLeft?: () => Promise<number> } = {},
  ): Promise<number> {
    const { ids, users } = await emailPlan(userIds, type, eventKey, { noPushFirst });
    const emailEventKey = `${eventKey}#email`;
    let sent = 0;
    for (const uid of ids) {
      if (sent >= limit) break;
      if (budgetLeft && (await budgetLeft()) <= 0) break;
      const user = users.get(uid);
      let ok: boolean;
      try {
        ok = await sendFn(user);
      } catch (err: any) {
        log?.debug?.('reengagement: email send failed', { userId: uid, type, error: err?.message });
        continue;
      }
      if (!ok) continue;
      sent += 1;
      // Record an email-channel log row for dedup on re-runs. A failed insert
      // here means the NEXT run will re-send this email (no dedup row), so it
      // must be visible in prod — log at warn, not debug.
      try {
        await stores?.notificationLog?.insert?.({
          id: crypto.randomUUID(),
          userId: uid,
          type,
          title: `${type} email`,
          body: '',
          dataJson: JSON.stringify({ eventKey: emailEventKey, channel: 'email' }),
          status: 'sent',
          platform: 'email',
          errorMessage: null,
        });
      } catch (err: any) {
        log?.warn?.('reengagement: email dedup-row insert failed (may re-send on next run)', {
          userId: uid,
          eventKey: emailEventKey,
          type,
          error: err?.message,
        });
      }
    }
    return sent;
  }

  // ── announcement email rules (lineup, days) ───────────────────────────────
  //
  // These two alerts email without a postal address never (CAN-SPAM; the push and inbox row do not
  // depend on it) and at most EMAIL_DAILY_BUDGET emails a day across all re-engagement mail, because
  // the mail provider's plan caps a day. People the budget cuts stay un-emailed; the next press reaches them.
  // The fan-out re-reads the budget before every send, so concurrent jobs overshoot by a send or two, not a batch.
  // wrap_ready, crew_reformed and set_times_out are not capped: each goes to one festival's or crew's own
  // audience, and a cut there could not be retried (a date's release cannot be sent twice), so they only
  // count against the budget. A release still skips email while the postal address is unset.
  const hasPostalAddress = () => !!String(config?.EMAIL_POSTAL_ADDRESS ?? '').trim();

  async function emailBudgetLeft(): Promise<number> {
    const used = (await stores?.notificationLog?.countEmailsSince?.(24)) ?? 0;
    return Math.max(0, EMAIL_DAILY_BUDGET - used);
  }

  /** Dry run for the email part: how many would get it now, how many the budget cuts, and why it is off. */
  async function planAlertEmail(userIds: string[], type: string, eventKey: string) {
    if (!hasPostalAddress()) return { emailRecipients: 0, emailCut: 0, emailOff: 'no_postal_address' as string | null };
    const { ids } = await emailPlan(userIds, type, eventKey);
    const emailRecipients = Math.min(ids.length, await emailBudgetLeft());
    return { emailRecipients, emailCut: ids.length - emailRecipients, emailOff: null as string | null };
  }

  async function alertEmailFanout(
    userIds: string[],
    type: string,
    eventKey: string,
    sendFn: (user: any) => Promise<boolean>,
  ): Promise<number> {
    if (!hasPostalAddress()) return 0;
    return emailFanout(userIds, type, eventKey, sendFn, {
      limit: await emailBudgetLeft(),
      noPushFirst: true,
      budgetLeft: emailBudgetLeft,
    });
  }

  return {
    sendWrapReady,
    sendLineupDrop,
    countLineupDrop,
    sendDaysOut,
    countDaysOut,
    resolveFollowersAndProfileHolders,
    sendCrewReformed,
    sendRatePrompt,
    sendTimeRelease,
  };
}
