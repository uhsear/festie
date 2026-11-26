/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Email-Related Auth Routes (split from auth.js for maintainability)
 * POST /forgot-password   - Request password reset email
 * POST /verify-email      - Verify email address (the web confirm page posts the emailed token)
 * GET  /verify-email      - Legacy link: redirects to the confirm page without consuming the token
 * POST /resend-verification - Resend email verification (authenticated)
 * POST /reset-password    - Reset password via emailed token
 * GET|POST /unsubscribe   - One-click unsubscribe from marketing email (signed link, no sign-in)
 * (GET /reset-password lives in routes/pages.ts: it checks the link and hands it to the SPA.)
 *
 * AUDIT FIX (2026-04-14, DEFERRED FIX AGENT 1):
 *   Added per-email password-reset limiter (`passwordResetRateLimit`) to
 *   `/forgot-password` and `/reset-password`. The old IP-keyed `rateLimit()`
 *   middleware is preserved alongside it for defense-in-depth (IP + email
 *   tiers). The inline `forgotPwLimit` (Redis-first) still silently caps
 *   per-email attempts without revealing rate limiting (to block enumeration).
 */

import crypto from 'crypto';
import type { Router } from 'express';
import { createEmailWindowLimit, createPasswordResetRateLimit } from '../lib/rate-limiting';
import { sendEmailChangedEmail, sendPasswordResetEmail, sendVerificationEmail, unsubscribeSecret, verifyEmailUrl, verifyUnsubscribeToken } from '../lib/email';
import { escapeHtml } from '../lib/helpers/sanitize';
import { colors } from '../packages/shared/src/tokens/colors';
import { colorsDaylight } from '../packages/shared/src/tokens/colorsDaylight';
import type { RouteDeps } from '../lib/types';

