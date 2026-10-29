import { parseHex, toHex, relativeLuminance, srgbToLinear, linearToSrgb } from '@festie/shared/utils';

/** Luminance where black and white text have equal contrast (~4.58:1 each). */
const MID_LUMINANCE = 0.18;
const TARGET_RATIO = 4.6;

/**
 * Move a server-supplied stage color away from the sheet background until it
 * reaches ~4.6:1 as TEXT (F26). Over a dark sheet (Stage) the hue is lifted;
 * over a light sheet (Daylight) it is darkened. Lifting on a light sheet would
 * fade the label toward white. 4.6 absorbs 8-bit rounding. Returns the input
 * unchanged for unparseable colors (safeStageColor strips `var(...)` upstream).
 */
export function ensureStageTextContrast(hex: string, bgHex: string): string {
  const fg = parseHex(hex);
  const bg = parseHex(bgHex);
  if (!fg || !bg) return hex;
  const bgLum = relativeLuminance(bg[0], bg[1], bg[2]);
  const ratio = (lum: number) => (Math.max(lum, bgLum) + 0.05) / (Math.min(lum, bgLum) + 0.05);
  const factor = bgLum > MID_LUMINANCE ? 0.8 : 1.25;
  let [r, g, b] = fg;
  // Cap iterations so a near-black-on-black input still terminates.
  for (let i = 0; i < 24; i++) {
    if (ratio(relativeLuminance(r, g, b)) >= TARGET_RATIO) break;
    // A floor gives an essentially black color something to scale up from.
    const floor = factor > 1 ? 0.02 : 0;
    r = linearToSrgb(Math.max(srgbToLinear(r), floor) * factor);
    g = linearToSrgb(Math.max(srgbToLinear(g), floor) * factor);
    b = linearToSrgb(Math.max(srgbToLinear(b), floor) * factor);
    if (factor > 1 && r >= 255 && g >= 255 && b >= 255) break;
  }
  return toHex(r, g, b);
}
