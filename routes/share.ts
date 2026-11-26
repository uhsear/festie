// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Shareable Pick Links — Public read-only profile view
 *
 * GET /s/:shareId — Renders an HTML page showing a user's picks for a festival.
 * No auth required. Profile must exist and have a non-null userId.
 *
 * The share id is the profile's revocable share_token (POST /account/share-link).
 * Legacy profile-id links no longer resolve (T57). Pages are `private, no-cache`
 * so a reset (POST /account/sharing/reset) takes effect at once, even behind the CDN.
 *
 * GET /s/:shareId/og.png and /s/u/:username/og.png render the link-preview
 * image; GET /s/:shareId/json and /s/u/:username/json feed the compare page.
 */

import sharp from 'sharp';
import type { Request, Response } from 'express';
import type { RouteDeps } from '../lib/types';

import { colors } from '../packages/shared/src/tokens/colors';
import { colorsDaylight } from '../packages/shared/src/tokens/colorsDaylight';
import { designCss, festieLockupHtml, headSnippet } from '../lib/design-css.js';
import { dayHeadingDate } from '../lib/festival-page.js';
import { escapeHtml } from '../lib/helpers/sanitize.js';
import {
  buildEventJsonLd,
  getStageColorById,
  getStageNameById,
  sanitizeColor,
  shareTimeText,
} from '../lib/helpers/public-page.js';
import { validateUsername } from '../lib/helpers/validation.js';
import { buildShareOgSvg, pickOgArtists } from '../lib/helpers/share-og-image.js';
import { festivalStartMinutes } from '../lib/time-zone.js';

