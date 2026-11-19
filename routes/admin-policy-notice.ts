// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.
/**
 * Admin policy-notice email. Mounts: POST /policy-notice
 * dry-run counts the recipients and returns no addresses. send needs a recent re-auth,
 * mails in small batches with a pause for the Resend rate limit, and records each success in
 * policy_notice_sends so a re-run never mails a user twice.
 */
import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { sendPolicyNoticeEmail } from '../lib/email.js';

// Postgres advisory lock key ("FESTIE_P"), next to the backfill and migration keys. Two sends never overlap.
const POLICY_NOTICE_LOCK_KEY = '5063544977519632208';
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1100;
// One HTTP request must finish inside the proxy timeout (about 100 s). The rest goes out on the next call.
const MAX_PER_CALL = 250;

// Not deleted, has a verified email, not yet sent this notice. Sent regardless of marketing and re-engagement opt-outs:
// this is a transactional legal notice.
const ELIGIBLE_SQL = `
  FROM users u
  WHERE u.deleted_at IS NULL AND u.email IS NOT NULL AND u.email_verified_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM policy_notice_sends s WHERE s.notice_id = $1 AND s.user_id = u.id)`;

export default function mountAdminPolicyNoticeRoutes({ router, deps, ctx }: any): void {
  const { log, config, setNoStore, sendSuccess, sendError, ErrorCodes, adminAuth, stores, schemas, validate, requireRecentAuth, getRequestIp } = deps;
  const { adminWriteLimit } = ctx;
  const sendNotice = deps.sendPolicyNoticeEmail ?? sendPolicyNoticeEmail;
  const delayMs = deps.policyNoticeBatchDelayMs ?? BATCH_DELAY_MS;
  const sleep = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

  const sendOnlyReauth = (req: any, res: any, next: any) => (req.validatedBody.mode === 'send' ? requireRecentAuth(req, res, next) : next());

  async function sendBatches(noticeId: string, { subject, text, html }: any) {
    const pool = stores.pool;
    let sent = 0;
    let failed = 0;
    let lastId = '';
    while (sent + failed < MAX_PER_CALL) {
      // Keyset on id: a failed user is not in the ledger but is passed over, so the loop always ends.
      const { rows } = await pool.query(`SELECT u.id, u.email ${ELIGIBLE_SQL} AND u.id > $2 ORDER BY u.id LIMIT $3`, [noticeId, lastId, BATCH_SIZE]);
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].id;
      const results = await Promise.all(
        rows.map(async (row: any) => {
          const ok = await sendNotice({ to: row.email, subject, text, html, config, log });
          if (!ok) return false;
          try {
            await pool.query('INSERT INTO policy_notice_sends (notice_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [noticeId, row.id]);
          } catch (error: any) {
            // Mailed but not recorded: a re-run would mail this user again, so say so loudly.
            log.error('policy notice ledger write failed', { noticeId, userId: row.id, error: error?.message });
          }
          return true;
        }),
      );
      for (const ok of results) ok ? sent++ : failed++;
      await sleep(delayMs);
    }
    return { sent, failed };
  }

  router.post('/policy-notice', adminAuth, adminWriteLimit, validate(schemas.policyNotice), sendOnlyReauth, async (req: any, res: any) => {
    const { noticeId, mode, subject, text, html } = req.validatedBody;
    let lock: any = null;
    let held = false;
    try {
      setNoStore(res);
      const pool = stores.pool;
      const { rows: skippedRows } = await pool.query('SELECT count(*)::int AS n FROM policy_notice_sends WHERE notice_id = $1', [noticeId]);
      const skipped = skippedRows[0]?.n ?? 0;
      if (mode === 'dry-run') {
        const { rows } = await pool.query(`SELECT count(*)::int AS n ${ELIGIBLE_SQL}`, [noticeId]);
        return sendSuccess(res, { mode, recipients: rows[0]?.n ?? 0, skipped });
      }

      lock = await pool.connect();
      const { rows: lockRows } = await lock.query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [POLICY_NOTICE_LOCK_KEY]);
      held = !!lockRows[0]?.locked;
      if (!held) return sendError(res, 409, 'A policy notice is already being sent. Wait for it to finish.', ErrorCodes.ALREADY_EXISTS);

      const { sent, failed } = await sendBatches(noticeId, { subject, text, html });
      const { rows: left } = await pool.query(`SELECT count(*)::int AS n ${ELIGIBLE_SQL}`, [noticeId]);
      const remaining = left[0]?.n ?? 0;
      log.info('policy notice sent', { noticeId, sent, failed, skipped, remaining });
      if (stores.auditLog) {
        await stores.auditLog.insert({
          actorType: 'admin',
          actorId: req.user?.userId || 'admin',
          action: AUDIT_ACTIONS.POLICY_NOTICE_SENT,
          targetType: 'policy_notice',
          targetId: noticeId,
          detailsJson: JSON.stringify({ noticeId, subject, sent, failed, skipped, remaining }),
          ip: getRequestIp(req),
          status: failed > 0 ? 'failure' : 'success',
        });
        // eslint-disable-next-line require-atomic-updates -- res is request-scoped
        res.locals.auditWritten = true;
      }
      return sendSuccess(res, { mode, sent, failed, skipped, remaining });
    } catch (error: any) {
      log.error('policy notice failed', { noticeId, error: error?.message });
      return sendError(res, 500, 'The policy notice stopped part way. Run a dry run to see who is left; users already sent are not mailed again.', ErrorCodes.INTERNAL_ERROR);
    } finally {
      if (lock) {
        let unlocked = !held;
        if (held) {
          try {
            await lock.query('SELECT pg_advisory_unlock($1::bigint)', [POLICY_NOTICE_LOCK_KEY]);
            unlocked = true;
          } catch (error: any) {
            log.warn('policy notice unlock failed', { error: error?.message });
          }
        }
        // A session that kept the lock is destroyed, not returned to the pool.
        lock.release(!unlocked);
      }
    }
  });
}
