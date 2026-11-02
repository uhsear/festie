// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import crypto from 'crypto';

import type { Request, Response } from 'express';
import type { z } from 'zod';

import { createPasswordResetRateLimit } from '../lib/rate-limiting';
import type { RouteDeps } from '../lib/types';
import type {
  displayNameChangeSchema,
  publicScheduleSchema,
  accountDeleteSchema,
  paymentHandlesSchema,
  updateEmailSchema,
} from '../lib/schemas';
import { sendEmailChangeNoticeEmail, sendVerificationEmail } from '../lib/email';

type ExportRow = Record<string, unknown>;

const isoOrNull = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

// split_with is JSONB, but older rows can come back as a JSON string (see expenses.getByCrew).
function parseSplitWith(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Records the user wrote in crews and on sets: ratings, expenses they paid or
 * share, poll votes, and the packing items, ride offers and meeting points they
 * created. Each section fails on its own and is then exported as [].
 */
async function collectAuthoredRecords(pool: RouteDeps['stores']['pool'], userId: string, log: RouteDeps['log']) {
  const section = async (name: string, sql: string, mapRow: (r: ExportRow) => Record<string, unknown>) => {
    try {
      const { rows } = await pool.query(sql, [userId]);
      return (rows as ExportRow[]).map(mapRow);
    } catch (error) {
      log.warn('gdpr-export:partial-failure', { section: name, userId, error: (error as Error).message });
      return [];
    }
  };

  const ratings = await section(
    'ratings',
    `
  SELECT
    r.set_id,
    s.festival_id,
    s.artist,
    r.rating,
    r.note,
    r.created_at,
    r.updated_at
  FROM
    set_ratings r
    LEFT JOIN festival_sets s ON s.id = r.set_id
  WHERE
    r.user_id = $1
  ORDER BY
    r.created_at
`,
    (r) => ({
      setId: r.set_id,
      festivalId: r.festival_id ?? null,
      artist: r.artist ?? null,
      rating: r.rating,
      note: r.note ?? null,
      createdAt: isoOrNull(r.created_at),
      updatedAt: isoOrNull(r.updated_at),
    }),
  );
  const expenses = await section(
    'expenses',
    `
  SELECT
    id,
    crew_id,
    description,
    amount,
    category,
    planned,
    paid_by,
    split_with,
    created_at
  FROM
    crew_expenses
  WHERE
    paid_by = $1
    OR split_with @> jsonb_build_array($1::text)
  ORDER BY
    created_at
`,
    (r) => ({
      id: r.id,
      crewId: r.crew_id,
      description: r.description,
      amount: Number(r.amount),
      category: r.category ?? null,
      planned: r.planned ?? false,
      paidByYou: r.paid_by === userId,
      splitWith: parseSplitWith(r.split_with),
      createdAt: isoOrNull(r.created_at),
    }),
  );
  const pollVotes = await section(
    'pollVotes',
    `
  SELECT
    v.poll_id,
    p.crew_id,
    p.question,
    p.options ->> v.option_index AS option,
    v.voted_at
  FROM
    crew_poll_votes v
    JOIN crew_polls p ON p.id = v.poll_id
  WHERE
    v.user_id = $1
  ORDER BY
    v.voted_at
`,
    (r) => ({
      pollId: r.poll_id,
      crewId: r.crew_id,
      question: r.question,
      option: r.option ?? null,
      votedAt: isoOrNull(r.voted_at),
    }),
  );
  const packingItems = await section(
    'packingItems',
    'SELECT id, crew_id, label, claimed, brought_by, created_at FROM crew_packing_items WHERE created_by = $1',
    (r) => ({
      id: r.id,
      crewId: r.crew_id,
      label: r.label,
      claimed: r.claimed ?? false,
      broughtBy: r.brought_by ?? null,
      createdAt: isoOrNull(r.created_at),
    }),
  );
  const rides = await section(
    'rides',
    'SELECT id, crew_id, driver, seats, depart_from, depart_at, note, created_at FROM crew_ride_offers WHERE created_by = $1',
    (r) => ({
      id: r.id,
      crewId: r.crew_id,
      driver: r.driver ?? null,
      seats: r.seats ?? null,
      departFrom: r.depart_from ?? null,
      // depart_at is free TEXT (migration 047), not a timestamp, so it is exported as stored.
      departAt: r.depart_at ?? null,
      note: r.note ?? null,
      createdAt: isoOrNull(r.created_at),
    }),
  );
  const meetingPoints = await section(
    'meetingPoints',
    `
  SELECT
    id,
    crew_id,
    label,
    location,
    latitude,
    longitude,
    type,
    meet_at,
    created_at
  FROM
    crew_meeting_points
  WHERE
    created_by = $1
`,
    (r) => ({
      id: r.id,
      crewId: r.crew_id,
      label: r.label,
      location: r.location ?? null,
      latitude: r.latitude ?? null,
      longitude: r.longitude ?? null,
      type: r.type ?? null,
      meetAt: isoOrNull(r.meet_at),
      createdAt: isoOrNull(r.created_at),
    }),
  );

  return { ratings, expenses, pollVotes, packingItems, rides, meetingPoints };
}

/**
 * Collect all user data for GDPR export. Gathers profiles, device tokens,
 * crews, sessions, notification preferences, topic subscriptions, Spotify
 * linkage, payment handles, email, display name, date of birth, the crew
 * statuses the user has posted (with their stored location), and the records
 * the user wrote: set ratings, expenses, poll votes, packing items, ride
 * offers and meeting points.
 */
async function collectGdprData(
  userId: string,
  currentUser: {
    id: string;
    username: string;
    email?: string | null;
    displayName?: string | null;
    dateOfBirth?: string | null;
    venmoHandle?: string | null;
    cashappCashtag?: string | null;
    paypalHandle?: string | null;
    createdAt?: string;
    updatedAt?: string;
  },
  deps: RouteDeps,
) {
  const { stores, getProfiles, log } = deps;

  // GDPR dump is an open-ended, section-by-section accumulator over loosely
  // typed store rows; its shape is the export contract, not a domain type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exportData: any = {
    exportDate: new Date().toISOString(),
    exportVersion: '1.2',
    user: {
      id: currentUser.id,
      username: currentUser.username,
      // Art. 20 required fields — personal identifiers
      email: currentUser.email ?? null,
      displayName: currentUser.displayName ?? null,
      dateOfBirth: currentUser.dateOfBirth ?? null,
      // Payment handles — user-authored, exported as-is (never tokenized)
      paymentHandles: {
        venmoHandle: currentUser.venmoHandle ?? null,
        cashappCashtag: currentUser.cashappCashtag ?? null,
        paypalHandle: currentUser.paypalHandle ?? null,
      },
      createdAt: currentUser.createdAt,
      updatedAt: currentUser.updatedAt,
    },
    profiles: [],
    deviceTokens: [],
  };

  // Get profiles for this user — use targeted query when available
  const userProfiles = stores?.profiles?.getByUserId
    ? await stores.profiles.getByUserId(userId)
    : (getProfiles ? await getProfiles() : []).filter((p: { userId: string }) => p.userId === userId);

  for (const profile of userProfiles) {
    exportData.profiles.push({
      id: profile.id,
      festivalId: profile.festivalId,
      name: profile.name,
      picks: profile.picks || {},
      notes: profile.notes || {},
      reminders: profile.reminders || {},
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    });
  }

  // Get device tokens
  if (stores?.deviceTokens?.listByUser) {
    const tokens = (await stores.deviceTokens.listByUser(userId)) || [];
    exportData.deviceTokens = tokens.map((t: Record<string, unknown>) => ({
      id: t.id,
      platform: t.platform,
      deviceName: t.deviceName,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
    }));
  }

  // Get crew memberships
  if (stores?.crews?.listForUser) {
    try {
      const userCrews = await stores.crews.listForUser(userId);
      exportData.crews = (userCrews || []).map((c: Record<string, unknown>) => ({
        id: c.id,
        name: c.name,
        festivalId: c.festivalId,
        role: c.role,
        joinedAt: c.joinedAt,
      }));
    } catch (error) {
      log.warn('gdpr-export:partial-failure', { section: 'crews', userId, error: (error as Error).message });
      exportData.crews = [];
    }
  }

  // Get active sessions (exclude token hashes)
  if (stores?.sessions?.listUserSessions) {
    try {
      const sessions = await stores.sessions.listUserSessions(userId);
      exportData.sessions = sessions.map((s: { createdAt: string | number; lastAccess: string | number }) => ({
        createdAt: new Date(s.createdAt).toISOString(),
        lastAccess: new Date(s.lastAccess).toISOString(),
      }));
    } catch (error) {
      log.warn('gdpr-export:partial-failure', { section: 'sessions', userId, error: (error as Error).message });
      exportData.sessions = [];
    }
  }

  // Get notification preferences (GDPR: include all personal data)
  if (stores?.notificationPrefs?.get) {
    exportData.notificationPreferences = await stores.notificationPrefs.get(userId);
  }

  // Get topic subscriptions per festival (parallel instead of sequential)
  if (stores?.topicSubscriptions?.getForUser) {
    const results = await Promise.all(
      userProfiles.map(async (profile: { festivalId: string }) => {
        const subs = await stores.topicSubscriptions.getForUser(userId, profile.festivalId);
        return subs && Object.keys(subs).length > 0 ? { festivalId: profile.festivalId, subscriptions: subs } : null;
      }),
    );
    exportData.topicSubscriptions = results.filter(Boolean);
  }

  // Get Spotify linked-account status (Art. 20: linked third-party identity).
  // Export spotify_user_id and connection metadata only — NEVER the encrypted
  // refresh token (that is a credential, not personal data in scope of Art. 20).
  try {
    const spotifyRow = await stores.pool.query(
      `
      SELECT
        spotify_user_id,
        scopes,
        connected_at,
        updated_at
      FROM
        spotify_accounts
      WHERE
        user_id = $1
    `,
      [userId],
    );
    if (spotifyRow.rows.length > 0) {
      const r = spotifyRow.rows[0];
      exportData.spotifyAccount = {
        spotifyUserId: r.spotify_user_id ?? null,
        scopes: r.scopes ?? null,
        connectedAt: r.connected_at ? new Date(r.connected_at).toISOString() : null,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      };
    } else {
      exportData.spotifyAccount = null;
    }
  } catch (error) {
    log.warn('gdpr-export:partial-failure', { section: 'spotifyAccount', userId, error: (error as Error).message });
    exportData.spotifyAccount = null;
  }

  // Get crew status snapshots the user has authored (M5 offline-sync snapshots),
  // with the stored status location: it persists and crewmates can see it.
  if (stores?.crewStatus?.listByUser) {
    try {
      const statuses = await stores.crewStatus.listByUser(userId);
      exportData.crewStatuses = (statuses || []).map((s: Record<string, unknown>) => ({
        crewId: s.crew_id,
        status: s.status ?? null,
        targetMeetingPointId: s.target_meeting_point_id ?? null,
        etaMinutes: s.eta_minutes ?? null,
        note: s.note ?? null,
        latitude: s.latitude ?? null,
        longitude: s.longitude ?? null,
        locationCapturedAt: isoOrNull(s.location_captured_at),
        updatedAt: s.updated_at ? new Date(s.updated_at as string).toISOString() : null,
      }));
    } catch (error) {
      log.warn('gdpr-export:partial-failure', { section: 'crewStatuses', userId, error: (error as Error).message });
      exportData.crewStatuses = [];
    }
  }

  Object.assign(exportData, await collectAuthoredRecords(stores.pool, userId, log));

  return exportData;
}

