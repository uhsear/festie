import { colors } from '../tokens/colors';
import { POSTER } from '../tokens/poster';
import { parseHex, relativeLuminance } from './contrast';
// shortcut: tint is derived from the festival name because festivals have no cover image yet; derive from the cover once one exists.
function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
export function festivalTint(name: string | null | undefined) {
  const hue = fnv1a(String(name ?? '').trim().toLowerCase()) % 360;
  return { hue, bg: hslToHex(hue, 45, 6), pale: hslToHex(hue, 40, 12), faint: hslToHex(hue, 35, 20), active: hslToHex(hue, 85, 60) };
}

function hexHue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const contrastOnGround = (hex: string) => {
  const [hi, lo] = [lum(hex), lum(POSTER.colors.ground)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
function lum(hex: string): number {
  const [r, g, b] = parseHex(hex)!;
  return relativeLuminance(r, g, b);
}

/**
 * Colour of the one band on a share poster or OG image (OD-4 C). It is the festival hue, except
 * that a hue within `POSTER.band.hueExclusion` degrees of coral or aqua, or a hue that fails
 * `POSTER.band.minContrast` on the poster ground, falls back to `stage.fallback`: the festival
 * hue must never read as danger or as the primary accent.
 */
export function posterBand(name: string | null | undefined): { hue: number; colour: string; fallback: boolean } {
  const { hue, active } = festivalTint(name);
  const { hueExclusion, minContrast } = POSTER.band;
  const clash = [colors.accent.coral, colors.accent.aqua].some((c) => hueGap(hue, hexHue(c)) <= hueExclusion);
  const fallback = clash || contrastOnGround(active) < minContrast;
  return { hue, colour: fallback ? colors.stage.fallback : active, fallback };
}
