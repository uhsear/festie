// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Shareable Pick Links — Public read-only profile view
 *
 * GET /s/:shareId — Renders an HTML page showing a user's picks for a festival.
 * No auth required. Profile must exist and have a non-null userId.
 *
 * The share id is the profile's revocable share_token (POST /account/share-link).
 * A legacy profile-id link still resolves until the owner resets their links
 * (POST /account/sharing/reset). Pages are `private, no-cache` so a reset takes
 * effect at once, even behind the CDN.
 *
 * GET /s/:shareId/og.png and /s/u/:username/og.png render the link-preview
 * image; GET /s/:shareId/json and /s/u/:username/json feed the compare page.
 */

import sharp from 'sharp';

import { festivalTint } from '../lib/festival-tint.js';
import { escapeHtml } from '../lib/helpers/sanitize.js';
import {
  buildEventJsonLd,
  getStageColorById,
  getStageNameById,
  sanitizeColor,
  shareTimeText,
} from '../lib/helpers/public-page.js';
import { buildShareOgSvg, pickOgArtists } from '../lib/helpers/share-og-image.js';
import { festivalStartMinutes } from '../lib/time-zone.js';

export default function createShareRoutes(deps: any) {
  const {
    express, log, config,
    stores, getFestivalById, getUserById,
    buildAvatarUrl, rateLimit,
    sendSuccess, sendError, ErrorCodes,
  } = deps;

  const router = express.Router();

  function sendShareError(res: any, status: any, title: any, message: any) {
    res.status(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    return res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0f;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}.error-box{text-align:center;padding:40px 24px;max-width:400px}.error-icon{font-size:48px;margin-bottom:16px;opacity:.5}.error-title{font-size:20px;font-weight:700;margin-bottom:8px}.error-msg{font-size:14px;color:#888;margin-bottom:24px}.error-btn{display:inline-block;background:#ff3366;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px}.error-btn:hover{background:#e62e5c}</style></head><body><div class="error-box"><div class="error-icon">🎵</div><div class="error-title">${escapeHtml(title)}</div><div class="error-msg">${escapeHtml(message)}</div><a class="error-btn" href="${escapeHtml(config.PUBLIC_ORIGIN || '/')}">Go to Festie</a></div></body></html>`);
  }

  // Sanitize username: lowercase, alphanumeric + underscore + hyphen, max 30 chars. Null when invalid.
  function vanityUsername(raw: unknown) {
    const username = String(raw || '').trim().toLowerCase();
    return username && username.length <= 30 && /^[a-z0-9_-]+$/.test(username) ? username : null;
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
  router.get('/u/:username/og.png', rateLimit(30, 'share-og'), async (req: any, res: any) => {
    try {
      const username = vanityUsername(req.params.username);
      if (!username) return res.status(400).end();
      const found = await findVanityProfile(username);
      if (!found.profileId) return res.status(404).end();
      return await sendShareOg(res, found.profileId);
    } catch (error: any) {
      log.error('share og render failed', { error: error.message, username: req.params.username });
      return res.status(500).end();
    }
  });

  router.get('/:shareId/og.png', rateLimit(30, 'share-og'), async (req: any, res: any) => {
    try {
      const shareId = String(req.params.shareId || '').trim();
      if (!isValidShareId(shareId)) return res.status(400).end();
      const profileId = await stores.shareLinks.findProfileId(shareId);
      if (!profileId) return res.status(404).end();
      return await sendShareOg(res, profileId);
    } catch (error: any) {
      log.error('share og render failed', { error: error.message, shareId: req.params.shareId });
      return res.status(500).end();
    }
  });

  // GET /u/:username/json — JSON mirror of the vanity page, with the same checks.
  router.get('/u/:username/json', rateLimit(30, 'share-json'), async (req: any, res: any) => {
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
    } catch (error: any) {
      log.error('vanity share json error', { error: error.message, username: req.params.username });
      return sendError(res, 500, 'Failed to load schedule', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // GET /u/:username — opt-in vanity page. Renders in place: a redirect would
  // leak the revocable token, or break after a reset.
  router.get('/u/:username', rateLimit(30, 'share'), async (req: any, res: any) => {
    try {
      const username = vanityUsername(req.params.username);
      if (!username) {
        return sendShareError(res, 400, 'Invalid Link', 'This share link is not valid.');
      }

      const found = await findVanityProfile(username);
      if (found.missing === 'no-user') {
        return sendShareError(res, 404, 'User Not Found', 'No account with this username exists.');
      }
      if (!found.profileId) {
        return sendShareError(res, 404, 'No Schedule Yet', 'This user hasn\'t joined a festival yet.');
      }
      return await renderProfileShare(req, res, found.profileId, `u/${username}`);
    } catch (error: any) {
      log.error('vanity share lookup failed', { error: error.message, username: req.params.username });
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
      return { label: escapeHtml(day.label || `Day ${dayIndex + 1}`), date: day.date || '', sets: daySets };
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

  function shareOrigin(req: any) {
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
  async function renderProfileShare(req: any, res: any, profileId: string, shareRef: string) {
    const { profile, festival } = await loadShare(profileId);
    if (!profile) {
      return sendShareError(res, 404, 'Schedule Not Found', SCHEDULE_NOT_FOUND);
    }
    if (!festival) {
      return sendShareError(res, 404, 'Festival Not Found', 'The festival for this schedule no longer exists.');
    }

    const user = await getUserById(profile.userId);
    const picks = profile.picks || {};
    const origin = shareOrigin(req);
    const shareUrl = `${origin}/s/${shareRef}`;
    const ogUrl = `${shareUrl}/og.png`;
    const username = user?.username || profile.name || 'Anonymous';
    const stats = buildPickStats(picks);
    const compareUrl = `${origin}/friend-picks?from=${encodeURIComponent(shareRef)}`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Not cacheable by the CDN, so a link reset takes effect at once.
    res.setHeader('Cache-Control', 'private, no-cache');
    // Shared links keep working, but must never be indexed by search engines.
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; frame-ancestors 'none'");
    return res.send(renderSharePage({
      username: escapeHtml(username),
      avatarUrl: escapeHtml(buildAvatarUrl(user) || ''),
      festivalName: escapeHtml(festival.name),
      tint: festivalTint(festival.name),
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

  async function sendShareOg(res: any, profileId: string) {
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

  async function sendProfileJson(res: any, profileId: string) {
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
  router.get('/:profileId', rateLimit(30, 'share'), async (req: any, res: any) => {
    try {
      const shareId = String(req.params.profileId || '').trim();
      if (!isValidShareId(shareId)) {
        return sendShareError(res, 400, 'Invalid Link', 'This share link is not valid.');
      }

      const profileId = await stores.shareLinks.findProfileId(shareId);
      if (!profileId) {
        return sendShareError(res, 404, 'Schedule Not Found', SCHEDULE_NOT_FOUND);
      }
      return await renderProfileShare(req, res, profileId, shareId);
    } catch (error: any) {
      log.error('share page error', { error: error.message, profileId: req.params.profileId });
      return sendError(res, 500, 'Failed to load schedule', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // JSON API for share data (rate limited to prevent scraping)
  router.get('/:profileId/json', rateLimit(30, 'share-json'), async (req: any, res: any) => {
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
    } catch (error: any) {
      log.error('share json error', { error: error.message, profileId: req.params.profileId });
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

function priorityColor(priority: any) {
  return ({ must: '#ff3366', 'want-to-see': '#ffaa00', maybe: '#888' } as any)[priority] || '#888';
}

function renderSharePage({ username, avatarUrl, festivalName, tint, festivalLocation, days, totalPicks, mustCount, wantCount, maybeCount, origin, shareUrl, ogUrl, ogAlt, jsonLd, compareUrl, addUrl, appUrl }: any) {
  const dayHtml = days.map((day: any) => `
    <div class="share-day">
      <h3>${day.label}${day.date ? ` <span class="share-date">${day.date}</span>` : ''}</h3>
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
    </div>
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
  <meta name="theme-color" content="#080810">
  <meta property="og:site_name" content="Festie">
  <meta property="og:image" content="${ogUrl}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${ogAlt}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${ogUrl}">
  <script type="application/ld+json">${jsonLd}</script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: ${tint.bg};
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      min-height: 100vh;
    }
    .share-container {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px 16px;
    }
    .share-header {
      text-align: center;
      padding: 24px 0;
      border-top: 4px solid ${tint.active};
      border-bottom: 1px solid rgba(255,255,255,0.1);
      margin-bottom: 20px;
    }
    .share-avatar {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      margin: 0 auto 12px;
      overflow: hidden;
      background: #333;
    }
    .share-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .share-username {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .share-festival {
      font-size: 14px;
      color: #ff3366;
      font-weight: 600;
    }
    .share-location {
      font-size: 13px;
      color: #888;
    }
    .share-stats {
      display: flex;
      justify-content: center;
      gap: 16px;
      margin-top: 16px;
      font-size: 13px;
    }
    .share-stat {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .share-stat-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .share-day {
      margin-bottom: 24px;
    }
    .share-day h3 {
      font-size: 16px;
      font-weight: 700;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      margin-bottom: 8px;
    }
    .share-date {
      font-weight: 400;
      color: #888;
      font-size: 13px;
    }
    .share-sets {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .share-set {
      background: ${tint.pale};
      border: 1px solid ${tint.faint};
      border-radius: 8px;
      padding: 10px 12px;
    }
    .share-set-time {
      font-size: 12px;
      color: #888;
      font-weight: 500;
    }
    .share-set-artist {
      font-size: 15px;
      font-weight: 600;
      margin: 2px 0;
    }
    .share-set-meta {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
    }
    .share-stage {
      color: #aaa;
    }
    .share-priority {
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
    }
    .share-cta {
      text-align: center;
      padding: 24px 0;
      margin-top: 16px;
      border-top: 1px solid rgba(255,255,255,0.1);
    }
    .share-cta a {
      display: inline-block;
      background: #ff3366;
      color: #fff;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
    }
    .share-cta a:hover {
      background: #e62e5c;
    }
    .share-cta a.share-cta-outline {
      background: transparent;
      color: #ff3366;
      border: 1px solid #ff3366;
      margin: 8px 0 0 8px;
    }
    .share-cta a.share-cta-outline:hover {
      background: rgba(255,51,102,0.1);
    }
    .share-cta p a,
    .share-cta p a:hover {
      display: inline;
      background: none;
      color: #ff3366;
      padding: 0;
      font-size: inherit;
      text-decoration: underline;
    }
    .share-cta p {
      font-size: 13px;
      color: #888;
      margin-top: 8px;
    }
    .share-empty {
      text-align: center;
      padding: 40px 0;
      color: #888;
    }
  </style>
</head>
<body>
  <div class="share-container">
    <div class="share-header">
      ${avatarUrl ? `<div class="share-avatar"><img src="${avatarUrl}" alt="" loading="lazy"></div>` : ''}
      <div class="share-username">${username}</div>
      <div class="share-festival">${festivalName}</div>
      ${festivalLocation ? `<div class="share-location">${festivalLocation}</div>` : ''}
      <div class="share-stats">
        <span class="share-stat"><span class="share-stat-dot" style="background:#ff3366"></span> ${mustCount} must</span>
        <span class="share-stat"><span class="share-stat-dot" style="background:#ffaa00"></span> ${wantCount} want</span>
        <span class="share-stat"><span class="share-stat-dot" style="background:#888"></span> ${maybeCount} maybe</span>
      </div>
    </div>

    ${totalPicks === 0
      ? '<div class="share-empty"><p>No picks saved yet.</p></div>'
      : dayHtml
    }

    <div class="share-cta">
      <a href="${compareUrl}">Compare with my picks</a>
      <a class="share-cta-outline" href="${addUrl}">Add their picks to my plan</a>
      <p>Have the Festie app? <a href="${appUrl}">Open in the app</a></p>
      <p><a href="${origin}">New to Festie? Plan your own schedule</a></p>
    </div>
  </div>
</body>
</html>`;
}
