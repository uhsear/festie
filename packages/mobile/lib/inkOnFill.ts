import { parseHex, relativeLuminance } from '@festie/shared/utils';

function luminance(hex: string): number {
  const rgb = parseHex(hex);
  return rgb ? relativeLuminance(rgb[0], rgb[1], rgb[2]) : 0;
}

/** WCAG contrast ratio between two opaque hex colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Picks whichever of two ink colours reads better on a solid fill. The aqua
 * fill is light on Stage (dark ink wins) and dark on Daylight (white ink wins),
 * so a hard-coded `text.onLightAccent` fails AA on Daylight.
 */
export function inkOnFill(fill: string, inkA: string, inkB: string): string {
  return contrastRatio(inkA, fill) >= contrastRatio(inkB, fill) ? inkA : inkB;
}
