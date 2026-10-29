import React from 'react';
import {
  parseHex,
  toHex,
  relativeLuminance,
  srgbToLinear,
  linearToSrgb,
  ensureWhiteContrast,
  useUIStore,
} from '@festie/shared';
import type { ThemePreference } from '@festie/shared';
import { cn } from '../../lib/utils';

// Re-export so existing web imports (SetCard.tsx / SetCard.test.tsx import
// `ensureWhiteContrast` from this module) keep working unchanged after the
// pure helpers moved to @festie/shared/utils/contrast.
export { ensureWhiteContrast };

export type StageBadgeVariant = 'chip' | 'pick' | 'default';

interface StageBadgeProps {
  stageName: string;
  stageColor: string;
  variant?: StageBadgeVariant;
  /** Only meaningful for variant='chip' — inactive chips use a faded style. */
  active?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

// `default`/`pick` tighten to the mobile stage-pill density: the `micro` type
// role (10px / 600 / 0.08em caps) at spacing[2]/spacing[1] padding.
const VARIANT_CLASS: Record<StageBadgeVariant, string> = {
  chip: 'inline-flex items-center rounded-full px-3 py-2 text-xs font-semibold cursor-pointer border-2 border-transparent transition-[color,background-color,border-color,box-shadow] duration-200',
  pick: 'type-micro inline-block rounded-full px-2 py-1',
  default: 'type-micro inline-block rounded-full px-2 py-1',
};

// --- WCAG 2.2 contrast helpers (SC 1.4.3) ---
// The platform-agnostic math (parseHex/toHex/relativeLuminance/srgbToLinear/
// linearToSrgb/ensureWhiteContrast) now lives in @festie/shared so mobile can
// reuse it. Only the web-only, DOM-reading helpers stay below.

// Ensures stage-coloured TEXT has at least 4.5:1 contrast against the app
// ground. The ground is read live from the --color-bg-primary token (memoized
// per theme) so a retune of the canvas keeps the maths correct. Stage colours
// are data, tuned for the dark ground: in Daylight they are darkened toward
// black, as in the dark theme they are lightened. Falls back to the historical
// constants in non-DOM contexts (SSR / tests).
const FALLBACK_BG_RGB: Record<ThemePreference, [number, number, number]> = {
  stage: [8, 8, 16], // #080810
  daylight: [244, 244, 247], // #f4f4f7
};
const _bgRgbCache: Partial<Record<ThemePreference, [number, number, number]>> = {};

/** The theme the document is currently painted in. */
function currentTheme(): ThemePreference {
  if (typeof document === 'undefined') return 'stage';
  return document.documentElement.dataset.theme === 'daylight' ? 'daylight' : 'stage';
}

function getGroundRgb(theme: ThemePreference): [number, number, number] {
  const cached = _bgRgbCache[theme];
  if (cached) return cached;
  const fallback = FALLBACK_BG_RGB[theme];
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return fallback;
  // Only trust the live token when the document is actually in that theme.
  if (currentTheme() !== theme) return fallback;
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-primary').trim();
    const rgb = parseHex(raw);
    if (rgb) {
      _bgRgbCache[theme] = rgb;
      return rgb;
    }
  } catch {
    /* getComputedStyle can throw in detached documents — fall through */
  }
  return fallback;
}

// Solve a foreground hex up to 4.5:1 against an arbitrary background luminance.
// On a dark ground it brightens the foreground (k > 1) until the ratio is met; pure black falls
// back to the recessed stage-fallback token.
// Solve past 4.5:1. The composite is computed against the canvas, but chips also sit
// on header and card surfaces a shade off it; prod measured 4.48:1 in the sub-header.
const TARGET_RATIO = 4.7;
function adjustForBgLuminance(hex: string, bgLum: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  const lum = relativeLuminance(r, g, b);
  if (bgLum > 0.5) {
    // Light ground (Daylight): darken toward black until fg is 4.5:1 darker.
    if ((bgLum + 0.05) / (lum + 0.05) >= TARGET_RATIO) return hex;
    const darkTarget = (bgLum + 0.05) / TARGET_RATIO - 0.05;
    if (darkTarget <= 0 || lum === 0) return '#000000';
    const f = darkTarget / lum;
    return reachRatio(
      toHex(
        linearToSrgb(srgbToLinear(r) * f),
        linearToSrgb(srgbToLinear(g) * f),
        linearToSrgb(srgbToLinear(b) * f),
      ),
      bgLum,
      0,
    );
  }
  const ratio = (lum + 0.05) / (bgLum + 0.05);
  if (ratio >= TARGET_RATIO) return hex;
  const targetLum = TARGET_RATIO * (bgLum + 0.05) - 0.05;
  if (lum === 0) return 'var(--color-stage-fallback)'; // fallback for pure black
  const k = targetLum / lum;
  return reachRatio(
    toHex(
      linearToSrgb(Math.min(1, srgbToLinear(r) * k)),
      linearToSrgb(Math.min(1, srgbToLinear(g) * k)),
      linearToSrgb(Math.min(1, srgbToLinear(b) * k)),
    ),
    bgLum,
    255,
  );
}

