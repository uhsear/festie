/**
 * generateThemeCss — single-source codegen for the web Tailwind v4 `@theme` block.
 *
 * The TS tokens in this directory (colors/spacing/typography/motion/radii/
 * z-index/breakpoints) are the SINGLE source of truth. This pure function emits
 * the `@theme { ... }` CSS that packages/web's theme.css used to hand-maintain,
 * so the two can no longer drift. The Node wrapper in
 * `packages/shared/scripts/gen-theme-css.mjs` writes the result to the committed
 * `packages/web/src/styles/theme.generated.css`, which theme.css `@import`s.
 *
 * SCOPE: this emits ONLY the tokens that have a TS source. CSS-only tokens
 * (the 11px/13px off-ramp font sizes, focus rings, glass blur, accent hover
 * tones, timeline NOW tokens, bg-chrome/bg-disabled, the var()-referencing and
 * rgb-channel one-offs) remain hand-authored in theme.css — they are not
 * design tokens shared with React Native.
 *
 * CRITICAL: the emitted values must EQUAL the current theme.css literals — this
 * is single-sourcing, not a restyle. The companion test
 * (generateThemeCss.test.ts) pins that contract.
 *
 * Pure: zero runtime/DOM/Node dependencies, so it is unit-testable and safe to
 * import from either platform's tooling.
 */

import type { Colors } from './colors.js';
import { colors } from './colors.js';
import { colorsDaylight } from './colorsDaylight.js';
import { breakpoints } from './breakpoints.js';
import { fontFamily, fontSize, lineHeight, letterSpacing, wordSpacing } from './typography.js';
import { spacing, measureProse } from './spacing.js';
import { radii } from './radii.js';
import { zIndex } from './z-index.js';
import { easing, duration, durationEffects, durationSpatial } from './motion.js';

/** px → rem string (16px base), trimming trailing zeros (16 → "1rem"). */
function rem(px: number): string {
  const v = px / 16;
  // Number() drops trailing zeros: 0.875 stays, 1.0 → 1, 1.25 stays.
  return `${Number(v.toFixed(6))}rem`;
}

/** em number → em string. */
function em(n: number): string {
  return `${n}em`;
}

type Decl = readonly [name: string, value: string];

/** Palette = `Colors` with plain string values, so alternate palettes (Daylight) fit. */
export type Palette = { [K in keyof Colors]: { [P in keyof Colors[K]]: string } };

/**
 * Every colour / colour-shadow declaration, in four groups that keep the
 * original interleaving with the non-colour tokens in `themeDeclarations()`.
 * The dark `@theme` block and the Daylight override block share these names.
 */
