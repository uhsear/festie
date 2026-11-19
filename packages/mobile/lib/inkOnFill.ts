import { contrastRatioRgb, parseHex } from '@festie/shared/utils';

const rgbOrBlack = (hex: string): [number, number, number] => parseHex(hex) ?? [0, 0, 0];

/** WCAG contrast ratio between two opaque hex colours. */
export function contrastRatio(a: string, b: string): number {
  return contrastRatioRgb(rgbOrBlack(a), rgbOrBlack(b));
}

/**
 * Picks whichever of two ink colours reads better on a solid fill. The aqua
 * fill is light on Stage (dark ink wins) and dark on Daylight (white ink wins),
 * so a hard-coded `text.onLightAccent` fails AA on Daylight.
 */
export function inkOnFill(fill: string, inkA: string, inkB: string): string {
  return contrastRatio(inkA, fill) >= contrastRatio(inkB, fill) ? inkA : inkB;
}
