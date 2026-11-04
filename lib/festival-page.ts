// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// ── Public Festival Page ─────────────────────────────────────────────
// Server-rendered /f/<slug> page: the lineup by day in festival time, with
// Open Graph tags for link previews and one button into the web app. It reads
// only the festival record, never user, pick or crew data. Every database value
// is escaped here, inside the renderer, so no caller can forget.

import { festivalTint } from './festival-tint.js';
import {
  buildEventJsonLd,
  getStageColorById,
  getStageNameById,
  ISO_DATE_RE,
  sanitizeColor,
  shareTimeText,
} from './helpers/public-page.js';
import { escapeHtml } from './helpers/sanitize.js';
import { CLOCK_TIME_RE } from './helpers/share-og-image.js';
import { formatInviteDateRange } from './invite-preview.js';
import { artistDisplayName } from './schemas.js';
import { festivalStartMinutes } from './time-zone.js';

/** The festival's `YYYY-MM-DD` day dates, sorted; other date values are skipped. */
function festivalDates(festival: any): string[] {
  return (festival.days || [])
    .map((day: any) => String(day?.date || ''))
    .filter((date: string) => ISO_DATE_RE.test(date))
    .map((date: string) => date.slice(0, 10))
    .sort();
}

/** "Jul 18 – Jul 20, 2026", or null when no day has a date. */
export function festivalDateRange(festival: any): string | null {
  const dates = festivalDates(festival);
  return dates.length > 0 ? formatInviteDateRange(dates[0]!, dates[dates.length - 1]!) : null;
}