function paletteGroups(c: Palette) {
  const core: Decl[] = [];
  const glassStage: Decl[] = [];
  const glow: Decl[] = [];
  const rest: Decl[] = [];
  // ── Core colors ──────────────────────────────────────────────────────────
  core.push(['--color-bg-primary', c.bg.primary]);
  core.push(['--color-bg-secondary', c.bg.secondary]);
  core.push(['--color-bg-card', c.bg.card]);
  core.push(['--color-bg-card-hover', c.bg.cardHover]);
  core.push(['--color-bg-input', c.bg.input]);
  core.push(['--color-text-primary', c.text.primary]);
  core.push(['--color-text-secondary', c.text.secondary]);
  core.push(['--color-text-muted', c.text.muted]);
  core.push(['--color-accent-coral', c.accent.coral]);
  core.push(['--color-accent-coral-strong', c.accent.coralStrong]);
  core.push(['--color-accent-aqua', c.accent.aqua]);
  core.push(['--color-accent-amber', c.accent.amber]);
  core.push(['--color-accent-green', c.accent.green]);
  core.push(['--color-border', c.border.default]);
  core.push(['--color-border-light', c.border.light]);
  core.push(['--color-priority-must', c.priority.must]);
  core.push(['--color-priority-want', c.priority.want]);
  core.push(['--color-priority-maybe', c.priority.maybe]);

  glassStage.push(['--color-glass', c.glass.bg]);
  glassStage.push(['--color-glass-border', c.glass.border]);

  // ── Stage palette ──────────────────────────────────────────────────────────
  glassStage.push(['--stage-purple-accessible', c.stage.purpleAccessible]);

  // ── Glow shadows ───────────────────────────────────────────────────────────
  glow.push(['--shadow-glow-coral', c.glow.coral]);
  glow.push(['--shadow-glow-aqua', c.glow.aqua]);
  glow.push(['--shadow-glow-amber', c.glow.amber]);
  glow.push(['--shadow-glow-green', c.glow.green]);

  // ── Additional colors ──────────────────────────────────────────────────────
  rest.push(['--color-bg-hover', c.bg.hover]);
  rest.push(['--color-bg-elevated', c.bg.elevated]);
  rest.push(['--color-text-danger', c.text.danger]);
  rest.push(['--color-text-disabled', c.text.disabled]);
  rest.push(['--color-text-placeholder', c.text.placeholder]);
  rest.push(['--color-text-on-accent', c.text.onAccent]);
  rest.push(['--color-text-on-dark', c.text.onDark]);
  rest.push(['--color-status-verified', c.status.verified]);
  rest.push(['--color-status-unverified', c.status.unverified]);
  rest.push(['--color-status-verified-bg', c.status.verifiedBg]);
  rest.push(['--color-status-unverified-bg', c.status.unverifiedBg]);
  rest.push(['--color-status-warning', c.status.warning]);
  rest.push(['--color-status-error', c.status.error]);
  rest.push(['--color-spotify', c.spotify.brand]);

  // ── Overlay scale (white at increasing opacity) ────────────────────────────
  rest.push(['--color-overlay-1', c.overlay[1]]);
  rest.push(['--color-overlay-2', c.overlay[2]]);
  rest.push(['--color-overlay-3', c.overlay[3]]);
  rest.push(['--color-overlay-4', c.overlay[4]]);
  rest.push(['--color-overlay-5', c.overlay[5]]);

  // ── Shade scale (black at increasing opacity) ──────────────────────────────
  rest.push(['--color-shade-1', c.shade[1]]);
  rest.push(['--color-shade-2', c.shade[2]]);
  rest.push(['--color-shade-3', c.shade[3]]);
  rest.push(['--color-shade-4', c.shade[4]]);
  rest.push(['--color-shade-5', c.shade[5]]);
  rest.push(['--color-shade-6', c.shade[6]]);
  rest.push(['--color-shade-7', c.shade[7]]);
  rest.push(['--color-shade-8', c.shade[8]]);
  rest.push(['--color-shade-9', c.shade[9]]);
  rest.push(['--color-shade-10', c.shade[10]]);

  // ── Aqua alpha scale ───────────────────────────────────────────────────────
  rest.push(['--color-aqua-a06', c.aquaAlpha[6]]);
  rest.push(['--color-aqua-a08', c.aquaAlpha[8]]);
  rest.push(['--color-aqua-a1', c.aquaAlpha[10]]);
  rest.push(['--color-aqua-a12', c.aquaAlpha[12]]);
  rest.push(['--color-aqua-a15', c.aquaAlpha[15]]);
  rest.push(['--color-aqua-a2', c.aquaAlpha[20]]);
  // a25 has no entry in the aquaAlpha scale (only web's spotlight glow uses it);
  // kept as an explicit literal here rather than adding an RN-unused token.
  rest.push(['--color-aqua-a25', c.aquaAlpha[20].replace(/0\.2\)$/, '0.25)')]);
  rest.push(['--color-aqua-a3', c.aquaAlpha[30]]);
  rest.push(['--color-aqua-a4', c.aquaAlpha[40]]);
  rest.push(['--color-aqua-a7', c.aquaAlpha[70]]);

  // ── Coral alpha scale (built from the raw coral rgb channel token) ─────────
  rest.push(['--color-coral-a3', `rgba(${c.rgb.coral}, 0.3)`]);

  // ── Amber alpha scale ──────────────────────────────────────────────────────
  rest.push(['--color-amber-a08', c.amberAlpha[8]]);
  rest.push(['--color-amber-a12', c.amberAlpha[12]]);
  rest.push(['--color-amber-a2', c.amberAlpha[20]]);
  rest.push(['--color-amber-a3', c.amberAlpha[30]]);

  // ── Focus rings + promoted surfaces (sourced from the token mirrors) ───────
  rest.push(['--color-coral-ring', c.ring.coral]);
  rest.push(['--color-aqua-ring', c.ring.aqua]);
  rest.push(['--color-stage-fallback', c.stage.fallback]);
  rest.push(['--color-bg-sticky', c.bg.sticky]);
  rest.push(['--color-day-tab-active', c.dayTab.active]);

  // ── Confidence (fact age) and delivery (did it leave the phone) ────────────
  // Aliases of existing hues; see the rule in c.ts — never used alone,
  // always paired with a numeral (the `type-numeral` utility) and a shape.
  rest.push(['--color-confidence-live', c.confidence.live]);
  rest.push(['--color-confidence-aging', c.confidence.aging]);
  rest.push(['--color-confidence-stale', c.confidence.stale]);
  rest.push(['--color-confidence-dark', c.confidence.dark]);
  rest.push(['--color-delivery-local', c.delivery.local]);
  rest.push(['--color-delivery-sent', c.delivery.sent]);
  rest.push(['--color-delivery-failed', c.delivery.failed]);

  return { core, glassStage, glow, rest };
}

