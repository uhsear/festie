// Line heights of the grid cell's text roles at font scale 1 (typeStyle: round(1.3 * size)).
const CAPTION_LINE_H = 16;
const MICRO_LINE_H = 13;
// Cell paddingVertical (5 + 5) plus the 1 dp border above and below.
const CELL_PAD_V = 12;
const CELL_GAP = 2;
const MAX_TITLE_LINES = 3;

/**
 * How many lines a set title may take in a cell of this height. The title gets
 * the room the padding and the time row leave, so a tall cell wraps a long
 * name in full while a short one ellipsizes on whole lines rather than
 * clipping half a line. `scale` is the OS font scale, already capped.
 */
export function cellTitleLines(height: number, scale: number, showTime: boolean): number {
  const timeH = showTime ? CELL_GAP + MICRO_LINE_H * scale : 0;
  const fit = Math.floor((height - CELL_PAD_V - timeH) / (CAPTION_LINE_H * scale));
  return Math.min(MAX_TITLE_LINES, Math.max(1, fit));
}

/** Height of one micro-role line (the NOW label, the hour labels) at this scale. */
export function microLineHeight(scale: number): number {
  return MICRO_LINE_H * scale;
}
