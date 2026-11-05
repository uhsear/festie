/**
 * Static page routes — crew invite page, public festival page, password reset
 * redirects, static pages, SPA catch-all
 */
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

import sharp from 'sharp';

import { festivalDateRange, renderFestivalNotFoundPage, renderFestivalPage } from '../lib/festival-page.js';
import { buildFestivalOgSvg } from '../lib/helpers/share-og-image.js';
import { renderInviteJoinPage, renderInviteErrorPage, renderInviteIcs, INVITE_ERROR_MESSAGES } from '../lib/invite-pages.js';
import { loadInvitePreview } from '../lib/invite-preview.js';

// Public festival page slug (migration 094). Checked before any query; upper case fails too.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isFestivalSlug = (slug: string) => slug.length <= 80 && SLUG_RE.test(slug);
const STATIC_ASSET_PATH = /\.(?:txt|xml|json|map|js|css|png|jpe?g|gif|webp|svg|ico|woff2?|webmanifest)$/i;

export default function createPageRoutes(deps: any) {
  const {
    express, config, rateLimit, pool, log, stores, getFestivalById,
    _sendError, _ErrorCodes,
  } = deps;

  const router = express.Router();

  const INVITE_ERROR_STATUS = { expired: 410, invalid: 404, locked: 403 } as const;
  const cleanInviteCode = (raw: unknown) =>
    String(raw || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toUpperCase();
  const requestOrigin = (req: any) => config.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;

  // Crew invite page — server-rendered so link scrapers get crew-specific OG
  // tags. No auto-redirect: some scrapers follow a meta refresh and would lose
  // the tags. The Join button opens the app with ?joinCrew=CODE.
  router.get('/join/:code', rateLimit(30, 'crew-invite-page'), async (req: any, res: any) => {
    const code = cleanInviteCode(req.params.code);
    const origin = requestOrigin(req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    try {
      const result = await loadInvitePreview({ stores, getFestivalById }, code);
      if (result.status === 'ok') {
        return res.status(200).send(renderInviteJoinPage({ ...result.preview, inviteCode: code, origin }));
      }
      return res
        .status(INVITE_ERROR_STATUS[result.status])
        .send(renderInviteErrorPage(origin, INVITE_ERROR_MESSAGES[result.status]));
    } catch (error: any) {
      log.error('crew invite page failed', { error: error.message });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(500).send(renderInviteErrorPage(origin, INVITE_ERROR_MESSAGES.failed));
    }
  });

  // "Save for later": one all-day calendar event for the festival dates. Express
  // 5 params never match '/', so /join/:code above cannot shadow this route.
  // no-store, so a lock or a new code applies at once. Anything but a usable,
  // dated invite goes back to the invite page, which explains why.
  router.get('/join/:code/save.ics', rateLimit(30, 'crew-invite-page'), async (req: any, res: any) => {
    const code = cleanInviteCode(req.params.code);
    const origin = requestOrigin(req);
    const fallback = code ? `/join/${encodeURIComponent(code)}` : '/';
    try {
      const result = await loadInvitePreview({ stores, getFestivalById }, code);
      if (result.status !== 'ok' || !result.preview.startDate || !result.preview.endDate) {
        return res.redirect(302, fallback);
      }
      const { festivalName, crewName, startDate, endDate } = result.preview;
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="festie-invite.ics"');
      res.setHeader('Cache-Control', 'no-store');
      return res
        .status(200)
        .send(renderInviteIcs({ festivalName, crewName, startDate, endDate, inviteCode: code, origin }));
    } catch (error: any) {
      log.error('crew invite ics failed', { error: error.message });
      return res.redirect(302, fallback);
    }
  });

  // The festival behind a public slug: published and not archived, else null.
  // Never look up by id first: getFestivalById alone also returns drafts.
  async function loadPublicFestival(slug: string) {
    if (!isFestivalSlug(slug)) return null;
    const id = await stores.festivals.findPublicIdBySlug(slug);
    return id ? getFestivalById(id) : null;
  }

  // Public festival page. Owner decision 2026-11-02: shareable by link but
  // noindex, with no sitemap entry, until a legal check clears indexing.
  router.get('/f/:slug', rateLimit(60, 'festival-page'), async (req: any, res: any) => {
    const slug = String(req.params.slug || '');
    const origin = config.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    res.setHeader('X-Robots-Tag', 'noindex');
    try {
      const festival = await loadPublicFestival(slug);
      if (!festival) {
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.status(404).send(renderFestivalNotFoundPage(origin));
      }
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).send(renderFestivalPage({ festival, origin, slug }));
    } catch (error: any) {
      log.error('festival page failed', { error: error.message, slug });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(500).send(renderFestivalNotFoundPage(origin));
    }
  });

  router.get('/f/:slug/og.png', rateLimit(30, 'festival-og'), async (req: any, res: any) => {
    try {
      const festival = await loadPublicFestival(String(req.params.slug || ''));
      // Crawlers need no HTML error page.
      if (!festival) return res.status(404).end();
      const days = festival.days || [];
      const svg = buildFestivalOgSvg({
        festivalName: festival.name,
        dateRange: festivalDateRange(festival),
        location: festival.location || '',
        setCount: days.reduce((sum: number, day: any) => sum + (day?.sets?.length || 0), 0),
        stageCount: (festival.stages || []).length,
      });
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(png);
    } catch (error: any) {
      log.error('festival og render failed', { error: error.message, slug: req.params.slug });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(500).end();
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
    // A missing asset (robots.txt, a stale hashed chunk) must not come back as a 200 HTML shell.
    if (STATIC_ASSET_PATH.test(req.path)) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(404).send('Not found');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(_spaIndex, (err: any) => {
      if (err && !res.headersSent) next(err);
    });
  });

  return router;
}