export default function createAccountRoutes(deps: RouteDeps) {
  const {
    express,
    log,
    userAuth,
    handleAvatarUpload,
    processAvatarUpload,
    runUserTask,
    getUserById,
    getUsers: _getUsers,
    writeAvatarFile,
    removeAvatarFile,
    createVersionToken,
    emitProfileIdentity,
    setNoStore,
    serializePublicUser,
    sanitizeString,
    rateLimit,
    sendSuccess,
    sendError,
    ErrorCodes,
    schemas,
    validate,
    io,
    stores,
    invalidateUserCache,
  } = deps;

  const router = express.Router();

  // Per-recipient tier for POST /email — 3 verification mails per hour to any
  // one address, keyed on the normalized address rather than the caller, so no
  // number of accounts can point the mailer at one victim inbox. Reuses the
  // password-reset limiter factory (Redis-first, in-memory fallback) with a
  // distinct scope so the two buckets never collide.
  // ponytail: counts requests, not sends, so three wrong-password attempts also
  // consume the address budget — same trade /forgot-password already makes.
  // Move the check inside the handler if that lockout is ever reported.
  const emailChangeRecipientLimit = createPasswordResetRateLimit(deps.config, {
    log,
    sendError,
    ErrorCodes,
    redis: deps.redis,
    scope: 'email-change-to',
    message: 'Too many verification emails sent to this address. Try again later.',
  });

  // GDPR data exports: 1 per 24 hours per user. Redis holds the slot so the
  // limit covers every PM2 process and survives restarts. The slot is reserved
  // before collecting and released if the export fails, so a failure does not
  // use up the day. Without Redis, a per-process Map applies the same rules.
  const localExportReservations = new Map<string, number>();
  const EXPORT_RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours
  const MAX_EXPORT_RATE_ENTRIES = 1000;
  // The shared ioredis client applies REDIS_PREFIX itself (lib/redis.ts keyPrefix).
  const exportKey = (userId: string) => `export:${userId}`;

  function reserveLocalExport(userId: string): number {
    const last = localExportReservations.get(userId);
    if (last !== undefined && Date.now() - last < EXPORT_RATE_LIMIT_MS) return last + EXPORT_RATE_LIMIT_MS - Date.now();
    localExportReservations.delete(userId);
    localExportReservations.set(userId, Date.now());
    // Cap Map size with FIFO eviction
    if (localExportReservations.size > MAX_EXPORT_RATE_ENTRIES) {
      localExportReservations.delete(localExportReservations.keys().next().value as string);
    }
    return 0;
  }

  /** Returns 0 when the slot is reserved, else the ms until the next export is allowed. */
  async function reserveExport(userId: string): Promise<number> {
    const { redis } = deps;
    if (redis) {
      try {
        const key = exportKey(userId);
        if ((await redis.set(key, String(Date.now()), 'PX', EXPORT_RATE_LIMIT_MS, 'NX')) === 'OK') return 0;
        return Math.max(1, await redis.pttl(key));
      } catch (error) {
        log.warn('account:export-limit-fallback', { userId, error: (error as Error).message });
      }
    } else {
      log.warn('account:export-limit-fallback', { userId, error: 'redis unavailable' });
    }
    return reserveLocalExport(userId);
  }

  async function releaseExport(userId: string) {
    localExportReservations.delete(userId);
    if (!deps.redis) return;
    try {
      await deps.redis.del(exportKey(userId));
    } catch (error) {
      log.warn('account:export-limit-release-failed', { userId, error: (error as Error).message });
    }
  }

  // ── POST /avatar — upload avatar ──────────────────────────────────────
  router.post(
    '/avatar',
    userAuth,
    rateLimit(10, 'avatar-upload'),
    handleAvatarUpload,
    async (req: Request, res: Response) => {
      try {
        if (!req.file?.buffer) return sendError(res, 400, 'Avatar image is required', ErrorCodes.MISSING_FIELD);
        const processed = await processAvatarUpload(req.file.buffer);
        const updatedUser = await runUserTask(req.user.userId, async () => {
          const currentUser = await getUserById(req.user.userId);
          if (!currentUser) return null;
          const avatarKey = currentUser.avatarKey || crypto.randomBytes(12).toString('hex');
          try {
            await writeAvatarFile(avatarKey, processed);
            const committedUser = await stores.users.update(req.user.userId, {
              avatarKey,
              avatarVersion: createVersionToken(),
              avatarUpdatedAt: new Date().toISOString(),
            });
            if (!committedUser) await removeAvatarFile(avatarKey).catch(() => {});
            return committedUser;
          } catch (err) {
            await removeAvatarFile(avatarKey).catch(() => {});
            throw new Error('Avatar write failed during upload', { cause: err });
          }
        });

        if (!updatedUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
        deps.invalidateUserCache();
        emitProfileIdentity(updatedUser, io);
        setNoStore(res);
        return sendSuccess(res, { user: serializePublicUser(updatedUser) });
      } catch (error) {
        const e = error as { statusCode?: number; message: string };
        if (e.statusCode) {
          return sendError(res, e.statusCode, e.message, ErrorCodes.INVALID_INPUT);
        }
        log.error('avatar upload failed', { error: e.message });
        return sendError(res, 400, 'Failed to process avatar image', ErrorCodes.INVALID_INPUT);
      }
    },
  );

  // ── DELETE /avatar — remove avatar ────────────────────────────────────
  router.delete('/avatar', userAuth, rateLimit(60, 'avatar-delete'), async (req: Request, res: Response) => {
    try {
      const updatedUser = await runUserTask(req.user.userId, async () => {
        const currentUser = await getUserById(req.user.userId);
        if (!currentUser) return null;
        const avatarKey = currentUser.avatarKey;
        const committedUser = await stores.users.update(req.user.userId, {
          avatarKey: null,
          avatarVersion: null,
          avatarUpdatedAt: null,
        });
        await removeAvatarFile(avatarKey).catch(() => {});
        return committedUser;
      });

      if (!updatedUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      deps.invalidateUserCache();
      emitProfileIdentity(updatedUser, io);
      setNoStore(res);
      return sendSuccess(res, { user: serializePublicUser(updatedUser) });
    } catch (error) {
      log.error('avatar delete failed', { error: (error as Error).message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to remove avatar', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── PUT|PATCH /display-name — change the editable display name ─────────
  // The username is the immutable @handle and is NOT user-editable (only
  // admins can rename via the admin tools). display_name is the friendly name
  // shown across crews/account; clients fall back to @username when it's unset.
  const updateDisplayName = async (req: Request, res: Response) => {
    try {
      setNoStore(res);
      const { displayName } = req.validatedBody as z.infer<typeof displayNameChangeSchema>;
      const cleanDisplayName = sanitizeString(displayName, 50);
      if (!cleanDisplayName) {
        return sendError(res, 400, 'Display name must be 1-50 characters', ErrorCodes.INVALID_INPUT);
      }

      const currentUser = await getUserById(req.user.userId);
      if (!currentUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

      const result = await stores.users.update(req.user.userId, { displayName: cleanDisplayName });
      if (!result) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      invalidateUserCache();

      emitProfileIdentity(result, io);
      return sendSuccess(res, { user: serializePublicUser(result) });
    } catch (error) {
      log.error('display name change failed', { error: (error as Error).message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to change display name', ErrorCodes.INTERNAL_ERROR);
    }
  };
  router.put(
    '/display-name',
    userAuth,
    rateLimit(10, 'display-name-change'),
    validate(schemas.displayNameChange),
    updateDisplayName,
  );
  router.patch(
    '/display-name',
    userAuth,
    rateLimit(10, 'display-name-change'),
    validate(schemas.displayNameChange),
    updateDisplayName,
  );

  // ── PUT|PATCH /payment-handles — set Venmo / Cash App / PayPal handles ─
  // Used to build prefilled settle-up deep links. Each field is independently
  // optional: only the provided keys are updated; an explicit empty string
  // clears that handle (stored as NULL). A leading '@' or '$' is stripped so
  // the deep-link builders get a bare identifier.
  const updatePaymentHandles = async (req: Request, res: Response) => {
    try {
      setNoStore(res);
      const body = req.validatedBody as z.infer<typeof paymentHandlesSchema>;

      // Normalize a raw handle: trim, drop a leading @/$, cap length. Empty
      // (or whitespace-only) clears the handle.
      const clean = (raw: string | undefined): string | null | undefined => {
        if (raw === undefined) return undefined; // not provided → leave unchanged
        const trimmed = sanitizeString(raw, 64)
          .replace(/^[@$]+/, '')
          .trim();
        return trimmed.length > 0 ? trimmed : null;
      };

      const fields: Record<string, string | null> = {};
      const venmo = clean(body.venmoHandle);
      const cashapp = clean(body.cashappCashtag);
      const paypal = clean(body.paypalHandle);
      if (venmo !== undefined) fields.venmoHandle = venmo;
      if (cashapp !== undefined) fields.cashappCashtag = cashapp;
      if (paypal !== undefined) fields.paypalHandle = paypal;

      if (Object.keys(fields).length === 0) {
        return sendError(res, 400, 'No payment handles provided', ErrorCodes.INVALID_INPUT);
      }

      const currentUser = await getUserById(req.user.userId);
      if (!currentUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

      const result = await stores.users.update(req.user.userId, fields);
      if (!result) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      invalidateUserCache();

      return sendSuccess(res, { user: serializePublicUser(result) });
    } catch (error) {
      log.error('payment handles update failed', { error: (error as Error).message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to update payment handles', ErrorCodes.INTERNAL_ERROR);
    }
  };
  router.put(
    '/payment-handles',
    userAuth,
    rateLimit(10, 'payment-handles-change'),
    validate(schemas.paymentHandles),
    updatePaymentHandles,
  );
  router.patch(
    '/payment-handles',
    userAuth,
    rateLimit(10, 'payment-handles-change'),
    validate(schemas.paymentHandles),
    updatePaymentHandles,
  );

  // ── PUT|PATCH /public-schedule — opt in/out of the public /u/:username page
  const updatePublicSchedule = async (req: Request, res: Response) => {
    try {
      setNoStore(res);
      const { publicSchedule } = req.validatedBody as z.infer<typeof publicScheduleSchema>;
      const result = await stores.users.update(req.user.userId, { publicSchedule });
      if (!result) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      invalidateUserCache();
      return sendSuccess(res, { user: serializePublicUser(result) });
    } catch (error) {
      log.error('public schedule update failed', { error: (error as Error).message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to update public schedule', ErrorCodes.INTERNAL_ERROR);
    }
  };
  router.put('/public-schedule', userAuth, rateLimit(20, 'public-schedule'), validate(schemas.publicSchedule), updatePublicSchedule);
  router.patch('/public-schedule', userAuth, rateLimit(20, 'public-schedule'), validate(schemas.publicSchedule), updatePublicSchedule);

  // ── POST /stop-sharing — turn off the public page and clear status locations
  // Payment handles and picks links are left alone; the client stops live
  // location itself. Each cleared status row is re-broadcast with the same
  // payload as PUT /crews/:crewId/status so open crew screens drop the pin.
  router.post('/stop-sharing', userAuth, rateLimit(10, 'stop-sharing'), async (req: Request, res: Response) => {
    const userId = req.user.userId;
    try {
      setNoStore(res);
      const user = await stores.users.update(userId, { publicSchedule: false });
      if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      invalidateUserCache();

      const cleared: Array<{ crew_id: string }> = await stores.crewStatus.clearLocationsForUser(userId);
      for (const row of cleared) io.to('crew:' + row.crew_id).emit('crew:status-updated', { status: row });

      log.info('account:stop-sharing', { userId, clearedStatusLocations: cleared.length });
      return sendSuccess(res, { user: serializePublicUser(user), clearedStatusLocations: cleared.length });
    } catch (error) {
      log.error('account stop-sharing failed', { error: (error as Error).message, userId });
      return sendError(res, 500, "Couldn't stop sharing. Try again.", ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /email — request a change of the account email address ────────
  // Shaped on POST /api/v1/auth/change-password (routes/auth.ts) and on
  // DELETE / below: current-password re-auth, scoped rate limit, Zod body.
  //
  // The security-critical difference from the removed POST /api/v1/auth/update-email
  // is that the submitted address is NEVER written to `users` here. It lives
  // only in the hashed, single-use, expiring `email_verification_tokens` row
  // until GET /api/v1/auth/verify-email promotes it via `updateUserEmail`, so a
  // stolen session cannot move the login identity on request alone. The address
  // currently on file is notified that a change was requested, by a sender that
  // opts out of the dedup guard so the alert cannot be suppressed.
  //
  // Two rate-limit tiers: `rateLimit(3, 'email-change')` caps how often one
  // account may ask; `emailChangeRecipientLimit` caps how much Festie-branded
  // mail any one address can be made to receive, across all accounts.
  //
  // A taken address returns 400 ALREADY_EXISTS rather than a fake success. The
  // generic-success posture was measured and did not hold: the taken branch
  // slept 200-500ms while the accepted branch finished in ~38ms, so the two
  // were perfectly separable by timing. POST /api/v1/auth/register leaks the
  // same fact unauthenticated with no password, so hiding it behind a
  // session + password challenge protected nothing and cost the user a
  // success message for a request that did nothing.
  router.post(
    '/email',
    userAuth,
    rateLimit(3, 'email-change'),
    emailChangeRecipientLimit,
    validate(schemas.updateEmail),
    async (req: Request, res: Response) => {
      // Success body never echoes the submitted address back.
      const acceptedMsg = 'Verification link sent. Your login email changes only when you open it.';
      try {
        setNoStore(res);
        const { email, password } = req.validatedBody as z.infer<typeof updateEmailSchema>;
        // `checkEmailExists` / `findUserByEmail` compare LOWER(email) against an
        // already-lowercased parameter, so normalise before both the check and
        // the token insert or the uniqueness check silently misses.
        const cleanEmail = email.trim().toLowerCase();

        const { verifyPassword } = deps;
        const currentUser = await getUserById(req.user.userId);
        if (!currentUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

        const passwordValid = await verifyPassword(password, currentUser.passwordHash);
        if (!passwordValid) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return sendError(res, 400, 'Incorrect password', ErrorCodes.PASSWORD_INCORRECT);
        }

        if (await stores.emailTokens.checkEmailExists(cleanEmail, req.user.userId)) {
          log.warn('account:email-change-rejected', { userId: req.user.userId, reason: 'address-unavailable' });
          return sendError(res, 400, 'Email address already in use', ErrorCodes.ALREADY_EXISTS);
        }

        const verifyToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
        // Single transaction, taken under a row lock on the user: supersede the
        // pending change tokens and issue the replacement together. The
        // unlocked invalidate-then-insert pair let two parallel requests both
        // return 200 and leave two live links for two different addresses.
        // `currentUser.email` is spared so an unclicked signup or resend token
        // for the address already on file is not collateral damage.
        await stores.emailTokens.replaceVerificationToken(
          req.user.userId,
          tokenHash,
          cleanEmail,
          deps.config.EMAIL_VERIFY_TOKEN_TTL_HOURS,
          currentUser.email ?? null,
        );

        const verifyUrl = `${deps.config.PUBLIC_ORIGIN}/api/v1/auth/verify-email?token=${verifyToken}`;
        await sendVerificationEmail({
          to: cleanEmail,
          username: currentUser.username,
          verifyUrl,
          config: deps.config,
          log,
        });

        // Notify the address on file so a user whose session was stolen finds
        // out. The sender opts out of the idempotency guard — see lib/email.ts.
        if (currentUser.email) {
          await sendEmailChangeNoticeEmail({ to: currentUser.email, config: deps.config, log });
        }

        log.info('account:email-change-requested', { userId: req.user.userId });
        return sendSuccess(res, { message: acceptedMsg });
      } catch (error) {
        log.error('account email change failed', { error: (error as Error).message, userId: req.user.userId });
        return sendError(res, 500, 'Failed to request email change', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── DELETE / — soft-delete account (30-day grace period) ──────────────
  router.delete(
    '/',
    userAuth,
    rateLimit(5, 'account-delete'),
    validate(schemas.accountDelete),
    async (req: Request, res: Response) => {
      try {
        const { password } = req.validatedBody as z.infer<typeof accountDeleteSchema>;

        const { verifyPassword, invalidateUserSessions, disconnectUserSockets, getRequestIp } = deps;
        const currentUser = await getUserById(req.user.userId);
        if (!currentUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

        // Already soft-deleted?
        if (currentUser.deletedAt) {
          return sendError(res, 400, 'Account is already scheduled for deletion', ErrorCodes.INVALID_INPUT);
        }

        const passwordValid = await verifyPassword(password, currentUser.passwordHash);
        if (!passwordValid) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return sendError(res, 403, 'Incorrect password', ErrorCodes.PASSWORD_INCORRECT);
        }

        // Soft-delete: set deleted_at and hide the profiles. Picks and notes stay
        // until the 30-day purge, so a sign-in before then restores them.
        // Sessions, refresh tokens and device tokens go now.
        // Retry once on deadlock (PG 40P01) — concurrent test cleanup can trigger this.
        const performSoftDelete = async () => {
          await stores.users.update(req.user.userId, { deletedAt: new Date().toISOString() });
          invalidateUserCache();
          await invalidateUserSessions(req.user.userId);
          if (stores.refreshTokens) await stores.refreshTokens.revokeAll(req.user.userId);
          if (stores.deviceTokens) await stores.deviceTokens.deleteByUser(req.user.userId);
          if (stores.profiles) {
            await stores.profiles.deleteByUserId(req.user.userId, { reason: 'account-deleted', keepPicks: true });
          }
          disconnectUserSockets(req.user.userId, io);
        };
        try {
          await performSoftDelete();
        } catch (err) {
          if ((err as { code?: string }).code === '40P01') {
            await performSoftDelete();
          } else {
            throw new Error('Account soft-delete failed', { cause: err });
          }
        }

        log.warn('account:soft-delete', {
          userId: req.user.userId,
          username: currentUser.username,
          ip: getRequestIp(req),
        });
        deps.clearUserSessionCookie(res);
        const deletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        // Same text as accountDeletionNotice() in @festie/shared authStore.
        const deletionDay = deletionDate.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
        return sendSuccess(res, {
          success: true,
          message: `Your account will be deleted on ${deletionDay}. Sign in before then to keep it.`,
          deletionDate: deletionDate.toISOString(),
        });
      } catch (error) {
        log.error('account soft-delete failed', { error: (error as Error).message, userId: req.user.userId });
        return sendError(res, 500, 'Failed to delete account', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── GET /export — GDPR data export ────────────────────────────────────────
  router.get('/export', userAuth, rateLimit(10, 'account-export'), async (req: Request, res: Response) => {
    let reserved = false;
    try {
      const userId = req.user.userId;

      const currentUser = await getUserById(userId);
      if (!currentUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

      // Rate limit: 1 export per 24 hours
      const retryMs = await reserveExport(userId);
      if (retryMs > 0) {
        const nextAvailable = new Date(Date.now() + retryMs);
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryMs / 1000))));
        return sendError(
          res,
          429,
          'You can download your data once a day. Try again later.',
          ErrorCodes.RATE_LIMITED,
          { retryAt: nextAvailable.toISOString() },
        );
      }
      reserved = true;

      const exportData = await collectGdprData(userId, currentUser, deps);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `festie-data-${timestamp}.json`;
      // The body is the user's full PII dump — never cache it (browser disk
      // cache / shared machine / intermediary proxy).
      setNoStore(res);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      log.info('account:gdpr-export', { userId, username: currentUser.username });
      return sendSuccess(res, exportData);
    } catch (error) {
      if (reserved) await releaseExport(req.user.userId);
      log.error('account export failed', { error: (error as Error).message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to export data', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
