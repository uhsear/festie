// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The side effects of raising an SOS, shared by POST /crews/:crewId/sos and the
 * missed check-in timer (lib/checkin.ts): one crew_activity row, the active-SOS
 * Redis entry, the `sos:raised` broadcast, the crew:activity feed emit and the
 * best-effort push fan-out. Validation, membership, sanitising and the raise
 * throttle stay in the route, so a missed check-in is never rate-limited.
 */

import { clearSosSeen, markSosActive } from './rate-limiting.js';
import { appLink } from './notifications/links.js';

/** Round a coordinate to ~4 decimals (~11m) — coarse enough for privacy, precise enough to find someone. */
export function coarse(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

export interface SosRaiseInput {
  crewId: string;
  userId: string;
  username: string;
  message?: string;
  /** Already coarsened by the caller. */
  position?: { lat: number; lng: number; accuracy?: number; capturedAt: string };
}

export function createSosRaiser({ stores, io, redis, emitter, notificationService, log, config }: any) {
  async function raise({ crewId, userId, username, message, position }: SosRaiseInput) {
    // Durable side-effect #1: one crew_activity row. Detail = capped message
    // + optional coarse coords (the single intentional durable location datum).
    const detailParts: string[] = [];
    if (message) detailParts.push(message.slice(0, 280));
    if (position) detailParts.push(`@${position.lat},${position.lng}`);
    const detail = detailParts.join(' ') || null;

    let activityId: string | null = null;
    try {
      activityId = (await stores.activity.log({ crewId, userId, type: 'sos_raised', detail })) as string;
    } catch (err: any) {
      // The activity row is the durable record of the SOS — if it fails we
      // still broadcast + push (best-effort), but log loudly.
      log.error('sos activity log failed', { error: err?.message, crewId, userId });
    }

    const raisedAt = new Date().toISOString();
    const payload = {
      _v: 1,
      crewId,
      userId,
      username,
      message,
      position,
      activityId: activityId || '',
      raisedAt,
    };

    // L3: mark this raiser's SOS active (cluster-wide, Redis-backed) so a
    // subsequent /sos/clear is a real clear, clear-spam on an inactive SOS
    // is a no-op/409, and late joiners can read it via GET /:crewId/sos.
    // Best-effort; failure never blocks the raise.
    // A new SOS starts unseen: drop viewers left over from this raiser's last one.
    await clearSosSeen(redis, crewId, userId);
    await markSosActive(redis, crewId, payload);

    // Durable side-effect #2: crew-wide socket broadcast (primary delivery).
    if (io) io.to('crew:' + crewId).emit('sos:raised', payload);

    // Activity-feed fan-out, only when the row landed. Strictly AFTER the
    // primary broadcast: this is a feed nicety and must never preempt SOS.
    if (activityId) {
      try {
        emitter.crewActivityLogged({ crewId, item: { id: activityId, crewId, userId, type: 'sos_raised', detail } });
      } catch {
        // Feed nicety only. The SOS broadcast above is the primary delivery
        // and has already gone out; never fail the raise on a feed emit.
      }
    }

    // Best-effort side-effect #3: push fan-out to the rest of the crew. MUST
    // NOT block or fail the caller — the socket broadcast + activity row are
    // the primary delivery; push is the offline-reach layer.
    if (notificationService?.send) {
      fanoutSosPush({ crewId, raiserId: userId, username, message, position }).catch((err: any) =>
        log.warn('sos push fan-out failed', { error: err?.message, crewId }),
      );
    }

    log.info('crew:sos-raised', { crewId, userId, hasPosition: Boolean(position) });
    return { activityId, raisedAt };
  }

  /**
   * Per-member push fan-out for an SOS. Small N (a crew, not a festival), so a
   * per-user send is fine and avoids the festival-wide sendToOfflineUsers path.
   * 'crew_sos' is safety-critical (bypasses DND + per-type opt-out in send()).
   */
  async function fanoutSosPush({ crewId, raiserId, username, message, position }: any) {
    const members = await stores.crews.getMembers(crewId);
    const recipients = members.filter((m: any) => m.userId && m.userId !== raiserId);
    const data: Record<string, any> = {
      crewId,
      userId: raiserId,
      deepLink: appLink(config, '/crew?sos=' + encodeURIComponent(raiserId)),
    };
    if (position) {
      data.lat = String(position.lat);
      data.lng = String(position.lng);
    }
    await Promise.allSettled(
      recipients.map((m: any) =>
        notificationService.send({
          userId: m.userId,
          type: 'crew_sos',
          title: `${username} raised an SOS`,
          body: message || (position ? 'Tap to get directions to their last location.' : 'Tap to see their SOS.'),
          data,
          threadId: `sos-${crewId}`,
        }),
      ),
    );
  }

  return { raise };
}

export type SosRaiser = ReturnType<typeof createSosRaiser>;
