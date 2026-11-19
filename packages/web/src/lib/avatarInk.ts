import { relativeLuminance } from '@festie/shared/utils';

/**
 * Guarantee WCAG AA (4.5:1) for an avatar's initials on its generated colour.
 *
 * Avatar backgrounds come from `getAvatarColor` as `hsl(H S% L%)`. Fixed white
 * text fails on the lighter hues (axe `color-contrast`). White text is the right
 * look on the dark UI, so instead of switching ink we DARKEN the background
 * (drop lightness) until white clears — a small shift only for the few bright
 * hues, none for the already-dark ones. Non-hsl input (e.g. a mocked colour)
 * passes through unchanged with white text.
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const WHITE = '#ffffff';

export function avatarInk(background: string): { background: string; color: string } {
  const m = background.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/i);
  if (!m) return { background, color: WHITE };
  const h = parseFloat(m[1]!);
  const s = parseFloat(m[2]!);
  let l = parseFloat(m[3]!);
  const whiteClears = (L: number) => {
    const [r, g, b] = hslToRgb(h, s, L);
    return 1.05 / (relativeLuminance(r, g, b) + 0.05) >= 4.5;
  };
  // Drop lightness until white text clears AA. The floor (~L=6) is dark enough
  // that white clears for every hue, so the loop always resolves.
  while (l > 6 && !whiteClears(l)) l -= 4;
  return { background: `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`, color: WHITE };
}