export default function createEmailAuthRoutes(deps: RouteDeps): Router {
  const {
    express,
    config,
    log,
    hashPassword,
    checkPasswordPolicy,
    invalidateUserSessions,
    disconnectUserSockets,
    userAuth,
    getUserById,
    sendSuccess,
    sendError,
    ErrorCodes,
    rateLimit,
    schemas,
    validate,
    stores,
    invalidateUserCache,
    createAuditLog,
    getRequestIp,
    io,
  } = deps;

  // Per-email password-reset limiter (3/hour per normalized email) applied to
  // both /forgot-password and /reset-password. Factory-constructed once per
  // router so buckets persist across requests inside a worker process.
  const passwordResetRateLimit = createPasswordResetRateLimit(config, {
    log,
    sendError,
    ErrorCodes,
    redis: deps.redis,
  });

  // Per-email rate limiting for forgot-password (3 requests per 60 seconds)
  const forgotPwLimit = createEmailWindowLimit(config, { redis: deps.redis, scope: 'forgot-pw-email', max: 3, windowMs: 60_000 });

  // Per-email rate limiting for resend-verification (3 requests per 5 minutes)
  const resendVerifyLimit = createEmailWindowLimit(config, { redis: deps.redis, scope: 'resend-verify-email', max: 3, windowMs: 5 * 60_000 });

  const router = express.Router();

  async function sendResetLink(cleanEmail: string) {
    const user = await stores.emailTokens.findUserByEmail(cleanEmail);
    if (!user) return;

    // Invalidate any existing reset tokens for this user
    await stores.emailTokens.invalidateResetTokens(user.id);

    // Generate new reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    await stores.emailTokens.createResetToken(user.id, tokenHash);

    const resetUrl = `${config.PUBLIC_ORIGIN}/reset-password?token=${resetToken}`;
    const sent = await sendPasswordResetEmail({ to: cleanEmail, username: user.username, resetUrl, config, log, redis: deps.redis });
    if (!sent) {
      // The response stays identical so it cannot reveal accounts. sendEmail has already logged
      // the provider error; this line says which request lost its reset mail.
      log.warn('forgot-password:email-failed', {
        userId: user.id,
        reason: config.RESEND_API_KEY ? 'send-failed' : 'RESEND_API_KEY not configured',
      });
    }

    log.info('forgot-password:requested', { userId: user.id });
  }

  // ── POST /forgot-password — request password reset email ─────────────
  router.post(
    '/forgot-password',
    rateLimit(3, 'forgot-password', { keyFromBody: (req: any) => req.body?.email }),
    passwordResetRateLimit,
    validate(schemas.forgotPassword),
    async (req: any, res: any) => {
      try {
        const { email } = req.validatedBody;
        const cleanEmail = String(email).trim().toLowerCase();

        // Always return success to prevent email enumeration
        const successMsg = 'If an account with that email exists, a reset link has been sent';

        // Check per-email rate limit (3 requests per 60 seconds)
        if ((await forgotPwLimit(cleanEmail)).limited) {
          // Still return 200 to not reveal rate limiting
          return sendSuccess(res, { message: successMsg });
        }

        // Answer before any lookup or send: a known and an unknown address then return in the same time.
        // That work is detached, so its failures are logged here and never reach the caller.
        // Accepted risk: shutdown does not wait for it, so a restart in that window loses the email.
        // The user can request another link, and the loss shows in the log.
        void sendResetLink(cleanEmail).catch((error: any) => log.error('forgot-password failed', { error: error?.message ?? String(error) }));
        return sendSuccess(res, { message: successMsg });
      } catch (error: any) {
        log.error('forgot-password failed', { error: error.message });
        return sendError(res, 500, 'Failed to process request', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── verify-email ──────────────────────────────────────────────────────
  // The emailed link opens the web confirm page (/verify-email in the SPA),
  // which POSTs the token here. A GET must never consume a token: mail
  // scanners prefetch links and would burn it before the person clicks.
  // Both verbs share runVerification, so the sign-out rules below hold for each.
  type VerifyOutcome = {
    status: number;
    message: string;
    code?: string;
    data?: { verified: true; email: string; sessionsRevoked: boolean };
  };

  const runVerification = async (token: string): Promise<VerifyOutcome> => {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      // Atomic claim: the UPDATE ... RETURNING is the only place a token is
      // consumed, so two concurrent clicks on one link cannot both proceed.
      const tokenRow = await stores.emailTokens.consumeVerificationToken(tokenHash);

      if (!tokenRow) {
        return {
          status: 400,
          message: 'This verification link has expired or already been used',
          code: ErrorCodes.INVALID_INPUT,
        };
      }

      const { user_id: userId, email: verifiedEmail } = tokenRow;

      // Read the address on file BEFORE the promoting write. A signup or
      // resend confirmation re-verifies the address the account already holds,
      // and adding a FIRST address displaces nothing — only replacing one real
      // address with another moves the login identity.
      const currentUser = await getUserById(userId);
      const identityMoved =
        !!currentUser?.email && String(currentUser.email).toLowerCase() !== String(verifiedEmail).toLowerCase();

      try {
        await stores.emailTokens.updateUserEmail(userId, verifiedEmail);
      } catch (writeError: any) {
        // idx_users_email is UNIQUE(LOWER(email)) — another account can have
        // claimed the address between the request and this click. The token
        // stays consumed on purpose: this link can never succeed, and telling
        // the user to start over is the only real remedy. Previously surfaced
        // as a 500 marked retryable, which no retry could ever satisfy.
        if (writeError?.code !== '23505') throw writeError;
        log.warn('email:verify-address-taken', { userId });
        return {
          status: 409,
          message:
            'That address is now in use by another account. Request the email change again from your account settings.',
          code: ErrorCodes.ALREADY_EXISTS,
        };
      }
      invalidateUserCache();

      // Moving the login identity is a credential change: it hands whoever
      // holds the new inbox the password-reset channel. Drop every session,
      // refresh token and socket, exactly as /reset-password does below, so a
      // stolen session cannot outlive the change it made. Confirming the
      // address already on file (signup, resend) and adding a first address
      // are exempt: neither displaces an existing recovery channel, and
      // signing a user out the moment they confirm their email is pure cost.
      if (identityMoved) {
        // Every other pending link now points at a stale address — including
        // an unclicked signup token for the address just replaced, which would
        // otherwise silently revert the change. Sparing it up to this point is
        // what keeps an in-flight signup working; once the identity has moved
        // it is dead weight.
        await stores.emailTokens.invalidateVerificationTokens(userId);
        await invalidateUserSessions(userId);
        if (stores.refreshTokens) await stores.refreshTokens.revokeAll(userId);
        await disconnectUserSockets(userId, io);
        // Tell the old address. sendEmail never throws, so a mail failure
        // cannot fail the confirm.
        await sendEmailChangedEmail({ to: currentUser.email, config, log });
      }

      log.info('email:verified', { userId, email: verifiedEmail, identityMoved });
      return { status: 200, message: '', data: { verified: true, email: verifiedEmail, sessionsRevoked: identityMoved } };
    } catch (error: any) {
      log.error('verify-email failed', { error: error.message });
      return { status: 500, message: 'Something went wrong', code: ErrorCodes.INTERNAL_ERROR };
    }
  };

  const sendVerifyJson = (res: any, out: VerifyOutcome) =>
    out.data ? sendSuccess(res, out.data) : sendError(res, out.status, out.message, out.code);

  // POST /verify-email — the confirm page's button. Public: the token is the credential.
  router.post('/verify-email', rateLimit(10, 'verify-email'), validate(schemas.verifyEmail), async (req: any, res: any) =>
    sendVerifyJson(res, await runVerification(req.validatedBody.token)),
  );

  // GET /verify-email — kept for one release for links already in inboxes.
  // Browsers (and link scanners) get a redirect to the confirm page and
  // consume nothing; a client that asks for JSON is an API caller, not a
  // prefetch, and still consumes. A malformed link keeps the error page.
  router.get('/verify-email', rateLimit(10, 'verify-email'), async (req: any, res: any) => {
    // True when the caller is an API client that wants JSON, not the HTML page.
    const accept = String(req.headers?.accept || '');
    const wantsJson = /application\/json/i.test(accept) && !/text\/html/i.test(accept);
    const token = String(req.query.token || '').trim();

    if (!/^[a-f0-9]{64}$/.test(token)) {
      if (wantsJson) return sendError(res, 400, 'Invalid verification link', ErrorCodes.INVALID_INPUT);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(_verifyEmailPage(400, 'Link not valid', 'Invalid verification link.', OPEN_FESTIE));
    }
    if (!wantsJson) {
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, `/verify-email?token=${token}`);
    }
    return sendVerifyJson(res, await runVerification(token));
  });

  // ── GET|POST /unsubscribe — one-click unsubscribe from re-engagement email ──
  // The link in every marketing email carries a signed per-user token (lib/email.ts), so it works
  // without a sign-in. Only POST changes anything (RFC 8058): mail scanners and link previewers open
  // GET links on delivery. GET shows a confirmation page whose button POSTs; a mail client's one-click
  // sends the same POST with `List-Unsubscribe=One-Click`.
  // It turns off the three switches that gate re-engagement email: new lineups, crew re-forms and wrap-ups.
  async function unsubscribeUserId(token: unknown): Promise<string | null> {
    const userId = verifyUnsubscribeToken(token, unsubscribeSecret(config));
    return userId && (await getUserById(userId)) ? userId : null;
  }

  const sendUnsubscribePage = (res: any, status: number, title: string, message: string, form?: UnsubscribeForm, action = OPEN_FESTIE) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).send(_verifyEmailPage(status, title, message, action, 'Unsubscribe', { retryHint: false, form }));
  };
  const INVALID_LINK = 'This unsubscribe link is not valid. You can turn these emails off in your Festie notification settings.';
  const sendInvalidLinkPage = (res: any) => sendUnsubscribePage(res, 400, 'Link not valid', INVALID_LINK, undefined, NOTIFICATION_SETTINGS);

  router.get('/unsubscribe', rateLimit(120, 'email-unsubscribe'), async (req: any, res: any) => {
    try {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (!(await unsubscribeUserId(token))) return sendInvalidLinkPage(res);
      return sendUnsubscribePage(
        res,
        200,
        'Unsubscribe from Festie emails?',
        'This turns off Festie lineup, crew re-form and wrap-up emails and alerts for you.',
        { action: `/api/v1/auth/unsubscribe?token=${encodeURIComponent(token)}&from=page`, label: 'Unsubscribe' },
      );
    } catch (error: any) {
      log.error('unsubscribe failed', { error: error.message });
      return sendUnsubscribePage(res, 500, 'Something went wrong', 'Something went wrong. Please try again.');
    }
  });

  router.post('/unsubscribe', rateLimit(120, 'email-unsubscribe'), async (req: any, res: any) => {
    // The confirmation page marks its form action `from=page`; a mail client's one-click does not and gets JSON.
    const fromPage = req.query.from === 'page';
    try {
      const userId = await unsubscribeUserId(req.query.token);
      if (!userId) {
        return fromPage ? sendInvalidLinkPage(res) : sendError(res, 400, 'Invalid unsubscribe link', ErrorCodes.INVALID_INPUT);
      }
      const prefs = await stores.notificationPrefs.get(userId);
      await stores.notificationPrefs.upsert({ ...prefs, lineupDrops: 0, crewReformed: 0, wrapReady: 0 });
      log.info('email:unsubscribed', { userId });
      return fromPage
        ? sendUnsubscribePage(
            res,
            200,
            'You are unsubscribed',
            'We turned off Festie lineup, crew re-form and wrap-up emails and alerts for you. You can turn them back on in Account, under Notifications.',
          )
        : sendSuccess(res, { unsubscribed: true });
    } catch (error: any) {
      log.error('unsubscribe failed', { error: error.message });
      return fromPage
        ? sendUnsubscribePage(res, 500, 'Something went wrong', 'Something went wrong. Please try again.')
        : sendError(res, 500, 'Something went wrong', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /resend-verification — resend email verification (authenticated) ──
  router.post('/resend-verification', userAuth, rateLimit(2, 'resend-verify'), async (req: any, res: any) => {
    try {
      const user = await getUserById(req.user.userId);
      if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      if (!user.email) return sendError(res, 400, 'No email address on file', ErrorCodes.INVALID_INPUT);
      if (user.emailVerifiedAt) return sendError(res, 400, 'Email already verified', ErrorCodes.INVALID_INPUT);

      // Per-email rate limiting (separate from global endpoint limit)
      const resendLimit = await resendVerifyLimit(user.email);
      if (resendLimit.limited) {
        return sendError(
          res,
          429,
          `Too many verification emails sent to this address. Try again in ${Math.ceil(resendLimit.resetMs / 1000)}s`,
          ErrorCodes.RATE_LIMITED,
        );
      }

      // Invalidate old tokens for this address only; a pending email-change
      // link for another address stays live.
      await stores.emailTokens.invalidateTokensForEmail(req.user.userId, user.email);

      const verifyToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
      await stores.emailTokens.createVerificationToken(
        req.user.userId,
        tokenHash,
        user.email,
        config.EMAIL_VERIFY_TOKEN_TTL_HOURS,
      );
      const verifyUrl = verifyEmailUrl(config, verifyToken);
      const sent = await sendVerificationEmail({ to: user.email, username: user.username, verifyUrl, config, log, redis: deps.redis });
      if (!sent) {
        return sendError(res, 503, 'We could not send the verification email. Try again in a few minutes.', ErrorCodes.SERVICE_UNAVAILABLE);
      }

      return sendSuccess(res, { message: 'Verification email sent' });
    } catch (error: any) {
      log.error('resend-verification failed', { error: error.message });
      return sendError(res, 500, 'Failed to resend verification', ErrorCodes.INTERNAL_ERROR);
    }
  });

  /**
   * Resolve the reset token to a userId by consuming its DB row.
   * Returns { userId } or { error } with status/message/code.
   */
  // TOKEN_EXPIRED lets clients tell a dead link from a weak password without matching text.
  const RESET_LINK_EXPIRED = 'This reset link has expired or was already used';

  const hashResetToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

  async function resolveResetToken(token: string) {
    const tokenHash = hashResetToken(token);

    const consumed = await stores.emailTokens.consumeResetToken(tokenHash);
    if (consumed) return { userId: consumed.user_id };

    return { error: { status: 400, message: RESET_LINK_EXPIRED, code: ErrorCodes.TOKEN_EXPIRED } };
  }

  // POST /reset-password — Validate token and reset password (public, no auth)
  router.post(
    '/reset-password',
    rateLimit(5, 'reset-password'),
    passwordResetRateLimit,
    validate(schemas.resetPasswordPublic),
    async (req: any, res: any) => {
      try {
        const { token, newPassword, confirmPassword } = req.validatedBody;
        if (newPassword !== confirmPassword) {
          return sendError(res, 400, 'Passwords do not match', ErrorCodes.INVALID_INPUT);
        }
        // Look the account up without consuming the link, so the policy can reject a password that
        // contains the username or email and the user can still retry with the same link.
        const live = await stores.emailTokens.findResetToken(hashResetToken(token));
        if (!live) return sendError(res, 400, RESET_LINK_EXPIRED, ErrorCodes.TOKEN_EXPIRED);
        const owner = await getUserById(live.user_id);
        const pwError = checkPasswordPolicy(newPassword, { username: owner?.username, email: owner?.email });
        if (pwError) {
          return sendError(res, 400, pwError, ErrorCodes.INVALID_INPUT);
        }

        const resolved = await resolveResetToken(token);
        if (resolved.error) {
          return sendError(res, resolved.error.status, resolved.error.message, resolved.error.code);
        }
        const { userId: targetUserId } = resolved;

        const user = await getUserById(targetUserId);
        if (!user) {
          return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
        }

        await stores.users.update(targetUserId, { passwordHash: await hashPassword(newPassword) });
        invalidateUserCache();
        if (stores.loginFailures) await stores.loginFailures.reset(targetUserId);
        await invalidateUserSessions(targetUserId);
        // Revoke long-lived refresh tokens so a held token chain cannot
        // mint new sessions after the password reset (H2).
        if (stores.refreshTokens) await stores.refreshTokens.revokeAll(targetUserId);
        // A recovery reset must also kill any pending email-change link: the
        // user reaching for /forgot-password is exactly the user whose session
        // may already have requested a change to an attacker's address.
        await stores.emailTokens.invalidatePendingEmailChanges(targetUserId, user.email ?? null);
        // Retire every other outstanding reset link too, e.g. a "This wasn't me"
        // link alongside a forgot-password one: either could reset again.
        await stores.emailTokens.invalidateResetTokens(targetUserId);
        await disconnectUserSockets(targetUserId, io);

        const auditLog = createAuditLog('user_reset_password', 'user', {
          userId: targetUserId,
          username: user.username,
          ipAddress: getRequestIp(req),
        });
        log.warn('user:reset-password', { ...auditLog });

        return sendSuccess(res, { success: true, message: 'Password reset successfully' });
      } catch (error: any) {
        log.error('reset-password failed', { error: error.message });
        return sendError(res, 500, 'Failed to reset password', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}

// ── Email verification result page ──────────────────────────────────────
type VerifyAction = { label: string; href: string };
const OPEN_FESTIE: VerifyAction = { label: 'Open Festie', href: '/' };
const NOTIFICATION_SETTINGS: VerifyAction = { label: 'Open notification settings', href: '/account' };
// A POST form in place of the link button. `action` is a same-origin path built by the route.
type UnsubscribeForm = { action: string; label: string };

// Colours: Stage from packages/shared/src/tokens/colors.ts, Daylight from
// colorsDaylight.ts (bg.primary, text.primary, text.secondary, accent.aqua).
// `action` carries fixed strings only; `title` too. `message` is escaped.
function _verifyEmailPage(
  status: number,
  title: string,
  message: string,
  action: VerifyAction,
  pageTitle = 'Email Verification',
  { retryHint: showRetryHint = true, form }: { retryHint?: boolean; form?: UnsubscribeForm } = {},
) {
  const success = status < 400;
  // A page with a form asks a question, so it gets a neutral icon instead of a success check.
  const icon = form ? '?' : success ? '&#10003;' : '&#10007;';
  const tone = form ? 'var(--text-2)' : success ? 'var(--ok)' : 'var(--bad)';
  // A 500 is not the link's fault, so it gets no "send another" advice; nor does a page that is not about a sign-in link.
  const retryHint =
    showRetryHint && !success && status !== 500
      ? '<p class="hint">Need a new link? Sign in to Festie and send another from your account.</p>'
      : '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${pageTitle} - Festie</title>
<style>
  :root { --bg: #0a0a0a; --text: #eaeaf2; --text-2: #9999bb; --accent: #00e8d0; --on-accent: #0a0a0a; --ok: ${colors.status.verified}; --bad: ${colors.text.danger}; --card: rgba(255,255,255,0.05); --border: rgba(255,255,255,0.1); }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f4f4f7; --text: #0b0b12; --text-2: #2e2e44; --accent: #00594f; --on-accent: #ffffff; --ok: ${colorsDaylight.status.verified}; --bad: ${colorsDaylight.text.danger}; --card: #ffffff; --border: rgba(0,0,0,0.1); }
  }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--text); font-family: 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; box-sizing: border-box; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 48px 32px; text-align: center; max-width: 400px; width: 100%; box-sizing: border-box; }
  .icon { font-size: 48px; margin-bottom: 16px; color: ${tone}; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  p { color: var(--text-2); font-size: 15px; line-height: 1.6; margin: 0; }
  .btn { display: inline-block; margin-top: 24px; padding: 12px 24px; min-height: 44px; box-sizing: border-box; border-radius: 10px; background: var(--accent); color: var(--on-accent); font-weight: 600; text-decoration: none; }
  button.btn { border: 0; font: inherit; font-weight: 600; cursor: pointer; }
  .btn:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
  .hint { margin-top: 16px; font-size: 13px; }
</style></head>
<body>
<main class="card">
  <div class="icon" aria-hidden="true">${icon}</div>
  <h1>${title}</h1>
  <p>${escapeHtml(message)}</p>
  ${
    form
      ? `<form method="post" action="${escapeHtml(form.action)}"><button class="btn" type="submit">${form.label}</button></form>`
      : `<a class="btn" href="${action.href}">${action.label}</a>`
  }
  ${retryHint}
</main>
</body>
</html>`;
}