/** "Fri, Jul 18" for a stored calendar date, or '' when it is not `YYYY-MM-DD`. */
export function dayHeadingDate(date: unknown): string {
  const value = String(date || '');
  if (!ISO_DATE_RE.test(value)) return '';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function setArtistName(set: any, separator: string | undefined): string {
  if (Array.isArray(set.artists) && set.artists.length > 0) return artistDisplayName(set.artists, separator);
  return set.artist || 'Artist TBA';
}

/** One entry per day in record order; sets in festival time (06:00 day start), TBA last. All text is escaped. */
export function buildFestivalPageDays(festival: any) {
  return (festival.days || []).map((day: any, dayIndex: number) => {
    const sets = (day?.sets || [])
      .map((set: any) => {
        const timed = CLOCK_TIME_RE.test(String(set.startTime || ''));
        return {
          minutes: timed ? festivalStartMinutes(set.startTime) : Number.MAX_SAFE_INTEGER,
          timeText: escapeHtml(shareTimeText(set.startTime, set.endTime)),
          artist: escapeHtml(setArtistName(set, festival.b2bSeparator || undefined)),
          stage: escapeHtml(getStageNameById(festival.stages, set.stageId)),
          stageColor: sanitizeColor(getStageColorById(festival.stages, set.stageId)),
        };
      })
      .sort((a: any, b: any) => a.minutes - b.minutes)
      .map(({ minutes: _minutes, ...row }: any) => row);
    return {
      label: escapeHtml(day?.label || `Day ${dayIndex + 1}`),
      date: escapeHtml(dayHeadingDate(day?.date)),
      sets,
    };
  });
}

/** "Times are local to the festival (EDT)." Without a zone Intl accepts, the line has no abbreviation. */
export function festivalTimeZoneLine(festival: any): string {
  const plain = 'Times are local to the festival.';
  if (!festival.timeZone) return plain;
  const first = festivalDates(festival)[0];
  const at = first ? new Date(`${first}T12:00:00Z`) : new Date();
  try {
    const abbr = new Intl.DateTimeFormat('en-US', { timeZone: festival.timeZone, timeZoneName: 'short' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
    return abbr ? `Times are local to the festival (${abbr}).` : plain;
  } catch {
    // An unknown zone (RangeError) is bad record data, not a page failure.
    return plain;
  }
}

const PAGE_STYLE = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      min-height: 100vh;
    }
    .fp-container { max-width: 600px; margin: 0 auto; padding: 1.25rem 16px; }
    .fp-header { text-align: center; padding: 1.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 1.25rem; }
    .fp-eyebrow { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #ff3366; margin-bottom: 0.5rem; }
    h1 { font-size: 1.5rem; font-weight: 700; overflow-wrap: anywhere; }
    .fp-line { font-size: 0.875rem; color: #aaa; margin-top: 0.25rem; }
    .fp-cta {
      display: inline-flex; align-items: center; justify-content: center;
      min-height: 2.75rem; margin-top: 1.25rem; padding: 0.75rem 1.5rem;
      background: #ff3366; color: #fff; text-decoration: none; border-radius: 0.5rem; font-weight: 600; font-size: 0.9375rem;
    }
    .fp-cta:hover { background: #e62e5c; }
    .fp-hint { font-size: 0.8125rem; color: #888; margin-top: 0.5rem; }
    .fp-section { margin-bottom: 1.5rem; }
    h2 { font-size: 1rem; font-weight: 700; padding: 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 0.5rem; }
    .fp-date { font-weight: 400; color: #888; font-size: 0.8125rem; }
    .fp-stages { list-style: none; display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; font-size: 0.875rem; }
    .fp-dot { display: inline-block; width: 0.5rem; height: 0.5rem; border-radius: 50%; margin-right: 0.375rem; }
    .fp-sets { list-style: none; display: flex; flex-direction: column; gap: 0.375rem; }
    .fp-set { border-radius: 0.5rem; padding: 0.625rem 0.75rem; }
    .fp-set-time { font-size: 0.75rem; color: #888; font-weight: 500; }
    .fp-set-artist { font-size: 0.9375rem; font-weight: 600; margin: 0.125rem 0; overflow-wrap: anywhere; }
    .fp-set-stage { font-size: 0.75rem; color: #aaa; }
    .fp-empty { color: #888; font-size: 0.875rem; padding: 0.5rem 0; }
    .fp-footer { font-size: 0.75rem; color: #888; padding: 1.5rem 0; border-top: 1px solid rgba(255,255,255,0.1); text-align: center; }
    .fp-link { color: #ff3366; text-decoration: none; font-weight: 600; font-size: 0.875rem; }
    .fp-link:hover { text-decoration: underline; }
    .fp-error { text-align: center; padding: 3rem 0; }
    .fp-error p { font-size: 0.875rem; color: #aaa; margin: 0.75rem 0 2rem; }`;

function renderDay(day: ReturnType<typeof buildFestivalPageDays>[number]) {
  const heading = `<h2>${day.label}${day.date ? ` <span class="fp-date">${day.date}</span>` : ''}</h2>`;
  if (day.sets.length === 0) return `<section class="fp-section">${heading}<p class="fp-empty">Set times to come.</p></section>`;
  const rows = day.sets
    .map(
      (set: any) =>
        `<li class="fp-set" style="border-left: 3px solid ${set.stageColor}"><div class="fp-set-time">${set.timeText}</div><div class="fp-set-artist">${set.artist}</div><div class="fp-set-stage">${set.stage}</div></li>`,
    )
    .join('\n        ');
  return `<section class="fp-section">${heading}
      <ul class="fp-sets">
        ${rows}
      </ul>
    </section>`;
}

export function renderFestivalPage({ festival, origin, slug }: { festival: any; origin: string; slug: string }) {
  const name = String(festival.name || '');
  const location = String(festival.location || '');
  const dateRange = festivalDateRange(festival);
  const pageUrl = `${origin}/f/${slug}`;
  const ogUrl = `${pageUrl}/og.png`;
  const appUrl = `${origin}/?festival=${encodeURIComponent(festival.id)}&ref=festival-page`;
  const description = `Lineup and set times for ${name}${dateRange ? ` · ${dateRange}` : ''}${location ? ` · ${location}` : ''}. Plan your days with Festie.`;
  const placeLine = [dateRange, location].filter(Boolean).join(' · ');
  const tint = festivalTint(name);
  const days = buildFestivalPageDays(festival);
  const stages = (festival.stages || []) as any[];
  // Hex values come from a fixed function or sanitizeColor, so they need no escaping.
  const tintStyle = `
    body { background: ${tint.bg}; }
    .fp-header { border-top: 4px solid ${tint.active}; }
    .fp-set { background: ${tint.pale}; border: 1px solid ${tint.faint}; }`;
  const stagesHtml = stages.length
    ? `<section class="fp-section">
      <h2>Stages</h2>
      <ul class="fp-stages">
        ${stages.map((stage) => `<li><span class="fp-dot" style="background: ${sanitizeColor(stage?.color)}" aria-hidden="true"></span>${escapeHtml(stage?.name || 'TBD')}</li>`).join('\n        ')}
      </ul>
    </section>`
    : '';
  const daysHtml = days.length
    ? days.map(renderDay).join('\n    ')
    : `<section class="fp-section"><p class="fp-empty">The lineup isn't out yet.</p></section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(`${name} lineup and set times · Festie`)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#080810">
  <meta property="og:site_name" content="Festie">
  <meta property="og:title" content="${escapeHtml(`${name} lineup and set times`)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${escapeHtml(ogUrl)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${escapeHtml(`${name} on Festie`)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${escapeHtml(ogUrl)}">
  <link rel="canonical" href="${escapeHtml(pageUrl)}">
  <script type="application/ld+json">${buildEventJsonLd(festival, { shareUrl: pageUrl, ogUrl, description })}</script>
  <style>${PAGE_STYLE}${tintStyle}
  </style>
</head>
<body>
  <main class="fp-container">
    <header class="fp-header">
      <p class="fp-eyebrow">Festival lineup</p>
      <h1>${escapeHtml(name)}</h1>
${placeLine ? `      <p class="fp-line">${escapeHtml(placeLine)}</p>\n` : ''}      <a class="fp-cta" href="${escapeHtml(appUrl)}">Plan your days in Festie</a>
      <p class="fp-hint">Pick sets, see clashes and plan with your crew. You can start without an account.</p>
      <p class="fp-hint">${escapeHtml(festivalTimeZoneLine(festival))}</p>
    </header>
    ${stagesHtml}
    ${daysHtml}
    <footer class="fp-footer">${escapeHtml(`Unofficial guide. Festie is a planning app. It isn't run by or connected to ${name}. Times can change, so check the official schedule too.`)}</footer>
  </main>
</body>
</html>`;
}

/** The one 404 page for drafts, archived festivals and unknown slugs, so a 404 reveals nothing. */
export function renderFestivalNotFoundPage(origin: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Festival not found</title>
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#080810">
  <style>${PAGE_STYLE}
    body { background: #0a0a0a; }
  </style>
</head>
<body>
  <main class="fp-container fp-error">
    <h1>Festival not found</h1>
    <p>We couldn't find this festival. It may not be published yet, or the link may be wrong.</p>
    <a class="fp-link" href="${escapeHtml(`${origin}/`)}">Open Festie</a>
  </main>
</body>
</html>`;
}