/**
 * The ordered list of `--var: value` declarations the generated `@theme` block
 * contains, each derived from a TS token. Order is grouped for readability and
 * is not load-bearing (CSS custom properties are order-independent here).
 */
export function themeDeclarations(): Decl[] {
  const d: Decl[] = [];
  const palette = paletteGroups(colors);

  // ── Breakpoints (rem) ────────────────────────────────────────────────────
  d.push(['--breakpoint-sm', rem(breakpoints.sm)]);
  d.push(['--breakpoint-md', rem(breakpoints.md)]);
  d.push(['--breakpoint-lg', rem(breakpoints.lg)]);
  d.push(['--breakpoint-xl', rem(breakpoints.xl)]);
  d.push(['--breakpoint-2xl', rem(breakpoints['2xl'])]);

  d.push(...palette.core);

  // ── Font families ──────────────────────────────────────────────────────────
  d.push(['--font-family-body', fontFamily.body]);
  // Web renders Clash Display with its fallback stack (displayWeb); mobile renders Clash Display (display).
  d.push(['--font-family-display', fontFamily.displayWeb]);

  d.push(...palette.glassStage);

  // ── Motion (easing curves + durations) ────────────────────────────────────
  d.push(['--ease-out', easing.out.css]);
  d.push(['--ease-in', easing.in.css]);
  d.push(['--ease-standard', easing.standard.css]);
  d.push(['--ease-out-quart', easing.outQuart.css]);
  d.push(['--ease-in-quart', easing.inQuart.css]);
  d.push(['--duration-fast', `${duration.fast}ms`]);
  d.push(['--duration-med', `${duration.med}ms`]);
  d.push(['--duration-slow', `${duration.slow}ms`]);
  // Axis-named duration groups. `--duration-fast|med|slow` above is unchanged
  // and stays the general scale; these name what is moving. `spring` is NOT
  // emitted — CSS has no spring primitive, so it stays a React Native token.
  d.push(['--duration-effects-fast', `${durationEffects.fast}ms`]);
  d.push(['--duration-effects-med', `${durationEffects.med}ms`]);
  d.push(['--duration-effects-slow', `${durationEffects.slow}ms`]);
  d.push(['--duration-spatial-fast', `${durationSpatial.fast}ms`]);
  d.push(['--duration-spatial-med', `${durationSpatial.med}ms`]);
  d.push(['--duration-spatial-slow', `${durationSpatial.slow}ms`]);

  // ── Typography scale ───────────────────────────────────────────────────────
  // 11/13 are CSS-only off-ramp steps and stay hand-authored in theme.css.
  d.push(['--font-size-10', rem(fontSize[10])]);
  d.push(['--font-size-12', rem(fontSize[12])]);
  d.push(['--font-size-14', rem(fontSize[14])]);
  d.push(['--font-size-16', rem(fontSize[16])]);
  d.push(['--font-size-18', rem(fontSize[18])]);
  d.push(['--font-size-20', rem(fontSize[20])]);
  d.push(['--font-size-24', rem(fontSize[24])]);
  d.push(['--font-size-32', rem(fontSize[32])]);
  d.push(['--font-size-48', rem(fontSize[48])]);
  d.push(['--line-height-tight', String(lineHeight.tight)]);
  d.push(['--line-height-snug', String(lineHeight.snug)]);
  d.push(['--line-height-normal', String(lineHeight.normal)]);
  d.push(['--line-height-relaxed', String(lineHeight.relaxed)]);
  d.push(['--letter-spacing-display', em(letterSpacing.display)]);
  d.push(['--letter-spacing-caps', em(letterSpacing.caps)]);
  d.push(['--letter-spacing-body', em(letterSpacing.body)]);
  d.push(['--word-spacing-display', em(wordSpacing.display)]);

  // ── Spacing (4px base, rem) ──────────────────────────────────────────────
  d.push(['--space-1', rem(spacing[1])]);
  d.push(['--space-2', rem(spacing[2])]);
  d.push(['--space-3', rem(spacing[3])]);
  d.push(['--space-4', rem(spacing[4])]);
  d.push(['--space-5', rem(spacing[5])]);
  d.push(['--space-6', rem(spacing[6])]);
  d.push(['--space-8', rem(spacing[8])]);
  d.push(['--space-10', rem(spacing[10])]);
  d.push(['--space-12', rem(spacing[12])]);
  d.push(['--space-16', rem(spacing[16])]);
  d.push(['--space-20', rem(spacing[20])]);

  d.push(['--measure-prose', `${measureProse}ch`]);

  // ── Border radii (px) ──────────────────────────────────────────────────────
  d.push(['--radius-xs', `${radii.xs}px`]);
  d.push(['--radius-sm', `${radii.sm}px`]);
  d.push(['--radius-md', `${radii.md}px`]);
  d.push(['--radius-DEFAULT', `${radii.default}px`]);
  d.push(['--radius-lg', `${radii.lg}px`]);
  d.push(['--radius-pill', `${radii.pill}px`]);

  // ── Z-index ladder ─────────────────────────────────────────────────────────
  d.push(['--z-base', String(zIndex.base)]);
  d.push(['--z-sticky', String(zIndex.sticky)]);
  d.push(['--z-dropdown', String(zIndex.dropdown)]);
  d.push(['--z-overlay', String(zIndex.overlay)]);
  d.push(['--z-modal', String(zIndex.modal)]);
  d.push(['--z-toast', String(zIndex.toast)]);
  d.push(['--z-cookie', String(zIndex.cookie)]);
  d.push(['--z-top', String(zIndex.top)]);

  d.push(...palette.glow);

  d.push(...palette.rest);

  return d;
}

