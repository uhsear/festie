// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.
/**
 * Admin policy-notice email. Mounts: POST /policy-notice
 * dry-run counts the recipients and returns no addresses. send needs a recent re-auth,
 * mails in small batches with a pause for the Resend rate limit, and records each success in
 * policy_notice_sends so a re-run never mails a user twice. The first send of a noticeId pins its content hash in
 * policy_notices, and only one notice may be sent in any 24 hours, so a reused or second id cannot mail new text.
 */
import { createHash } from 'node:crypto';
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
  const { log, config, setNoStore, sendSuccess, sendError, ErrorCodes, adminAuth, stores, schemas, validate, requireRecentAuth, getRequestIp, rateLimit } = deps;
  const { adminWriteLimit } = ctx;
  const sendNotice = deps.sendPolicyNoticeEmail ?? sendPolicyNoticeEmail;
  const delayMs = deps.policyNoticeBatchDelayMs ?? BATCH_DELAY_MS;
  const sleep = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

  // Dry-run keeps the shared admin write limit; only a send takes the tight one.
  const onlyMode = (mode: string, middleware: any) => (req: any, res: any, next: any) => (req.validatedBody.mode === mode ? middleware(req, res, next) : next());
  const sendOnlyReauth = (req: any, res: any, next: any) => (req.validatedBody.mode === 'send' ? requireRecentAuth(req, res, next) : next());

  async function sendBatches(noticeId: string, { subject, text, html }: any, progress: { sent: number; failed: number }) {
    const pool = stores.pool;
    let lastId = '';
    while (progress.sent + progress.failed < MAX_PER_CALL) {
      // Keyset on id: a failed user is not in the ledger but is passed over, so the loop always ends.
      const { rows } = await pool.query(`SELECT u.id, u.email ${ELIGIBLE_SQL} AND u.id > $2 ORDER BY u.id LIMIT $3`, [noticeId, lastId, BATCH_SIZE]);
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].id;
      const results = await Promise.all(
        rows.map(async (row: any) => {
          const ok = await sendNotice({ to: row.email, subject, text, html, idempotencyKey: `${noticeId}:${row.id}`, config, log });
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
      for (const ok of results) ok ? progress.sent++ : progress.failed++;
      await sleep(delayMs);
    }
  }

  async function writeAudit(req: any, res: any, action: string, noticeId: string, details: object, status: string) {
    if (!stores.auditLog) return;
    await stores.auditLog.insert({
      actorType: 'admin',
      actorId: req.user?.userId || 'admin',
      action,
      targetType: 'policy_notice',
      targetId: noticeId,
      detailsJson: JSON.stringify({ noticeId, ...details }),
      ip: getRequestIp(req),
      status,
    });
    res.locals.auditWritten = true;
  }

  router.post('/policy-notice', adminAuth, validate(schemas.policyNotice), onlyMode('dry-run', adminWriteLimit), onlyMode('send', rateLimit(2, 'policy-notice')), sendOnlyReauth, async (req: any, res: any) => {
    const { noticeId, mode, subject, text, html } = req.validatedBody;
    let lock: any = null;
    let held = false;
    let started = false;
    const progress = { sent: 0, failed: 0 };
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

      // A different notice inside 24 hours is refused: a stolen admin session cannot fan out several mailings.
      const { rows: recent } = await pool.query("SELECT 1 FROM policy_notice_sends WHERE notice_id <> $1 AND sent_at > now() - interval '24 hours' LIMIT 1", [noticeId]);
      if (recent.length > 0) return sendError(res, 409, 'Another policy notice was sent in the last 24 hours. Wait, or continue that notice.', ErrorCodes.ALREADY_EXISTS);

      // The first send pins the content; a later send of the same noticeId must match it.
      const actor = req.user?.userId || 'admin';
      const contentHash = createHash('sha256').update(`${subject}
${text}
${html ?? ''}`).digest('hex');
      await pool.query('INSERT INTO policy_notices (notice_id, content_hash, subject, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [noticeId, contentHash, subject, actor]);
      const { rows: pinned } = await pool.query('SELECT content_hash FROM policy_notices WHERE notice_id = $1', [noticeId]);
      if (pinned[0]?.content_hash !== contentHash) return sendError(res, 409, 'content differs from the first send of this noticeId', ErrorCodes.ALREADY_EXISTS);

      // Written before the first mail, so a crash mid-run still leaves a record of who started it.
      await writeAudit(req, res, AUDIT_ACTIONS.POLICY_NOTICE_STARTED, noticeId, { subject, contentHash }, 'success');
      started = true;

      await sendBatches(noticeId, { subject, text, html }, progress);
      const { sent, failed } = progress;
      const { rows: left } = await pool.query(`SELECT count(*)::int AS n ${ELIGIBLE_SQL}`, [noticeId]);
      const remaining = left[0]?.n ?? 0;
      log.info('policy notice sent', { noticeId, sent, failed, skipped, remaining });
      await writeAudit(req, res, AUDIT_ACTIONS.POLICY_NOTICE_SENT, noticeId, { subject, sent, failed, skipped, remaining }, failed > 0 ? 'failure' : 'success');
      return sendSuccess(res, { mode, sent, failed, skipped, remaining });
    } catch (error: any) {
      log.error('policy notice failed', { noticeId, error: error?.message });
      if (started) {
        try {
          await writeAudit(req, res, AUDIT_ACTIONS.POLICY_NOTICE_SENT, noticeId, { subject, sent: progress.sent, failed: progress.failed, error: error?.message }, 'failure');
        } catch (auditError: any) {
          log.error('policy notice failure audit write failed', { noticeId, error: auditError?.message });
        }
      }
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