// Scaling luminance overshoots the target when a channel clips at 1 (a deep
// purple's blue saturates long before 4.5:1) or when hex rounding lands just
// short. Finish by blending toward white (255) or black (0) until it passes.
function reachRatio(hex: string, bgLum: number, toward: 0 | 255): string {
  let rgb = parseHex(hex);
  if (!rgb) return hex;
  for (let i = 0; i < 40; i++) {
    const lum = relativeLuminance(rgb[0], rgb[1], rgb[2]);
    const ratio = (Math.max(lum, bgLum) + 0.05) / (Math.min(lum, bgLum) + 0.05);
    if (ratio >= TARGET_RATIO) break;
    rgb = rgb.map((c) => Math.round(c + (toward - c) * 0.1)) as [number, number, number];
  }
  return toHex(rgb[0], rgb[1], rgb[2]);
}

// The inactive chip paints the stage colour at ~0.125 alpha (the '20' hex
// suffix) over the canvas, so contrast must be solved against that COMPOSITE,
// not the bare canvas. Measuring against the (darker) canvas over-reported
// contrast for dark stage colours, letting them dip below AA on the tinted
// pill. Blend per-channel in sRGB, then take the luminance of the result.
export const CHIP_TINT_ALPHA = 0x20 / 0xff; // '20' hex alpha ≈ 0.125
export function inactiveChipTextColor(stageColor: string, theme: ThemePreference): string {
  const fg = parseHex(stageColor);
  if (!fg) return stageColor;
  const bg = getGroundRgb(theme);
  const composite: [number, number, number] = [
    Math.round(fg[0] * CHIP_TINT_ALPHA + bg[0] * (1 - CHIP_TINT_ALPHA)),
    Math.round(fg[1] * CHIP_TINT_ALPHA + bg[1] * (1 - CHIP_TINT_ALPHA)),
    Math.round(fg[2] * CHIP_TINT_ALPHA + bg[2] * (1 - CHIP_TINT_ALPHA)),
  ];
  const chipBgLum = relativeLuminance(composite[0], composite[1], composite[2]);
  return adjustForBgLuminance(stageColor, chipBgLum);
}

/**
 * Stage colour as plain TEXT on the app ground, solved to 4.5:1 in both themes:
 * lightened on the Stage ground, darkened on Daylight. Pass `theme` from the
 * store so the caller re-renders when the theme flips.
 */
export function stageTextColor(stageColor: string, theme: ThemePreference = currentTheme()): string {
  const bg = getGroundRgb(theme);
  return adjustForBgLuminance(stageColor, relativeLuminance(bg[0], bg[1], bg[2]));
}

export function getStageBadgeStyle(
  stageColor: string,
  variant: StageBadgeVariant = 'default',
  active = true,
  theme: ThemePreference = currentTheme(),
): React.CSSProperties {
  const isFadedChip = variant === 'chip' && !active;
  if (isFadedChip) {
    return {
      background: stageColor + '20',
      color: inactiveChipTextColor(stageColor, theme),
      borderColor: 'transparent',
    };
  }
  const bg = ensureWhiteContrast(stageColor);
  return {
    background: bg,
    color: 'var(--color-text-on-accent)',
    fontWeight: 700,
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
    borderColor: bg,
  };
}

export default function StageBadge({
  stageName,
  stageColor,
  variant = 'default',
  active = true,
  className,
  style,
}: StageBadgeProps) {
  const theme = useUIStore((state) => state.theme);
  const baseStyle = getStageBadgeStyle(stageColor, variant, active, theme);
  const variantClass = VARIANT_CLASS[variant];
  const activeClass = variant === 'chip' && active ? 'border-current' : '';

  return (
    <span className={cn(variantClass, activeClass, className)} style={{ ...baseStyle, ...style }}>
      {stageName}
    </span>
  );
}