/**
 * The colour declarations the Daylight theme overrides. Same names as the dark
 * `@theme` colours, fed from `colorsDaylight`.
 */
export function daylightDeclarations(): Decl[] {
  const g = paletteGroups(colorsDaylight);
  return [...g.core, ...g.glassStage, ...g.glow, ...g.rest];
}

/**
 * Render the full generated CSS file (header comment + `@theme { ... }` + the Daylight override block).
 * The leading comment names the generator so no one hand-edits the output.
 */
export function generateThemeCss(): string {
  const decls = themeDeclarations()
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');

  const daylight = daylightDeclarations()
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');

  return `/* AUTO-GENERATED — DO NOT EDIT BY HAND.
 * Source of truth: packages/shared/src/tokens/*.ts
 * Regenerate: pnpm --filter @festie/shared gen:theme
 * Generator:  packages/shared/src/tokens/generateThemeCss.ts
 *
 * These are the design tokens shared with React Native (colors/type/spacing/
 * motion/radii/z-index/breakpoints). CSS-only tokens (11px/13px font sizes,
 * focus rings, glass blur, accent hover tones, timeline NOW, bg-chrome, the
 * rgb-channel + var()-referencing one-offs) stay hand-authored in theme.css.
 */
@theme {
${decls}
}

/* Daylight (high-contrast light theme for direct sun): the same colour
 * variables, fed from colorsDaylight. Applied by <html data-theme='daylight'>. */
:root[data-theme='daylight'] {
${daylight}
}
`;
}
