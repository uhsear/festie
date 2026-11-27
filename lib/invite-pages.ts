// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// ── Invite Page Renderers ────────────────────────────────────────────
// Server-rendered /join/:code page. It carries crew-specific Open Graph tags so
// chat apps show a rich preview, and one Join button into the app. Every value
// is escaped here, inside the renderer, so no caller can forget.

import { fontFamily, letterSpacing, wordSpacing } from '../packages/shared/src/tokens/typography';
import { baseCss, ctaCss, daylightCss, designCss, fontFaceCss, festieLockupHtml, headSnippet, stageRootCss } from './design-css.js';
import { addDaysCompact, buildVCalendar } from './helpers/ics-builder.js';
import { escapeHtml } from './helpers/sanitize.js';
import { formatInviteDateRange, inviteCountdown, type InvitePreview } from './invite-preview.js';

export const INVITE_ERROR_MESSAGES = {
  expired: 'This invite has expired. Ask someone in the crew for a new link.',
  invalid: "We couldn't find a crew with this code. Check the link or ask for a new one.",
  failed: "We couldn't load this invite. Try again in a moment.",
  locked: "This crew isn't taking new members.",
} as const;

// Lean on purpose: this page opens from a link on weak signal and may weigh at most 10 percent more
// than the page it replaced. It takes the tokens, the CTA and the base rules from lib/design-css.ts,
// loads only the Clash Display face (the body falls back to system-ui) and carries the browser-bar
// colours without the icon links. The error page is small and takes the whole module.
const CLASH_FACE = fontFaceCss.split('\n').filter((face) => face.includes('Clash Display'));
const THEME_COLOR_META = headSnippet
  .split('\n')
  .filter((line) => line.startsWith('<meta name="theme-color"'))
  .join('\n  ');

const SHARED_CSS = [stageRootCss, daylightCss, ...CLASH_FACE, baseCss, ctaCss].join('\n');

// The 32px and 24px display text tracks at zero (at -0.02em its glyphs touch), and the face's narrow space gets the
// display word spacing, so "Moonlit Orchard Fest" reads as three words. Same tokens as the web app.
const PAGE_STYLE = `
main { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; }
.iv { width: 100%; max-width: 26rem; padding: 2rem 1.5rem; border: 1px solid var(--ds-border); border-radius: 0.75rem; background: var(--ds-card); }
.iv .ds-lockup { margin-bottom: 1.5rem; }
.iv-crew { display: flex; align-items: center; margin-bottom: 0.75rem; font-size: 0.875rem; color: var(--ds-text-secondary); }
.iv-face { display: inline-flex; width: 2.5rem; height: 2.5rem; margin-right: -0.5rem; align-items: center; justify-content: center; border: 2px solid var(--ds-card); border-radius: 50%; background: var(--ds-border); color: var(--ds-text); font-weight: 600; }
.iv-faces { display: flex; flex: none; }
.iv-state { margin-left: 1rem; }
h1 { margin: 0 0 0.5rem; font-size: 2rem; line-height: 1.1; overflow-wrap: anywhere; letter-spacing: ${letterSpacing.displaySmall}em; }
.iv-when { margin: 0 0 0.5rem; font: 700 1.5rem ${fontFamily.displayWeb}; letter-spacing: ${letterSpacing.displaySmall}em; word-spacing: ${wordSpacing.display}em; }
.iv p { margin: 0 0 0.25rem; color: var(--ds-text-secondary); }
.iv p.iv-when { color: var(--ds-text); }
.iv .ds-cta { width: 100%; margin-top: 1.5rem; }
.iv-link { display: flex; align-items: center; min-height: 2.75rem; color: var(--ds-text); font-weight: 600; }
.iv .iv-small { margin-top: 0.5rem; font-size: 0.8125rem; }`;

/** "Crew of 6 · 2 spots left", or "Crew of 30 · full". */
function inviteStateLine(memberCount: number, spotsLeft: number): string {
  if (spotsLeft <= 0) return `Crew of ${memberCount} · full`;
  return `Crew of ${memberCount} · ${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left`;
}

type InviteJoinPageArgs = Pick<
  InvitePreview,
  'crewName' | 'ownerName' | 'memberCount' | 'spotsLeft' | 'festivalName' | 'startDate' | 'endDate'
