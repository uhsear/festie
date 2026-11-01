// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// ── Invite Page Renderers ────────────────────────────────────────────
// Server-rendered /join/:code page. It carries crew-specific Open Graph tags so
// chat apps show a rich preview, and one Join button into the app. Every value
// is escaped here, inside the renderer, so no caller can forget.

import { escapeHtml } from './helpers/sanitize.js';
import { formatInviteDateRange, type InvitePreview } from './invite-preview.js';

export const INVITE_ERROR_MESSAGES = {
  expired: 'This invite has expired. Ask someone in the crew for a new link.',
  invalid: "We couldn't find a crew with this code. Check the link or ask for a new one.",
  failed: "We couldn't load this invite. Try again in a moment.",
} as const;

const PAGE_STYLE = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0a;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .invite-container { max-width: 400px; width: 100%; text-align: center; }
    .invite-card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 40px 24px;
    }
    .invite-eyebrow {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #ff3366;
      margin-bottom: 8px;
    }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; overflow-wrap: anywhere; }
    .invite-line { font-size: 14px; color: #aaa; margin-bottom: 4px; }
    .invite-button {
      display: inline-block;
      margin-top: 24px;
      background: #ff3366;
      color: #fff;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 15px;
    }
    .invite-button:hover { background: #e62e5c; }
    .invite-footer { font-size: 12px; color: #888; margin-top: 24px; }
    .invite-error-title { font-size: 20px; font-weight: 700; margin-bottom: 12px; }
    .invite-error-message { font-size: 14px; color: #aaa; margin-bottom: 32px; line-height: 1.6; }
    .invite-link { color: #ff3366; text-decoration: none; font-weight: 600; font-size: 14px; }
    .invite-link:hover { text-decoration: underline; }`;

/** "Crew of 6 · 2 spots left", or "Crew of 30 · full". */
export function inviteStateLine(memberCount: number, spotsLeft: number): string {
  if (spotsLeft <= 0) return `Crew of ${memberCount} · full`;
  return `Crew of ${memberCount} · ${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left`;
}

type InviteJoinPageArgs = Pick<
  InvitePreview,
  'crewName' | 'ownerName' | 'memberCount' | 'spotsLeft' | 'festivalName' | 'startDate' | 'endDate'
> & { inviteCode: string; origin: string };

export function renderInviteJoinPage({
  crewName,
  ownerName,
  memberCount,
  spotsLeft,
  festivalName,
  startDate,
  endDate,
  inviteCode,
  origin,
}: InviteJoinPageArgs) {
  const dates = formatInviteDateRange(startDate, endDate);
  const stateLine = inviteStateLine(memberCount, spotsLeft);
  const festivalLine = [festivalName, dates].filter(Boolean).join(' · ');
  const description = `${[festivalName, dates, stateLine].filter(Boolean).join(' · ')}. Plan your sets together on Festie.`;
  const title = escapeHtml(`Join ${crewName} on Festie`);
  const code = encodeURIComponent(inviteCode);
  const pageUrl = escapeHtml(`${origin}/join/${code}`);
  const joinUrl = escapeHtml(`${origin}/?joinCrew=${code}`);
  const imageUrl = escapeHtml(`${origin}/og-image.png`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#0a0a0a">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <style>${PAGE_STYLE}
  </style>
</head>
<body>
  <main class="invite-container">
    <div class="invite-card">
      <div class="invite-eyebrow">Crew invite</div>
      <h1>${escapeHtml(crewName)}</h1>
      <p class="invite-line">${escapeHtml(stateLine)}</p>
${festivalLine ? `      <p class="invite-line">${escapeHtml(festivalLine)}</p>\n` : ''}${ownerName ? `      <p class="invite-line">Started by ${escapeHtml(ownerName)}</p>\n` : ''}      <a href="${joinUrl}" class="invite-button">Join ${escapeHtml(crewName)}</a>
      <p class="invite-footer">New to Festie? You can create an account after you tap Join.</p>
    </div>
  </main>
</body>
</html>`;
}

export function renderInviteErrorPage(origin: string, message: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>This invite doesn't work</title>
  <meta name="theme-color" content="#0a0a0a">
  <style>${PAGE_STYLE}
  </style>
</head>
<body>
  <main class="invite-container">
    <div class="invite-card">
      <h1 class="invite-error-title">This invite doesn't work</h1>
      <p class="invite-error-message">${escapeHtml(message)}</p>
      <a href="${escapeHtml(`${origin}/`)}" class="invite-link">Open Festie</a>
    </div>
  </main>
</body>
</html>`;
}

export { escapeHtml };
