import { colors } from '../tokens/index.js';
import { parseHex, toHex } from './contrast';
import type { LockscreenPalette, LockscreenPosterArt, LockscreenPosterPage, LockscreenTheme } from './lockscreen';

/** Poster style: art in the top zone the OS draws over, a panel for the schedule band. Pure helpers, no layout of rows. */

const MAX_BEAMS = 5;
const BEAM_W = 15;
const PANEL_INSET = 2.5;
const RULE_H = 0.5;
const LIGHT_PANEL = '#f7f7fa';

/** Colour at `t` (0..1) between two hex colours. */
export function mixHex(from: string, to: string, t: number): string {
  const a = parseHex(from) ?? [0, 0, 0];
  const b = parseHex(to) ?? [0, 0, 0];
  const at = (i: number) => Math.round(a[i]! + (b[i]! - a[i]!) * t);
  return toHex(at(0), at(1), at(2));
}

/** One colour per character of `word`, from `from` to `to`; the same on web and mobile, so no gradient text API is needed. */
export function gradientColors(word: string, from: string, to: string): string[] {
  const chars = [...word];
  return chars.map((_, i) => mixHex(from, to, chars.length > 1 ? i / (chars.length - 1) : 0));
}

/**
 * Beams stand in the reserved top zone (above `artEndU`, the sheet top); the panel stays inside the
 * content band so the OS never covers schedule text. `stageMarks` are theme-adjusted stage colours.
 */
export function buildPosterArt(args: {
  stageMarks: string[];
  palette: LockscreenPalette;
  theme: LockscreenTheme;
  sideU: number;
  artEndU: number;
  contentTopU: number;
  contentEndU: number;
}): LockscreenPosterArt {
  const { stageMarks, palette, theme, sideU, artEndU, contentTopU, contentEndU } = args;
  const marks = stageMarks.slice(0, MAX_BEAMS);
  return {
    beams: marks.map((color, i) => ({
      color,
      x: (100 * (i + 0.5)) / marks.length - BEAM_W / 2,
      width: BEAM_W,
      y: 0,
      height: Math.max(0, artEndU),
    })),
    panel: {
      x: sideU - PANEL_INSET,
      y: contentTopU,
      width: 100 - 2 * (sideU - PANEL_INSET),
      height: contentEndU - contentTopU,
      radiusU: 3,
      fill: theme === 'dark' ? colors.bg.secondary : LIGHT_PANEL,
      border: palette.border,
    },
    headline: { from: palette.want, to: palette.must },
  };
}

/** Per-page poster pieces: gradient headline letters and the stage-colour rule that replaces the header hairline. */
export function buildPosterPage(
  art: LockscreenPosterArt,
  day: string,
  pageStageMarks: string[],
  sideU: number,
  ruleY: number,
): LockscreenPosterPage {
  const inner = 100 - 2 * sideU;
  const marks = pageStageMarks.length ? pageStageMarks : [art.headline.from];
  const width = inner / marks.length;
  return {
    dayColors: gradientColors(day, art.headline.from, art.headline.to),
    rule: marks.map((color, i) => ({ color, x: sideU + i * width, y: ruleY, width, height: RULE_H })),
  };
}
