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

// Clash Display 700 carries headings and the wordmark. Space Grotesk is one variable file
// covering 400 to 700. Both are served from /fonts/ by the web build and public/.
export const fontFaceCss = `@font-face { font-family: 'Clash Display'; font-style: normal; font-weight: 700; font-display: swap; src: url('/fonts/clash-display/clash-display-700.woff2') format('woff2'); }
@font-face { font-family: 'Space Grotesk'; font-style: normal; font-weight: 400 700; font-display: swap; src: url('/fonts/space-grotesk/space-grotesk-latin.woff2') format('woff2'); }`;

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
  return `<a class="ds-lockup" href="${href}">${festieMarkSvg()}<span class="ds-wordmark">Festie</span></a>`;
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