> & { inviteCode: string; origin: string; memberInitials?: string[]; festivalTimeZone?: string | null; now?: Date };

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
  memberInitials = [],
  festivalTimeZone = null,
  now,
}: InviteJoinPageArgs) {
  const dates = formatInviteDateRange(startDate, endDate);
  const stateLine = inviteStateLine(memberCount, spotsLeft);
  const countdown = inviteCountdown(startDate, endDate, now, festivalTimeZone);
  const description = `${[festivalName, dates, stateLine].filter(Boolean).join(' · ')}. Plan your sets together on Festie.`;
  const title = escapeHtml(`Join ${crewName} on Festie`);
  const code = encodeURIComponent(inviteCode);
  const pageUrl = escapeHtml(`${origin}/join/${code}`);
  // In-page links stay relative so they keep the origin the visitor is on (and its session); only the
  // tags and the calendar file, which other apps read, carry the configured public origin.
  const joinUrl = escapeHtml(`/?joinCrew=${code}&ref=crew-invite`);
  const saveLink = dates
    ? `      <a href="${escapeHtml(`/join/${code}/save.ics`)}" class="iv-link" download>Save for later</a>
      <p class="iv-small">Adds the festival dates and this invite to your calendar.</p>
`
    : '';
  const imageUrl = escapeHtml(`${origin}/og-image.png`);
  const faces = memberInitials.length
    ? `<span class="iv-faces" aria-hidden="true">${memberInitials.map((initial) => `<span class="iv-face">${escapeHtml(initial)}</span>`).join('')}</span>`
    : '';
  const lines = [
    countdown && `<p class="iv-when">${escapeHtml(countdown)}</p>`,
    dates && `<p>${escapeHtml(dates)}</p>`,
    festivalName && `<p>${escapeHtml(crewName)}</p>`,
    ownerName && `<p>Led by ${escapeHtml(ownerName)}</p>`,
  ]
    .filter(Boolean)
    .map((line) => `      ${line}\n`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="noindex">
  ${THEME_COLOR_META}
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <style>${SHARED_CSS}${PAGE_STYLE}
  </style>
</head>
<body>
  <main>
    <div class="iv">
      <div class="iv-crew">${faces}<span class="iv-state">${escapeHtml(stateLine)}</span></div>
      <h1>${escapeHtml(festivalName || crewName)}</h1>
${lines}      <a href="${joinUrl}" class="ds-cta">Join ${escapeHtml(crewName)}</a>
${saveLink}      <p class="iv-small">New to Festie? You can create an account after you tap Join.</p>
    </div>
  </main>
</body>
</html>`;
}

type InviteIcsArgs = Pick<InvitePreview, 'festivalName' | 'crewName'> & {
  startDate: string;
  endDate: string;
  inviteCode: string;
  origin: string;
};

/**
 * "Save for later": one all-day event over the festival dates. It is public, so
 * it carries only what the invite page shows plus the invite URL. No owner or
 * member names and no user ids.
 */
export function renderInviteIcs({ festivalName, crewName, startDate, endDate, inviteCode, origin }: InviteIcsArgs) {
  const code = encodeURIComponent(inviteCode);
  const event = {
    uid: `invite-${code}@${origin}`,
    summary: festivalName || 'Festival',
    dtstart: startDate.replace(/-/g, ''),
    // DTEND is exclusive for all-day events.
    dtend: addDaysCompact(endDate, 1),
    allDay: true,
    description: `Crew invite to ${crewName} on Festie: ${origin}/join/${code}`,
  };
  return buildVCalendar([event], { calendarName: festivalName || 'Festie', prodId: '-//Festie//Invite//EN' });
}

export function renderInviteErrorPage(message: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>This invite doesn't work</title>
  <meta name="robots" content="noindex">
  ${headSnippet}
  <style>${designCss}${PAGE_STYLE}
  </style>
</head>
<body>
  <main>
    <div class="iv">
      ${festieLockupHtml('/')}
      <h1>This invite doesn't work</h1>
      <p>${escapeHtml(message)}</p>
      <a href="${escapeHtml('/')}" class="ds-cta">Open Festie</a>
    </div>
  </main>
</body>
</html>`;
}

export { escapeHtml };
