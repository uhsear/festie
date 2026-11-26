// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// ── Server design module ─────────────────────────────────────────────
// The one place the server-rendered pages (festival, invite, share, status,
// legal, offline) and the transactional email read the design tokens. Values
// come from the shared token files, never from hand-copied hex, so a token
// change reaches these pages with no second edit. The build bundles the shared
// sources imported by relative path, as lib/festival-tint.ts does.

import { FESTIE_MARK_VIEWBOX, festieMarkSvgBody } from '../packages/shared/src/brand/festieMark';
import { colors } from '../packages/shared/src/tokens/colors';
import { colorsDaylight } from '../packages/shared/src/tokens/colorsDaylight';
import { fontFamily, letterSpacing } from '../packages/shared/src/tokens/typography';
import { escapeHtml } from './helpers/sanitize.js';

type Palette = typeof colors | typeof colorsDaylight;

/** The CSS custom properties of one theme. Names are stable; only values change per theme. */
function themeVars(c: Palette): Record<string, string> {
  return {
    '--ds-bg': c.bg.primary,
    '--ds-card': c.bg.card,
    '--ds-border': c.border.default,
    '--ds-text': c.text.primary,
    '--ds-text-secondary': c.text.secondary,
    '--ds-text-muted': c.text.muted,
    '--ds-danger': c.text.danger,
    '--ds-accent': c.accent.aqua,
    '--ds-accent-ink': c.text.onLightAccent,
    '--ds-mark-pin': c.accent.aqua,
    '--ds-mark-tent': c.accent.coral,
  };
}

/** Stage (dark) values. The default, because Stage is the product's identity. */
export const stageVars = themeVars(colors);
/** Daylight values, applied only when the visitor's system asks for a light scheme. */
export const daylightVars = themeVars(colorsDaylight);

const declarations = (vars: Record<string, string>) =>
  Object.entries(vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ');

export const stageRootCss = `:root { color-scheme: dark light; ${declarations(stageVars)} }`;
export const daylightCss = `@media (prefers-color-scheme: light) { :root { ${declarations(daylightVars)} } }`;

const FONT_BODY = fontFamily.body;
const FONT_DISPLAY = fontFamily.displayWeb;

// Clash Display 700 carries headings and the wordmark. Space Grotesk is one variable file per
// script subset covering 400 to 700; the unicode-range lists match
// packages/web/public/fonts/space-grotesk/space-grotesk.css (tests/design-css.test.ts checks this),
// so Latin Extended and Vietnamese names do not mix in fallback glyphs. Served from /fonts/.
const SPACE_GROTESK_SUBSETS = [
  ['vietnamese', 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB'],
  ['latin-ext', 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF'],
  ['latin', 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'],
] as const;

export const fontFaceCss = [
  `@font-face { font-family: 'Clash Display'; font-style: normal; font-weight: 700; font-display: swap; src: url('/fonts/clash-display/clash-display-700.woff2') format('woff2'); }`,
  ...SPACE_GROTESK_SUBSETS.map(
    ([subset, range]) =>
      `@font-face { font-family: 'Space Grotesk'; font-style: normal; font-weight: 400 700; font-display: swap; src: url('/fonts/space-grotesk/space-grotesk-${subset}.woff2') format('woff2'); unicode-range: ${range}; }`,
  ),
].join('\n');

export const baseCss = `* { box-sizing: border-box; }
body { margin: 0; background: var(--ds-bg); color: var(--ds-text); font-family: ${FONT_BODY}; line-height: 1.5; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
h1, h2, h3, h4, h5, h6 { font-weight: 600; line-height: 1.2; text-wrap: balance; }
h1 { font-family: ${FONT_DISPLAY}; font-weight: 700; letter-spacing: ${letterSpacing.display}em; }
p, li { text-wrap: pretty; }
time, .ds-time { font-variant-numeric: tabular-nums; }`;

// The aqua pill is the one pressable thing. 44 px is the touch-target minimum.
export const ctaCss = `.ds-cta { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 24px; border-radius: 999px; background: var(--ds-accent); color: var(--ds-accent-ink); font-family: inherit; font-size: 1rem; font-weight: 600; text-decoration: none; }
.ds-cta:focus-visible { outline: 2px solid var(--ds-accent); outline-offset: 3px; }`;

export const lockupCss = `.ds-lockup { display: inline-flex; align-items: center; gap: 0.5rem; color: var(--ds-text); text-decoration: none; }
.ds-lockup svg { width: 2rem; height: 2rem; }
.ds-wordmark { font-family: ${FONT_DISPLAY}; font-weight: 700; font-size: 1.5rem; letter-spacing: ${letterSpacing.display}em; }`;

/** Everything a server page needs inside one `<style>`: tokens, fonts, base rules, CTA and lockup. */
export const designCss = [stageRootCss, daylightCss, fontFaceCss, baseCss, ctaCss, lockupCss].join('\n');

/** The inline mark. The colours follow the page theme through the `--ds-mark-*` properties. */
export function festieMarkSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${FESTIE_MARK_VIEWBOX}" role="img" aria-label="Festie">${festieMarkSvgBody('var(--ds-mark-pin)', 'var(--ds-mark-tent)')}</svg>`;
}

/** Mark beside the mixed-case "Festie" wordmark (OD-2 option C): the server-page lockup. */
export function festieLockupHtml(href = '/'): string {
  return `<a class="ds-lockup" href="${escapeHtml(href)}">${festieMarkSvg()}<span class="ds-wordmark">Festie</span></a>`;
}

/** Icons and the browser-bar colour, one per scheme, for the `<head>` of every server page. */
export const headSnippet = [
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml" media="(prefers-color-scheme: dark)">',
  '<link rel="icon" href="/favicon-daylight.svg" type="image/svg+xml" media="(prefers-color-scheme: light)">',
  '<link rel="icon" href="/favicon.ico" sizes="48x48">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  `<meta name="theme-color" content="${colors.bg.primary}" media="(prefers-color-scheme: dark)">`,
  `<meta name="theme-color" content="${colorsDaylight.bg.primary}" media="(prefers-color-scheme: light)">`,
].join('\n');

/**
 * Email clients drop CSS variables and rgba, so email takes solid hex from the Stage palette.
 * Mail stays dark in every client: the 4.5:1 pairs below are tested.
 */
export const emailColors = {
  ground: colors.bg.primary,
  card: colors.bg.secondary,
  text: colors.text.primary,
  textSecondary: colors.text.secondary,
  textMuted: colors.text.muted,
  accent: colors.accent.aqua,
  accentInk: colors.text.onLightAccent,
  danger: colors.text.danger,
} as const;
