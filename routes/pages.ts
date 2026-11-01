/**
 * Static page routes — crew invite page, password reset redirects, static pages, SPA catch-all
 */
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

import { renderInviteJoinPage, renderInviteErrorPage, INVITE_ERROR_MESSAGES } from '../lib/invite-pages.js';
import { loadInvitePreview } from '../lib/invite-preview.js';

export default function createPageRoutes(deps: any) {
  const {
    express, config, rateLimit, pool, log, stores, getFestivalById,
    _sendError, _ErrorCodes,
  } = deps;

  const router = express.Router();

  // Crew invite page — server-rendered so link scrapers get crew-specific OG
  // tags. No auto-redirect: some scrapers follow a meta refresh and would lose
  // the tags. The Join button opens the app with ?joinCrew=CODE.
  router.get('/join/:code', rateLimit(30, 'crew-invite-page'), async (req: any, res: any) => {
    const code = String(req.params.code || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toUpperCase();
    const origin = config.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    try {
      const result = await loadInvitePreview({ stores, getFestivalById }, code);
      if (result.status === 'ok') {
        return res.status(200).send(renderInviteJoinPage({ ...result.preview, inviteCode: code, origin }));
      }
      return res
        .status(result.status === 'expired' ? 410 : 404)
        .send(renderInviteErrorPage(origin, INVITE_ERROR_MESSAGES[result.status]));
    } catch (error: any) {
      log.error('crew invite page failed', { error: error.message });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(500).send(renderInviteErrorPage(origin, INVITE_ERROR_MESSAGES.failed));
    }
  });

  const EXPIRED_RESET = '/forgot-password?expired=1';
  const isResetToken = (t: string) => /^[a-f0-9]{64}$/.test(t);

  // GET /reset/:token — legacy admin-initiated link. Admin tokens are stored in
  // password_reset_tokens too, so the SPA page below checks both kinds.
  router.get('/reset/:token', rateLimit(config.AUTH_RATE_LIMIT_MAX, 'reset-form'), (req: any, res: any) => {
    const token = String(req.params.token || '').trim();
    if (!isResetToken(token)) return res.redirect(303, EXPIRED_RESET);
    return res.redirect(302, `/reset-password?token=${token}`);
  });

  // GET /reset-password — checks the emailed link, then hands a valid one to the
  // SPA route; a dead link goes straight to forgot-password with a notice.
  router.get('/reset-password', rateLimit(10, 'reset-page'), async (req: any, res: any, next: any) => {
    const token = String(req.query.token || '').trim();
    if (!isResetToken(token)) return res.redirect(303, EXPIRED_RESET);
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const result = await pool.query(
        'SELECT id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()',
        [tokenHash],
      );
      if (result.rows.length === 0) return res.redirect(303, EXPIRED_RESET);
      res.setHeader('Cache-Control', 'no-store');
      return next();
    } catch (error: any) {
      // The SPA form still works; its POST reports a bad token.
      log.error('reset-password page error', { error: error.message });
      return next();
    }
  });

  // Static page routes (serve HTML files without .html extension)
  router.get('/privacy', (req: any, res: any) => res.sendFile(path.join(config.PUBLIC_DIR, 'privacy.html')));
  router.get('/terms', (req: any, res: any) => res.sendFile(path.join(config.PUBLIC_DIR, 'terms.html')));
  router.get('/security-whitepaper', (req: any, res: any) => res.sendFile(path.join(config.PUBLIC_DIR, 'security-whitepaper.html')));

  // SPA fallback - serve index.html for non-API, non-static routes.
  // Prefer React dist/index.html when the Vite build exists; fall back
  // to legacy public/index.html otherwise.
  // ponytail: config.WEB_DIST is the prod source (set by loadConfig); the || keeps
  // partial/test configs from throwing on path.join(undefined).
  const webDist = config.WEB_DIST || path.join(config.PUBLIC_DIR, '..', 'packages', 'web', 'dist');
  const _reactIndex = path.join(webDist, 'index.html');
  const _spaIndex = fs.existsSync(_reactIndex) ? _reactIndex : path.join(config.PUBLIC_DIR, 'index.html');
  router.get('/{*splat}', (req: any, res: any, next: any) => {
    if (req.path.startsWith('/uploads/')) {
      return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(_spaIndex, (err: any) => {
      if (err && !res.headersSent) next(err);
    });
  });

  return router;
}