export default function createShareRoutes(deps: RouteDeps) {
  const {
    express, log, config,
    stores, getFestivalById, getUserById,
    buildAvatarUrl, rateLimit,
    sendSuccess, sendError, ErrorCodes,
  } = deps;

  const router = express.Router();

  // Envelope exception (see lib/response.ts): the HTML pages (/u/:username, /:profileId) and
  // the og.png handlers serve browsers and link-preview crawlers, so they send their own bodies,
  // not sendSuccess. The two /json routes are API routes and do use sendSuccess.
  function sendShareError(res: Response, status: any, title: any, message: any) {
    res.status(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', SHARE_CSP);
    return res.send(renderShareErrorPage(title, message, config.PUBLIC_ORIGIN || '/'));
  }

  // Express already URL-decodes the param. Accepts what validateUsername accepts
  // (single spaces between words), lowercased. Null when invalid.
  function vanityUsername(raw: unknown) {
    const username = String(raw || '').trim().toLowerCase();
    return validateUsername(username) ? username : null;
  }

  // The newest profile of a public user. Private users answer exactly like a
  // nonexistent one ('no-user'), so no response reveals the account.
  async function findVanityProfile(username: string): Promise<{ profileId?: string; missing?: 'no-user' | 'no-profile' }> {
    // Look up user by username (case-insensitive, targeted query)
    const user = await stores.users.getByUsername(username);
    if (!user || !user.publicSchedule) return { missing: 'no-user' };
    const newest = await stores.shareLinks.newestProfile(user.id);
    return newest ? { profileId: newest.profileId } : { missing: 'no-profile' };
  }

  // GET /u/:username/og.png and /:shareId/og.png — link-preview image. Same
  // lookups as the page, so a reset link also stops its image.
  router.get('/u/:username/og.png', rateLimit(30, 'share-og'), async (req: Request, res: Response) => {
    try {
      const username = vanityUsername(req.params.username);
      if (!username) return res.status(400).end();
      const found = await findVanityProfile(username);
      if (!found.profileId) return res.status(404).end();
      return await sendShareOg(res, found.profileId);
    } catch (error) {
      log.error('share og render failed', { error: (error as NodeJS.ErrnoException).message, username: req.params.username });
      return res.status(500).end();
    }
  });

  router.get('/:shareId/og.png', rateLimit(30, 'share-og'), async (req: Request, res: Response) => {
    try {
      const shareId = String(req.params.shareId || '').trim();
      if (!isValidShareId(shareId)) return res.status(400).end();
      const profileId = await stores.shareLinks.findProfileId(shareId);
      if (!profileId) return res.status(404).end();
      return await sendShareOg(res, profileId);
    } catch (error) {
      log.error('share og render failed', { error: (error as NodeJS.ErrnoException).message, shareId: req.params.shareId });
      return res.status(500).end();
    }
  });

  // GET /u/:username/json — JSON mirror of the vanity page, with the same checks.
  router.get('/u/:username/json', rateLimit(30, 'share-json'), async (req: Request, res: Response) => {
    try {
      const username = vanityUsername(req.params.username);
      if (!username) {
        return sendError(res, 400, 'Invalid share link', ErrorCodes.INVALID_INPUT);
      }
      const found = await findVanityProfile(username);
      if (!found.profileId) {
        return sendError(res, 404, 'Schedule not found', ErrorCodes.NOT_FOUND);
      }
      return await sendProfileJson(res, found.profileId);
    } catch (error) {
      log.error('vanity share json error', { error: (error as NodeJS.ErrnoException).message, username: req.params.username });
      return sendError(res, 500, 'Failed to load schedule', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // GET /u/:username — opt-in vanity page. Renders in place: a redirect would
  // leak the revocable token, or break after a reset.
  router.get('/u/:username', rateLimit(30, 'share'), async (req: Request, res: Response) => {
    try {
      const username = vanityUsername(req.params.username);
      if (!username) {
        return sendShareError(res, 400, 'We cannot open that link', 'This share link is not valid.');
      }

      const found = await findVanityProfile(username);
      if (found.missing === 'no-user') {
        return sendShareError(res, 404, 'We cannot find that user', 'No account with this username exists.');
      }
      if (!found.profileId) {
        return sendShareError(res, 404, 'No schedule yet', 'This user hasn\'t joined a festival yet.');
      }
      return await renderProfileShare(req, res, found.profileId, `u/${username}`);
    } catch (error) {
      log.error('vanity share lookup failed', { error: (error as NodeJS.ErrnoException).message, username: req.params.username });
      return sendError(res, 500, 'Failed to load schedule', ErrorCodes.INTERNAL_ERROR);
    }
  });

  function buildShareDays(festival: any, picks: any) {
    const pickedSetIds = new Set(Object.keys(picks));
    return (festival.days || []).map((day: any, dayIndex: any) => {
      const daySets = (day.sets || [])
        .filter((set: any) => pickedSetIds.has(set.id))
        .map((set: any) => ({
          artist: escapeHtml(set.artist),
          timeText: escapeHtml(shareTimeText(set.startTime, set.endTime)),
          stage: escapeHtml(getStageNameById(festival.stages, set.stageId)),
          stageColor: sanitizeColor(getStageColorById(festival.stages, set.stageId)),
          startTime: escapeHtml(set.startTime || ''),
          priority: picks[set.id] || 'want-to-see',
        }))
        .sort(
          (a: any, b: any) =>
            (a.startTime ? festivalStartMinutes(a.startTime) : Number.MAX_SAFE_INTEGER) -
            (b.startTime ? festivalStartMinutes(b.startTime) : Number.MAX_SAFE_INTEGER),
        );
      return { label: escapeHtml(day.label || `Day ${dayIndex + 1}`), date: escapeHtml(dayHeadingDate(day.date)), sets: daySets };
    }).filter((day: any) => day.sets.length > 0);
  }

  function buildPickStats(picks: any) {
    const values = Object.values(picks);
    return {
      totalPicks: Object.keys(picks).length,
      mustCount: values.filter((v) => v === 'must').length,
      wantCount: values.filter((v) => v === 'want-to-see').length,
      maybeCount: values.filter((v) => v === 'maybe').length,
    };
  }

  function shareOrigin(req: Request) {
    return config.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
  }

  function isValidShareId(id: string) {
    return Boolean(id) && id.length <= 100 && /^[a-zA-Z0-9_-]+$/.test(id);
  }

  const SCHEDULE_NOT_FOUND = 'This schedule may have been removed or the link is incorrect. If someone sent you this link, ask them for a new one.';

  // The shared profile and its festival; profile is null when missing or not owned by a user.
  async function loadShare(profileId: string) {
    const profile = await stores.profiles.getById(profileId);
    if (!profile || !profile.userId) return { profile: null, festival: null };
    return { profile, festival: await getFestivalById(profile.festivalId) };
  }

  // shareRef is the part after /s/: a share token, or `u/<username>` for the vanity page.
  async function renderProfileShare(req: Request, res: Response, profileId: string, shareRef: string) {
    const { profile, festival } = await loadShare(profileId);
    if (!profile) {
      return sendShareError(res, 404, 'We cannot find that schedule', SCHEDULE_NOT_FOUND);
    }
    if (!festival) {
      return sendShareError(res, 404, 'We cannot find that festival', 'The festival for this schedule no longer exists.');
    }

    const user = await getUserById(profile.userId);
    const picks = profile.picks || {};
    const origin = shareOrigin(req);
    const shareUrl = `${origin}/s/${shareRef.split('/').map(encodeURIComponent).join('/')}`;
    const ogUrl = `${shareUrl}/og.png`;
    const username = user?.username || profile.name || 'Anonymous';
    const stats = buildPickStats(picks);
    const compareUrl = `${origin}/friend-picks?from=${encodeURIComponent(shareRef)}`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Not cacheable by the CDN, so a link reset takes effect at once.
    res.setHeader('Cache-Control', 'private, no-cache');
    // Shared links keep working, but must never be indexed by search engines.
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Content-Security-Policy', SHARE_CSP);
    return res.send(renderSharePage({
      username: escapeHtml(username),
      avatarUrl: escapeHtml(buildAvatarUrl(user) || ''),
      festivalName: escapeHtml(festival.name),
      festivalLocation: escapeHtml(festival.location || ''),
      days: buildShareDays(festival, picks),
      ...stats,
      origin: escapeHtml(origin),
      shareUrl: escapeHtml(shareUrl),
      ogUrl: escapeHtml(ogUrl),
      ogAlt: escapeHtml(`${username}'s picks for ${festival.name}`),
      jsonLd: buildEventJsonLd(festival, { shareUrl, ogUrl, description: shareDescription(stats) }),
      compareUrl: escapeHtml(compareUrl),
      addUrl: escapeHtml(`${compareUrl}#add`),
      appUrl: escapeHtml(`festie://friend-picks?from=${encodeURIComponent(shareRef)}`),
    }));
  }

  async function sendShareOg(res: Response, profileId: string) {
    const { profile, festival } = await loadShare(profileId);
    // Crawlers need no HTML error page.
    if (!profile || !festival) return res.status(404).end();

    const user = await getUserById(profile.userId);
    const picks = profile.picks || {};
    const { totalPicks, mustCount } = buildPickStats(picks);
    const svg = buildShareOgSvg({
      username: user?.username || profile.name || 'Anonymous',
      festivalName: festival.name,
      location: festival.location || '',
      artists: pickOgArtists(festival, picks, festival.b2bSeparator || 'b2b'),
      total: totalPicks,
      must: mustCount,
    });
    const png = await sharp(Buffer.from(svg)).png().toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Robots-Tag', 'noindex');
    return res.send(png);
  }

  async function sendProfileJson(res: Response, profileId: string) {
    const { profile, festival } = await loadShare(profileId);
    if (!profile) {
      return sendError(res, 404, 'Schedule not found', ErrorCodes.NOT_FOUND);
    }
    if (!festival) {
      return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
    }

    const user = await getUserById(profile.userId);
    const username = user?.username || profile.name || 'Anonymous';

    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Robots-Tag', 'noindex');
    return sendSuccess(res, {
      username,
      festivalName: festival.name,
      festivalId: festival.id,
      picks: profile.picks || {},
      festival: {
        stages: festival.stages,
        days: festival.days,
        b2bSeparator: festival.b2bSeparator ?? null,
      },
    });
  }

  // GET /s/:shareId — public share page (rate limited to prevent scraping)
  router.get('/:profileId', rateLimit(30, 'share'), async (req: Request, res: Response) => {
    try {
      const shareId = String(req.params.profileId || '').trim();
      if (!isValidShareId(shareId)) {
        return sendShareError(res, 400, 'We cannot open that link', 'This share link is not valid.');
      }

      const profileId = await stores.shareLinks.findProfileId(shareId);
      if (!profileId) {
        return sendShareError(res, 404, 'We cannot find that schedule', SCHEDULE_NOT_FOUND);
      }
      return await renderProfileShare(req, res, profileId, shareId);
    } catch (error) {
      log.error('share page error', { error: (error as NodeJS.ErrnoException).message, profileId: req.params.profileId });
      return sendError(res, 500, 'Failed to load schedule', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // JSON API for share data (rate limited to prevent scraping)
  router.get('/:profileId/json', rateLimit(30, 'share-json'), async (req: Request, res: Response) => {
    try {
      const shareId = String(req.params.profileId || '').trim();
      if (!isValidShareId(shareId)) {
        return sendError(res, 400, 'Invalid share link', ErrorCodes.INVALID_INPUT);
      }

      const profileId = await stores.shareLinks.findProfileId(shareId);
      if (!profileId) {
        return sendError(res, 404, 'Schedule not found', ErrorCodes.NOT_FOUND);
      }
      return await sendProfileJson(res, profileId);
    } catch (error) {
      log.error('share json error', { error: (error as NodeJS.ErrnoException).message, profileId: req.params.profileId });
      return sendError(res, 500, 'Failed to load schedule', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}

// ── Helpers ──────────────────────────────────────────────────────────

function shareDescription({ mustCount, wantCount, maybeCount, totalPicks }: any) {
  return `${mustCount} must-see, ${wantCount} want-to-see, ${maybeCount} maybe - ${totalPicks} total picks`;
}

function priorityLabel(priority: any) {
  return ({ must: 'Must See', 'want-to-see': 'Want to See', maybe: 'Maybe' } as any)[priority] || priority;
}

const PRIORITY_KEYS = { must: 'must', 'want-to-see': 'want', maybe: 'maybe' } as const;

/** The colour of a pick priority, as a CSS custom property that follows the page theme. */
function priorityColor(priority: any) {
  return `var(--pr-${PRIORITY_KEYS[priority as keyof typeof PRIORITY_KEYS] ?? 'maybe'})`;
}

const priorityVars = (p: Record<'must' | 'want' | 'maybe', string>) => `--pr-must: ${p.must}; --pr-want: ${p.want}; --pr-maybe: ${p.maybe};`;

/** Priority colours straight from the tokens, so Want is aqua and Maybe is amber here as in the app. */
export const sharePriorityCss = `:root { ${priorityVars(colors.priority)} }
@media (prefers-color-scheme: light) { :root { ${priorityVars(colorsDaylight.priority)} } }`;

const SHARE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; font-src 'self'; frame-ancestors 'none'";

const HEAD_SNIPPET = headSnippet.split('\n').join('\n  ');

const SHARE_STYLE = `
.share-container { max-width: 37.5rem; margin: 0 auto; padding: 1.25rem 1rem 2rem; }
.share-header { padding: 1.5rem 0; border-bottom: 1px solid var(--ds-border); margin-bottom: 1.25rem; }
.share-container > .ds-lockup { margin-bottom: 0.5rem; }
.share-avatar { width: 4rem; height: 4rem; border-radius: 50%; margin-bottom: 0.75rem; overflow: hidden; background: var(--ds-border); }
.share-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; outline: 1px solid var(--ds-border); outline-offset: -1px; }
h1.share-username { margin: 0 0 0.25rem; font-size: 2rem; line-height: 1.1; overflow-wrap: anywhere; }
.share-festival { font-size: 1rem; font-weight: 600; }
.share-location { font-size: 0.875rem; color: var(--ds-text-secondary); }
.share-stats { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 1rem; font-size: 0.875rem; }
.share-stat { display: flex; align-items: center; gap: 0.375rem; }
.share-stat-dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; display: inline-block; }
.share-day { margin-bottom: 1.5rem; }
.share-day h2 { margin: 0 0 0.5rem; padding: 0.5rem 0; font-size: 1.125rem; border-bottom: 1px solid var(--ds-border); }
.share-date { font-weight: 400; color: var(--ds-text-secondary); font-size: 0.875rem; }
.share-sets { display: flex; flex-direction: column; gap: 0.375rem; }
.share-set { background: var(--ds-card); border: 1px solid var(--ds-border); border-radius: 0.5rem; padding: 0.625rem 0.75rem; }
.share-set-time { font-size: 0.8125rem; color: var(--ds-text-secondary); font-weight: 500; font-variant-numeric: tabular-nums; }
.share-set-artist { font-size: 1rem; font-weight: 600; margin: 0.125rem 0; overflow-wrap: anywhere; }
.share-set-meta { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.8125rem; }
.share-stage { color: var(--ds-text-secondary); }
.share-priority { font-weight: 600; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.04em; }
.share-cta { display: flex; flex-direction: column; align-items: stretch; gap: 0.5rem; padding: 1.5rem 0; margin-top: 1rem; border-top: 1px solid var(--ds-border); text-align: center; }
.share-cta .ds-cta-outline { background: transparent; color: var(--ds-text); border: 1px solid var(--ds-border); }
.share-cta p { margin: 0; font-size: 0.875rem; color: var(--ds-text-secondary); }
.share-link { display: inline-flex; align-items: center; min-height: 2.75rem; color: var(--ds-text); font-weight: 600; text-decoration: underline; text-underline-offset: 0.25em; }
.share-empty { padding: 2.5rem 0; color: var(--ds-text-secondary); }
.error-box { max-width: 26rem; margin: 0 auto; padding: 3rem 1.5rem; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 1rem; }
.error-box h1 { margin: 0; font-size: 2rem; line-height: 1.1; }
.error-msg { margin: 0; color: var(--ds-text-secondary); }`;

export function renderShareErrorPage(title: string, message: string, origin: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="robots" content="noindex">
  ${HEAD_SNIPPET}
  <style>${designCss}
${SHARE_STYLE}
  </style>
</head>
<body>
  <main class="error-box">
    ${festieLockupHtml(origin)}
    <h1>${escapeHtml(title)}</h1>
    <p class="error-msg">${escapeHtml(message)}</p>
    <a class="ds-cta error-btn" href="${escapeHtml(origin)}">Open Festie</a>
  </main>
</body>
</html>`;
}

export function renderSharePage({ username, avatarUrl, festivalName, festivalLocation, days, totalPicks, mustCount, wantCount, maybeCount, origin, shareUrl, ogUrl, ogAlt, jsonLd, compareUrl, addUrl, appUrl }: any) {
  const dayHtml = days.map((day: any) => `
    <section class="share-day">
      <h2>${day.label}${day.date ? ` <span class="share-date">${day.date}</span>` : ''}</h2>
      <div class="share-sets">
        ${day.sets.map((set: any) => `
          <div class="share-set" style="border-left: 3px solid ${set.stageColor}">
            <div class="share-set-time">${set.timeText}</div>
            <div class="share-set-artist">${set.artist}</div>
            <div class="share-set-meta">
              <span class="share-stage">${set.stage}</span>
              <span class="share-priority" style="color: ${priorityColor(set.priority)}">${priorityLabel(set.priority)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </section>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${username}'s ${festivalName} Schedule</title>
  <meta name="description" content="${username}'s picks for ${festivalName} - ${totalPicks} sets selected">
  <meta property="og:title" content="${username}'s ${festivalName} picks">
  <meta property="og:description" content="${shareDescription({ mustCount, wantCount, maybeCount, totalPicks })}">
  <meta property="og:url" content="${shareUrl}">
  <meta property="og:type" content="website">
  ${HEAD_SNIPPET}
  <meta property="og:site_name" content="Festie">
  <meta property="og:image" content="${ogUrl}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${ogAlt}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${ogUrl}">
  <script type="application/ld+json">${jsonLd}</script>
  <style>${designCss}
${sharePriorityCss}
${SHARE_STYLE}
  </style>
</head>
<body>
  <main class="share-container">
    ${festieLockupHtml(origin)}
    <header class="share-header">
      ${avatarUrl ? `<div class="share-avatar"><img src="${avatarUrl}" alt="" loading="lazy"></div>` : ''}
      <h1 class="share-username">${username}</h1>
      <div class="share-festival">${festivalName}</div>
      ${festivalLocation ? `<div class="share-location">${festivalLocation}</div>` : ''}
      <div class="share-stats">
        <span class="share-stat"><span class="share-stat-dot" style="background:${priorityColor('must')}"></span> ${mustCount} must</span>
        <span class="share-stat"><span class="share-stat-dot" style="background:${priorityColor('want-to-see')}"></span> ${wantCount} want</span>
        <span class="share-stat"><span class="share-stat-dot" style="background:${priorityColor('maybe')}"></span> ${maybeCount} maybe</span>
      </div>
    </header>

    ${totalPicks === 0
      ? '<div class="share-empty"><p>No picks saved yet.</p></div>'
      : dayHtml
    }

    <div class="share-cta">
      <a class="ds-cta" href="${compareUrl}">Compare with my picks</a>
      <a class="ds-cta ds-cta-outline" href="${addUrl}">Add their picks to my plan</a>
      <p>Have the Festie app? <a class="share-link" href="${appUrl}">Open in the app</a></p>
      <p><a class="share-link" href="${origin}/?ref=share-picks">New to Festie? Plan your own schedule</a></p>
    </div>
  </main>
</body>
</html>`;
}
