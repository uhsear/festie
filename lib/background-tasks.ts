/**
 * Background periodic tasks: session/avatar/token cleanup, retention, sweeps and
 * memory monitoring. Intervals live in JOB_INTERVALS_MS (lib/config.ts).
 */
import fsp from 'fs/promises';
import path from 'path';

import { JOB_INTERVALS_MS } from './config.js';
import { recordJobRun } from './metrics.js';
import { isLeader } from './process-role.js';

/**
 * Create background periodic timers — session cleanup, avatar orphan removal,
 * expired token purge, memory pressure monitoring.
 */
export function createBackgroundTasks(ctx: any, { io }: any) {
  const {
    config,
    state,
    stores,
    log,
    validateUserSession,
    disconnectSocket,
    emitPresence,
    avatarDirPath,
  } = ctx;

  // Memory pressure monitoring — log warnings when RSS grows large
  const registerMemoryMonitor = () => {
    const timer = setInterval(() => {
      const mem = process.memoryUsage();
      const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
      const rssMB = Math.round(mem.rss / 1024 / 1024);
      if (rssMB > config.MEMORY_WARNING_MB) {
        log.warn('high memory usage', {
          rssMB,
          heapMB,
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
          rateLimitEntries:
            state.rateLimits.size + state.routeRateLimits.size + state.authRateLimits.size + state.socketRateLimits.size,
          onlineRooms: state.onlineUsers.size,
          connections: io.engine?.clientsCount || 0,
        });
      }
    }, config.MEMORY_CHECK_INTERVAL_MS);
    timer.unref();
    state.timers.push(timer);
  };

  // ── Leader election for cleanup tasks (PM2 cluster mode) ──────────────────
  // PM2 sets NODE_APP_INSTANCE to '0'..'N-1'. Only instance 0 runs periodic
  // cleanup tasks to avoid redundant work across workers. In non-cluster mode
  // (NODE_APP_INSTANCE undefined), all tasks run normally.
  if (!isLeader()) {
    log.info('background tasks: not leader (instance !== 0), skipping cleanup timers', { instance: process.env.NODE_APP_INSTANCE });
    // Still register memory monitor on every worker (it is per-process)
    registerMemoryMonitor();
    return;
  }

  // A half-configured sign-in provider stays off and never fails boot (T45).
  // Logged here, on the leader only, so the warning appears once per boot.
  for (const [provider, missing] of Object.entries(config.OAUTH_CONFIG_MISSING ?? {})) {
    if ((missing as string[]).length > 0) log.warn('oauth:config-incomplete', { provider, missing });
  }
  if (config.RESEND_API_KEY && !config.EMAIL_POSTAL_ADDRESS) log.warn('email:postal-address-unset', { setting: 'EMAIL_POSTAL_ADDRESS', effect: 'wrap-up, lineup, days, set-times and crew-reform emails are not sent' });

  // Overlap guard: skip a tick while the previous run of the same sweep is still going.
  // Running sweeps are tracked in state.sweepsInFlight so shutdown can drain them
  // before the pg pool ends.
  const sweepsInFlight: Set<Promise<void>> = (state.sweepsInFlight ??= new Set());
  const guard = (run: () => Promise<void>) => {
    let running = false;
    return async () => {
      if (running) return;
      running = true;
      const pending = run();
      sweepsInFlight.add(pending);
      try {
        await pending;
      } finally {
        // eslint-disable-next-line require-atomic-updates -- single-flight flag: only this call can clear it
        running = false;
        sweepsInFlight.delete(pending);
      }
    };
  };

  // Session cleanup — evict expired sessions and disconnect their sockets
  const _sessionCleanupTimer = setInterval(guard(async () => {
    try {
      await stores.sessions.deleteExpiredUserSessions(config.SESSION_TTL);
      const presenceTargets = new Set<string>();
      for (const socket of io.of('/').sockets.values()) {
        const sessionToken = socket.data?.userSessionToken;
        if (!sessionToken) continue;
        if (await validateUserSession(sessionToken)) continue;
        disconnectSocket(socket, io, presenceTargets);
      }
      for (const festivalId of presenceTargets) emitPresence(festivalId, io);
      recordJobRun('session_cleanup', true);
    } catch (err: any) {
      recordJobRun('session_cleanup', false);
      log.error('session cleanup failed', { error: err.message });
    }
  }), config.SESSION_CLEANUP_INTERVAL_MS);
  _sessionCleanupTimer.unref();
  state.timers.push(_sessionCleanupTimer);

  // Avatar orphan cleanup — remove avatar files with no users row at all (every 6h).
  // Deliberately queries users.avatar_key WITHOUT a deleted_at filter: a
  // soft-deleted account keeps its file for the 30-day grace period so a restore
  // works, which is also what packages/mobile/app/privacy.tsx promises. The row is
  // removed by retention_cleanup() at day 30 and the file is reclaimed after that.
  const _avatarCleanupTimer = setInterval(
    async () => {
      try {
        const avatarDir = avatarDirPath();
        let dir;
        try {
          dir = await fsp.opendir(avatarDir);
        } catch (err: any) {
          if (err.code !== 'ENOENT') throw err;
          recordJobRun('avatar_cleanup', true);
          return;
        }
        // Page the directory so memory and the users query stay bounded.
        const removeOrphans = async (files: string[]) => {
          const keys = files.map((file) => file.replace(/\.webp$/, ''));
          const { rows } = await stores.pool.query(
            'SELECT avatar_key FROM users WHERE avatar_key = ANY($1::text[])',
            [keys],
          );
          const validAvatarKeys = new Set(rows.map((r: any) => r.avatar_key));
          for (const [i, file] of files.entries()) {
            const avatarKey = keys[i];
            if (validAvatarKeys.has(avatarKey)) continue;
            try {
              await fsp.unlink(path.join(avatarDir, file));
              log.debug('orphan avatar removed', { avatarKey });
            } catch (err: any) {
              log.warn('failed to remove orphan avatar', { avatarKey, error: err.message });
            }
          }
        };
        let batch: string[] = [];
        for await (const entry of dir) {
          if (!entry.name.endsWith('.webp')) continue;
          batch.push(entry.name);
          if (batch.length >= 500) {
            await removeOrphans(batch);
            batch = [];
          }
        }
        if (batch.length > 0) await removeOrphans(batch);
        recordJobRun('avatar_cleanup', true);
      } catch (err: any) {
        recordJobRun('avatar_cleanup', false);
        log.warn('avatar cleanup failed', { error: err.message });
      }
    },
    JOB_INTERVALS_MS.AVATAR_CLEANUP,
  );
  _avatarCleanupTimer.unref();
  state.timers.push(_avatarCleanupTimer);

  // Expired token cleanup — purge password_reset_tokens and email_verification_tokens
  const _tokenCleanupTimer = setInterval(
    async () => {
      try {
        const { rowCount: resetPurged } = await stores.pool.query(
          `DELETE FROM password_reset_tokens WHERE expires_at < NOW()`,
        );
        const { rowCount: verifyPurged } = await stores.pool.query(
          `DELETE FROM email_verification_tokens WHERE expires_at < NOW()`,
        );
        const { rowCount: refreshPurged } = await stores.pool.query(
          'DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked = TRUE',
        );
        const deviceTokensPurged = await stores.deviceTokens.deleteExpired();
        if (resetPurged > 0 || verifyPurged > 0 || refreshPurged > 0 || deviceTokensPurged > 0) {
          log.info('token cleanup', { resetPurged, verifyPurged, refreshPurged, deviceTokensPurged });
        }
        recordJobRun('token_cleanup', true);
      } catch (err: any) {
        recordJobRun('token_cleanup', false);
        log.warn('token cleanup failed', { error: err.message });
      }
    },
    JOB_INTERVALS_MS.TOKEN_CLEANUP,
  );
  _tokenCleanupTimer.unref();
  state.timers.push(_tokenCleanupTimer);

  // Audit log cleanup — purge entries older than retention threshold
  const _auditCleanupTimer = setInterval(
    async () => {
      let ok = true;
      try {
        const deleted = await stores.auditLog.cleanup(config.AUDIT_LOG_RETENTION_DAYS);
        if (deleted > 0) {
          log.info('audit log cleanup', { deleted, retentionDays: config.AUDIT_LOG_RETENTION_DAYS });
        }
      } catch (err: any) {
        ok = false;
        log.warn('audit log cleanup failed', { error: err.message });
      }
      try {
        const purged = await stores.identities.purgeExpiredStates();
        if (purged > 0) log.info('oauth state cleanup', { purged });
      } catch (err: any) {
        ok = false;
        log.warn('oauth state cleanup failed', { error: err.message });
      }
      recordJobRun('audit_cleanup', ok);
    },
    JOB_INTERVALS_MS.AUDIT_CLEANUP,
  );
  _auditCleanupTimer.unref();
  state.timers.push(_auditCleanupTimer);

  // Retention (migration 060): hard-deletes accounts 30 days after soft delete,
  // festivals 90 days after delete, and old metrics/audit rows. Production has no
  // pg_cron, so the app runs it. The privacy policy promises the 30-day delete.
  const runRetention = async () => {
    try {
      await stores.pool.query('SELECT retention_cleanup()');
      // Organization invitations by email lapse after 90 days (PENDING_INVITE_DAYS); the address goes with the row.
      const expiredInvites = await stores.organizations.purgeExpiredPending();
      if (expiredInvites > 0) log.info('retention: expired organization invitations deleted', { count: expiredInvites });
      recordJobRun('retention_cleanup', true);
    } catch (err: any) {
      recordJobRun('retention_cleanup', false);
      log.warn('retention cleanup failed', { error: err.message });
    }
  };
  const _retentionTimer = setInterval(guard(runRetention), JOB_INTERVALS_MS.RETENTION);
  _retentionTimer.unref();
  state.timers.push(_retentionTimer);
  // Every deploy restarts the process, and deploys come less than a day apart, so a
  // 24-hour interval alone never fires. Also run once shortly after boot.
  const _retentionFirstRun = setTimeout(guard(runRetention), JOB_INTERVALS_MS.RETENTION_FIRST_RUN);
  _retentionFirstRun.unref();
  state.timers.push(_retentionFirstRun);

  registerMemoryMonitor();

  // Phase 1A: Reminder scheduler — fires FCM for upcoming set reminders
  if (ctx.reminderScheduler) {
    ctx.reminderScheduler.start();
    state.reminderScheduler = ctx.reminderScheduler;
    log.info('reminder scheduler registered with background tasks');
  }
  if (ctx.checkinScheduler) {
    ctx.checkinScheduler.start();
    state.checkinScheduler = ctx.checkinScheduler;
  }

  // Phase 1B: Meeting point expiry — deactivate expired points every 5 min
  const _meetingPointExpiryTimer = setInterval(async () => {
    try {
      if (stores.crews?.meetingPoints?.expireStale) {
        const { rowCount } = await stores.crews.meetingPoints.expireStale();
        if (rowCount > 0) log.debug('expired meeting points', { count: rowCount });
      }
      recordJobRun('meeting_point_expiry', true);
    } catch (err: any) {
      recordJobRun('meeting_point_expiry', false);
      log.warn('meeting point expiry failed', { error: err.message });
    }
  }, config.TOKEN_CLEANUP_INTERVAL_MS);
  _meetingPointExpiryTimer.unref();
  state.timers.push(_meetingPointExpiryTimer);

  // Poll expiry sweep: end polls whose closes_at has passed (announce + push, like a manual end).
  // 5 s keeps the crew:poll-closed announcement close to closes_at; the UPDATE only scans open polls.
  if (ctx.pollCloser) {
    const _pollExpiryTimer = setInterval(guard(async () => {
      try {
        const count = await ctx.pollCloser.sweepExpired();
        if (count > 0) log.debug('ended expired polls', { count });
        recordJobRun('poll_expiry', true);
      } catch (err: any) {
        recordJobRun('poll_expiry', false);
        log.warn('poll expiry sweep failed', { error: err.message });
      }
    }), JOB_INTERVALS_MS.POLL_EXPIRY);
    _pollExpiryTimer.unref();
    state.timers.push(_pollExpiryTimer);
  }

  // Festival announcements: send scheduled rows when due (lib/announcements.ts).
  if (ctx.announcer) {
    const _announcementTimer = setInterval(guard(async () => {
      try {
        const count = await ctx.announcer.deliverDue();
        if (count > 0) log.debug('delivered festival announcements', { count });
        recordJobRun('announcements', true);
      } catch (err: any) {
        recordJobRun('announcements', false);
        log.warn('announcement sweep failed', { error: err.message });
      }
    }), JOB_INTERVALS_MS.ANNOUNCEMENTS);
    _announcementTimer.unref();
    state.timers.push(_announcementTimer);
  }

  // M3 wrap_ready sweep — there is no in-request "festival became over" event, so
  // a leader-only periodic sweep is the clearest available trigger (see roadmap
  // M3: "wire it where a festival transitions to over OR expose it for a
  // post-festival job"). We scan only festivals whose final day ended in a recent
  // window (cheap) and call sendWrapReady per festival; the trigger's
  // once-per-event-per-user dedup (notification_log eventKey) makes repeated
  // sweeps idempotent, so an exact transition moment isn't required.
  // When the durable queue is active (issue #20), each sweep ENQUEUES a
  // wrap_ready job and the in-process worker drains it with retries; the sweep
  // itself stays a simple hourly leader-gated interval (no in-request "over" event).
  if (ctx.reengagement?.sendWrapReady) {
    const runWrapSweep = async () => {
      try {
        // Festivals whose max day date is in [now-3d, now] — recently over.
        const { rows } = await stores.pool.query(`
          SELECT f.id
          FROM festivals f
          WHERE f.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM festival_days d WHERE d.festival_id = f.id)
            AND (SELECT MAX(d.date) FROM festival_days d WHERE d.festival_id = f.id)
                BETWEEN (CURRENT_DATE - INTERVAL '3 days')::text AND CURRENT_DATE::text
        `);
        let failed = 0;
        for (const r of rows) {
          try {
            await ctx.reengagement.sendWrapReady(r.id);
          } catch (err: any) {
            failed++;
            log.warn('wrap_ready sweep: per-festival send failed', { festivalId: r.id, error: err.message });
          }
        }
        if (rows.length > 0) log.debug('wrap_ready sweep complete', { festivals: rows.length });
        recordJobRun('wrap_ready', failed === 0);
      } catch (err: any) {
        recordJobRun('wrap_ready', false);
        log.warn('wrap_ready sweep failed', { error: err.message });
      }
    };
    const _wrapReadyTimer = setInterval(guard(runWrapSweep), JOB_INTERVALS_MS.WRAP_READY);
    _wrapReadyTimer.unref();
    state.timers.push(_wrapReadyTimer);
    log.info('wrap_ready sweep registered (hourly, leader-only)');
  }

  // T37 rate_prompt sweep: hourly, leader-only. Candidates are festivals with a
  // day dated in [today-2d, today]; sendRatePrompt picks the day whose morning
  // window (10:00-20:00 festival time, the next day) is open now, and its
  // per-user eventKey dedup makes the hourly re-runs send once per day.
  if (ctx.reengagement?.sendRatePrompt) {
    const runRatePromptSweep = async () => {
      try {
        const { rows } = await stores.pool.query(`
          SELECT f.id
          FROM festivals f
          WHERE f.deleted_at IS NULL
            AND EXISTS (
              SELECT 1 FROM festival_days d
              WHERE d.festival_id = f.id
                AND d.date BETWEEN (CURRENT_DATE - 2)::text AND CURRENT_DATE::text
            )
        `);
        let failed = 0;
        for (const r of rows) {
          try {
            await ctx.reengagement.sendRatePrompt(r.id);
          } catch (err: any) {
            failed++;
            log.warn('rate_prompt sweep: per-festival send failed', { festivalId: r.id, error: err.message });
          }
        }
        if (rows.length > 0) log.debug('rate_prompt sweep complete', { festivals: rows.length });
        recordJobRun('rate_prompt', failed === 0);
      } catch (err: any) {
        recordJobRun('rate_prompt', false);
        log.warn('rate_prompt sweep failed', { error: err.message });
      }
    };
    const _ratePromptTimer = setInterval(guard(runRatePromptSweep), JOB_INTERVALS_MS.RATE_PROMPT);
    _ratePromptTimer.unref();
    state.timers.push(_ratePromptTimer);
    log.info('rate_prompt sweep registered (hourly, leader-only)');
  }
}
