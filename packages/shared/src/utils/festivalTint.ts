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
