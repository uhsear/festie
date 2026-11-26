/**
 * Stage color resolution — platform-neutral.
 *
 * The festival API supplies a real color per stage (a hex). When a stage has no
 * color, the shared `useFestival.getStageColor` returns the neutral sentinel
 * `STAGE_COLOR_FALLBACK` rather than a web-only CSS custom property — shared must
 * stay free of `var(--…)` (RN can't parse it) and of any per-platform token name.
 *
 * Each platform maps the sentinel to its own muted value at the consumption
 * boundary via `resolveStageColor`:
 *   web    → resolveStageColor(c, 'var(--text-muted)')
 *   mobile → resolveStageColor(c, tokens.colors.text.muted)
 *
 * Everything here is PURE — no globals, no DOM, no RN — so both consumers and a
 * Vitest unit can call it identically.
 */

// Stage colours for a new stage. Muted hues that are none of the signal colours (aqua, live green, amber, coral,
// the stage violet), so a new stage never reads as a state. Each keeps 3:1 against the Stage and Daylight card
// grounds, so the card's stage rail shows on both. stageColor.test.ts holds these rules.
export const DEFAULT_STAGE_COLORS = ['#496ea2', '#6265bc', '#788b41', '#9d4d8d'] as const;

/** The colour a new stage starts with, so an organizer is not asked to pick one. Cycles through the palette. */
export const defaultStageColor = (existingStageCount: number): string =>
  DEFAULT_STAGE_COLORS[existingStageCount % DEFAULT_STAGE_COLORS.length]!;

/**
 * Neutral "no stage color" identifier returned by `getStageColor` when a stage
 * carries no API color. Deliberately NOT a valid CSS color and NOT a platform
 * token — callers must map it through `resolveStageColor` to a real value.
 */
export const STAGE_COLOR_FALLBACK = 'stage-color-fallback';

/**
 * Resolve a stage color to a concrete platform value. Returns `fallback` when the
 * color is missing or is the neutral `STAGE_COLOR_FALLBACK` sentinel; otherwise
 * returns the color unchanged (the real API hex).
 */
export function resolveStageColor(color: string | null | undefined, fallback: string): string {
  if (!color || color === STAGE_COLOR_FALLBACK) return fallback;
  return color;
}
