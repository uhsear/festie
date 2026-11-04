import type { FestivalSet, Priority, Stage } from '../types/domain';
import { clashBadgeBySetId, detectConflicts } from './conflicts';
import { parseHex, relativeLuminance, toHex } from './contrast';
import { artistDisplayName, formatTime } from './format';
import {
  LOCKSCREEN_ZONES,
  type LockscreenGridBlock,
  type LockscreenGridPage,
  type LockscreenHeader,
  type LockscreenInput,
  type LockscreenListPage,
  type LockscreenListRow,
  type LockscreenMode,
  type LockscreenModel,
  type LockscreenPageModel,
  type LockscreenPalette,
  type LockscreenTheme,
} from './lockscreen';
import { buildPosterArt, buildPosterPage } from './lockscreenPoster';
import { formatDayChip } from './scheduleFormat';
import { festivalStartMinutes, setMinuteRange, startsAfterMidnight } from './setStatus';

const HHMM = /^\d{1,2}:\d{2}$/;
const HEADER_H = 11;
const HEADER_GAP = 1.5;
const STAGE_ROW_H = 4;
/** The last hour label and the legend share this line: the legend sits right of the label, in the columns area. */
const LEGEND_H = 3.3;
const DIVIDER_H = 4;
const GUTTER_W = 5;
const COL_GAP = 0.8;
const MAX_HOUR_U = 16;
const DARK_BG = '#0a0a0a';
const LIGHT_SHEET = '#ffffff';
const NEAR_BLACK = '#0a0a0a';
const WHITE = '#ffffff';
const FALLBACK_STAGE = '#9999bb';
const LEGEND = '■ your pick  ★ must  ● want  ○ maybe';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const LOCKSCREEN_PALETTES: Record<LockscreenTheme, LockscreenPalette> = {
  dark: {
    text: '#eaeaf2', text2: '#9999bb', muted: '#8787a8', surface: '#17171f', border: '#26263a',
    must: '#ff3366', want: '#00e8d0', maybe: '#ffb020', clash: '#ffb020',
  },
  light: {
    text: '#0b0b12', text2: '#2e2e44', muted: '#45455c', surface: '#eeeef4', border: '#c9c9d6',
    must: '#a8002a', want: '#00594f', maybe: '#6b4100', clash: '#6b4100',
  },
};

/**
 * Minimum grid hour height in u by column count. Spec 4.5 proposed 11 / 12 / 13, but with
 * the 11u header and the legend, a full EDC Friday (13:00-24:00, 5 stages) needs more than
 * two images at 13u. 11 / 11.5 keeps it at two.
 */
const minHourU = (cols: number) => (cols <= 2 ? 11 : 11.5);

interface TierSpec {
  tier: 'XL' | 'L' | 'M';
  timeU: number;
  periodU: number;
  artistU: number;
  maxLines: number;
  twoLine: boolean;
}
const XL: TierSpec = { tier: 'XL', timeU: 7.4, periodU: 2.6, artistU: 7.6, maxLines: 3, twoLine: true };
const L: TierSpec = { tier: 'L', timeU: 6.2, periodU: 2.4, artistU: 6.4, maxLines: 2, twoLine: true };
const M56: TierSpec = { tier: 'M', timeU: 5.4, periodU: 2.27, artistU: 5.6, maxLines: 1, twoLine: false };
const M46: TierSpec = { tier: 'M', timeU: 5.4, periodU: 2.27, artistU: 4.6, maxLines: 2, twoLine: false };

// ---- colour -------------------------------------------------------------

const rgbOf = (hex: string): [number, number, number] => parseHex(hex) ?? parseHex(FALLBACK_STAGE)!;
const lum = (hex: string) => relativeLuminance(...rgbOf(hex));

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Mix `hex` toward white (dark theme) or black (light theme) until it reaches `target`:1 on `bg`. */
function adjustToContrast(hex: string, bg: string, theme: LockscreenTheme, target: number): string {
  const [r, g, b] = rgbOf(hex);
  const toward = theme === 'dark' ? 255 : 0;
  for (let step = 0; step <= 50; step++) {
    const mix = (c: number) => Math.round(c + ((toward - c) * step) / 50);
    const out = toHex(mix(r), mix(g), mix(b));
    if (contrastRatio(out, bg) >= target) return out;
  }
  return toHex(toward, toward, toward);
}

const themeBg = (theme: LockscreenTheme) => (theme === 'dark' ? DARK_BG : LIGHT_SHEET);
/** Stage colour for text, at least 4.5:1 on the theme background. */
export const stageText = (hex: string, theme: LockscreenTheme) => adjustToContrast(hex, themeBg(theme), theme, 4.5);
/** Stage colour for bars, chips and blocks, at least 3:1 on the theme background. */
export const stageMark = (hex: string, theme: LockscreenTheme) => adjustToContrast(hex, themeBg(theme), theme, 3);
/** Near-black or white, whichever reads better on `fill`. */
export const inkOn = (fill: string) =>
  contrastRatio(NEAR_BLACK, fill) >= contrastRatio(WHITE, fill) ? NEAR_BLACK : WHITE;

// ---- text fitting -------------------------------------------------------

// shortcut: width table, not measured text; replace with per-platform measuring if a name clips in QA.
// Calibrated on Clash Display 600-700, measured on staging and local renders: capitals run wider than lowercase.
const glyphEm = (ch: string) => (ch === ' ' ? 0.3 : ch !== ch.toLowerCase() ? 0.76 : 0.6);
const wordWidthU = (word: string, sizeU: number) => [...word].reduce((sum, ch) => sum + glyphEm(ch), 0) * sizeU;

/** Largest size from `startU` down to `floorU` (steps of 0.2u) at which the longest word fits `widthU`. */
export function fitArtistU(text: string, startU: number, floorU: number, widthU: number): number {
  const words = text.split(/\s+/);
  for (let size = startU; size > floorU; size = Math.round((size - 0.2) * 10) / 10) {
    if (words.every((w) => wordWidthU(w, size) <= widthU)) return size;
  }
  return floorU;
}

/** Cuts `word` to fit `widthU` and ends it with an ellipsis. Never returns an empty string. */
function ellipsizeWord(word: string, sizeU: number, widthU: number): string {
  if (wordWidthU(word, sizeU) <= widthU) return word;
  const chars = [...word];
  let n = chars.length - 1;
  while (n > 1 && wordWidthU(`${chars.slice(0, n).join('')}…`, sizeU) > widthU) n--;
  return `${chars.slice(0, n).join('')}…`;
}

/** Greedy word wrap using the width table. Lines break only between words; a word wider than a line is ellipsized. */
export function wrapArtist(text: string, sizeU: number, widthU: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const word = ellipsizeWord(raw, sizeU, widthU);
    const joined = line ? `${line} ${word}` : word;
    if (!line || wordWidthU(joined, sizeU) <= widthU) line = joined;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function clampLines(lines: string[], max: number): { lines: string[]; clamped: boolean } {
  if (lines.length <= max) return { lines, clamped: false };
  const kept = lines.slice(0, Math.max(1, max));
  kept[kept.length - 1] = `${kept[kept.length - 1]!.replace(/[-…]$/, '')}…`;
  return { lines: kept, clamped: true };
}

// ---- pagination ---------------------------------------------------------

/** Split `n` items into `k` near-equal ranges, larger ranges first (14 in 2 gives 7+7, never 12+2). */
export function balancedRanges(n: number, k: number): Array<[number, number]> {
  const base = Math.floor(n / k);
  const extra = n % k;
  const out: Array<[number, number]> = [];
  let at = 0;
  for (let i = 0; i < k; i++) {
    const size = base + (i < extra ? 1 : 0);
    out.push([at, at + size]);
    at += size;
  }
  return out;
}

/** Fewest balanced pages for which `fits(start, end)` holds on every page; one row per page if none does. */
function paginateBy(n: number, fits: (start: number, end: number) => boolean): Array<[number, number]> {
  for (let k = 1; k <= n; k++) {
    const ranges = balancedRanges(n, k);
    if (ranges.every(([a, b]) => fits(a, b))) return ranges;
  }
  return balancedRanges(n, n);
}

/** Fewest balanced pages whose row heights each fit `availU`. Falls back to one row per page. */
export function paginateRows(rowHeightsU: number[], availU: number): Array<[number, number]> {
  if (!rowHeightsU.length) return [];
  return paginateBy(rowHeightsU.length, (a, b) => rowHeightsU.slice(a, b).reduce((x, y) => x + y, 0) <= availU + 1e-9);
}

export interface GridPagePlan {
  /** Festival-day minutes, whole hours. */
  startMinute: number;
  endMinute: number;
}

/**
 * Cuts a grid's time span into pages on whole hours. Every page gets the same hour height.
 * `startMinutes` are the sets' start times; cuts balance how many sets start on each page.
 * `onePage` forces one page and lets the hour height fall below the minimum.
 */
export function gridPages(
  startMinute: number,
  endMinute: number,
  startMinutes: number[],
  cols: number,
  availU: number,
  onePage: boolean,
): { pages: GridPagePlan[]; hourU: number } {
  const hours = Math.max(1, Math.round((endMinute - startMinute) / 60));
  const maxHours = Math.max(1, Math.floor(availU / minHourU(cols) + 1e-9));
  const k = onePage ? 1 : Math.ceil(hours / maxHours);
  const cuts: number[] = [0];
  for (let j = 1; j < k; j++) {
    const ideal = (startMinutes.length * j) / k;
    const prev = cuts[j - 1]!;
    const lo = Math.max(prev + 1, hours - (k - j) * maxHours);
    const hi = Math.min(prev + maxHours, hours - (k - j));
    let best = lo;
    let bestGap = Infinity;
    for (let c = lo; c <= hi; c++) {
      const before = startMinutes.filter((m) => m < startMinute + c * 60).length;
      const gap = Math.abs(before - ideal);
      if (gap < bestGap) {
        best = c;
        bestGap = gap;
      }
    }
    cuts.push(best);
  }
  cuts.push(hours);
  const pages = cuts.slice(0, -1).map((c, i) => ({
    startMinute: startMinute + c * 60,
    endMinute: startMinute + cuts[i + 1]! * 60,
  }));
  const longest = Math.max(...pages.map((p) => (p.endMinute - p.startMinute) / 60));
  return { pages, hourU: Math.min(MAX_HOUR_U, availU / longest) };
}

// ---- small formatters ---------------------------------------------------

const h12 = (h: number) => h % 12 || 12;
const hourOfDay = (min: number) => Math.floor(min / 60) % 24;
const meridiem = (min: number) => (hourOfDay(min) >= 12 ? 'PM' : 'AM');
const minuteText = (min: number) => (min % 60 ? `:${String(min % 60).padStart(2, '0')}` : '');

/** "1p", "12a", "7:30p" for a festival-day minute. */
const shortTime = (min: number) => `${h12(hourOfDay(min))}${minuteText(min)}${meridiem(min) === 'PM' ? 'p' : 'a'}`;
/** "1-2:25" with no meridiem, for inline block times. */
const compactRange = (start: number, end: number) =>
  `${h12(hourOfDay(start))}${minuteText(start)}-${h12(hourOfDay(end))}${minuteText(end)}`;

/** "5-9 PM" or "1 PM-12 AM". */
function spanLabel(startMin: number, endMin: number): string {
  const s = `${h12(hourOfDay(startMin))}`;
  const e = `${h12(hourOfDay(endMin))} ${meridiem(endMin)}`;
  return meridiem(startMin) === meridiem(endMin) ? `${s}-${e}` : `${s} ${meridiem(startMin)}-${e}`;
}

function savedStamp(d: Date): string {
  const time = formatTime(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${time}`;
}

function initialsOf(m: { name?: string; username?: string }): string {
  const words = (m.name || m.username || '?').trim().split(/\s+/);
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : words[0]!.slice(0, 2);
  return letters.toUpperCase();
}

/** Renderer helper: real screen px, falling back to 1290x2796 when it is not a tall portrait phone (9:18 to 9:21). */
export function lockscreenSizeFromScreen(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): { width: number; height: number } {
  const width = Math.round(cssWidth * pixelRatio);
  const height = Math.round(cssHeight * pixelRatio);
  const ratio = height / width;
  return width > 0 && ratio >= 2 && ratio <= 21 / 9 ? { width, height } : { width: 1290, height: 2796 };
}

/** `festie-edc-orlando-fri-picks-1of2.png` */
export function lockscreenFilename(
  festivalName: string,
  dayLabel: string,
  mode: LockscreenMode,
  index: number,
  total: number,
): string {
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const name = slug(festivalName.replace(/\s+\d{4}$/, '')).slice(0, 40).replace(/-+$/, '');
  return `festie-${name}-${slug(dayLabel).slice(0, 3)}-${mode}-${index}of${total}.png`;
}

// ---- model --------------------------------------------------------------

interface Item {
  set: FestivalSet;
  priority: Priority | null;
  start: number;
  end: number;
}

interface Ctx {
  input: LockscreenInput;
  palette: LockscreenPalette;
  stageById: Map<string, Stage>;
  stageOrder: Map<string, number>;
  contentTopU: number;
  contentEndU: number;
  sideU: number;
}

function stageColors(stage: Stage | undefined, theme: LockscreenTheme) {
  const raw = stage?.color && parseHex(stage.color) ? stage.color : FALLBACK_STAGE;
  const mark = stageMark(raw, theme);
  return { text: stageText(raw, theme), mark, ink: inkOn(mark) };
}

const shortStageName = (name: string) => name.split(/\s+/)[0]!.slice(0, 10);

function selectItems(input: LockscreenInput, dayIndex: number): Item[] {
  const { sets, picks, mode } = input;
  const wanted = input.priorities?.length ? new Set(input.priorities) : null;
  const stageIds = input.stageIds ? new Set(input.stageIds) : null;
  const items: Item[] = [];
  for (const set of sets) {
    if ((set.dayIndex ?? 0) !== dayIndex || !HHMM.test(set.startTime ?? '')) continue;
    const priority = picks?.[set.id] ?? null;
    if ((mode === 'picks' || mode === 'crew') && (!priority || (wanted && !wanted.has(priority)))) continue;
    if (mode === 'stages' && stageIds && !stageIds.has(set.stageId)) continue;
    const start = festivalStartMinutes(set.startTime);
    items.push({ set, priority, start, end: setMinuteRange(set)?.end ?? start + 60 });
  }
  return items.sort((a, b) => a.start - b.start);
}

function dayIndexesFor(input: LockscreenInput): number[] {
  if (input.dayIndex !== 'all') return [input.dayIndex];
  const seen = new Set<number>(input.days.map((d, i) => d.dayIndex ?? i));
  for (const s of input.sets) seen.add(s.dayIndex ?? 0);
  return [...seen].sort((a, b) => a - b).filter((d) => selectItems(input, d).length > 0);
}

function modeLabel(input: LockscreenInput, count: number): string {
  switch (input.mode) {
    case 'full':
      return 'Full lineup';
    case 'crew':
      return `Picks + crew · ${count}`;
    default:
      return input.priorities?.length === 1 && input.priorities[0] === 'must'
        ? `Must-sees · ${count}`
        : `My picks · ${count}`;
  }
}

function buildHeader(ctx: Ctx, dayIndex: number, chip: string | null, metaBottom: string): LockscreenHeader {
  const { input } = ctx;
  const day = input.days.find((d, i) => (d.dayIndex ?? i) === dayIndex);
  const dayChip = day ? formatDayChip(day) : null;
  const word = (dayChip?.label ?? `Day ${dayIndex + 1}`).toUpperCase();
  const availW = 100 - 2 * ctx.sideU - 38 - (chip ? 10 : 0);
  const daySizeU = Math.max(6, Math.min(7.4, availW / (word.length * 0.66)));
  const festName = input.festival.name.replace(/\s+\d{4}$/, '');
  const metaTop = dayChip?.date ? `${festName} · ${dayChip.date}` : festName;
  // Room left of the day word and chip; the meta lines shrink to fit it on one line each.
  const metaAvail = 100 - 2 * ctx.sideU - word.length * 0.66 * daySizeU - (chip ? 9 : 0) - 2;
  return {
    day: word,
    daySizeU: Math.round(daySizeU * 10) / 10,
    pageChip: chip,
    metaTop,
    metaBottom,
    metaSizeU: Math.round(Math.max(2.2, Math.min(2.9, metaAvail / (Math.max(metaTop.length, metaBottom.length) * 0.58))) * 10) / 10,
    y: ctx.contentTopU,
    height: HEADER_H,
  };
}

// ---- list pages ---------------------------------------------------------

type BaseRow = Omit<LockscreenListRow, 'y' | 'height' | 'artistLines'>;

function baseRows(items: Item[], ctx: Ctx): BaseRow[] {
  const { input } = ctx;
  const picked = input.sets.filter((s) => input.picks?.[s.id] && HHMM.test(s.startTime ?? '') && s.endTime);
  const day = items[0]?.set.dayIndex ?? 0;
  const pairs = detectConflicts(
    picked.filter((s) => (s.dayIndex ?? 0) === day),
    (id) => input.picks?.[id],
  );
  const clashes = clashBadgeBySetId(pairs, input.festival.b2bSeparator);
  return items.map((it) => {
    const stage = ctx.stageById.get(it.set.stageId);
    const colors = stageColors(stage, input.theme);
    const [time = '', period = ''] = formatTime(it.set.startTime).split(' ');
    const badge = clashes.get(it.set.id);
    const members = (input.mode === 'crew' ? (input.crewOverlap?.[it.set.id]?.members ?? []) : []).filter(
      (m) => m.userId !== input.selfUserId,
    );
    return {
      setId: it.set.id,
      time,
      period,
      until: `to ${formatTime(it.set.endTime).replace(/ [AP]M$/, '')}`,
      artist: artistDisplayName(it.set, input.festival.b2bSeparator).normalize('NFC'),
      stage: stage?.name ?? '',
      stageShort: shortStageName(stage?.name ?? ''),
      stageText: colors.text,
      stageMark: colors.mark,
      ink: colors.ink,
      priority: it.priority,
      clash: badge ? { label: badge.label, short: 'clash' as const } : null,
      crew:
        input.mode === 'crew'
          ? { initials: members.slice(0, 3).map(initialsOf), more: Math.max(0, members.length - 3), solo: members.length === 0 }
          : null,
    };
  });
}

function listColumns(
  spec: TierSpec,
  side: number,
  crew: boolean,
  clashWord: boolean,
  rows: BaseRow[],
): LockscreenListPage['layout'] {
  // Widest "time period" on the page, from the width table, so '10:30 PM' never clips.
  const widest = Math.max(
    0,
    ...rows.map((r) => wordWidthU(r.time, spec.timeU) + wordWidthU(` ${r.period}`, spec.periodU) * 1.1),
  );
  const marks = 6 + (crew ? 14 : 0) + (clashWord && !spec.twoLine ? 8 : 0);
  if (spec.twoLine) {
    const timeX = side + 2.4;
    const timeWidth = Math.max(spec.timeU * 3.3, widest);
    const artistX = timeX + timeWidth + 2;
    return { barX: side, timeX, timeWidth, chipX: null, chipWidth: 0, artistX, artistWidth: 100 - side - marks - artistX };
  }
  const timeWidth = Math.max(17.5, widest);
  const chipX = side + timeWidth + 1.5;
  const artistX = chipX + 13 + 2;
  return { barX: side, timeX: side, timeWidth, chipX, chipWidth: 13, artistX, artistWidth: 100 - side - marks - artistX };
}

/** Real fonts run wider than the width table; wrap list names a little early so the native one-line clamp never cuts them. */
const LIST_FIT = 0.92;

function rowHeightU(spec: TierSpec, lines: number): number {
  if (!spec.twoLine) return lines * spec.artistU * 1.1 + 2.2;
  return Math.max(spec.timeU * 1.1 + 3.6, lines * spec.artistU * 1.12 + 3.75) + 3.2;
}

/** Lays one page's rows out at `spec`, or null when they do not fit `availU` (or a tier-M row wraps at 5.6u). */
function layoutList(
  rows: BaseRow[],
  items: Item[],
  spec: TierSpec,
  ctx: Ctx,
  y0: number,
  availU: number,
  force: boolean,
): LockscreenListPage | null {
  const layout = listColumns(spec, ctx.sideU, ctx.input.mode === 'crew', rows.some((r) => r.clash), rows);
  const sized = rows.map((r) => {
    const wrapped = wrapArtist(r.artist, spec.artistU, layout.artistWidth * LIST_FIT);
    return { lines: clampLines(wrapped, spec.maxLines).lines, tooLong: wrapped.length > spec.maxLines };
  });
  if (!force && spec === M56 && sized.some((s) => s.tooLong)) return null;
  const dividerAt = items.findIndex((it, i) => i > 0 && startsAfterMidnight(it.set.startTime) && !startsAfterMidnight(items[i - 1]!.set.startTime));
  let y = y0;
  const out = rows.map((r, i): LockscreenListRow => {
    if (i === dividerAt) y += DIVIDER_H;
    const height = rowHeightU(spec, sized[i]!.lines.length);
    const row = { ...r, artistLines: sized[i]!.lines, y, height };
    y += height;
    return row;
  });
  if (!force && y - y0 > availU + 1e-9) return null;
  const dayWord = ctx.input.days.find((d, i) => (d.dayIndex ?? i) === (items[0]?.set.dayIndex ?? 0));
  const label = `AFTER MIDNIGHT · STILL ${(dayWord ? formatDayChip(dayWord).label : 'TONIGHT').toUpperCase()}`;
  return {
    kind: 'list',
    tier: spec.tier,
    artistSizeU: spec.artistU,
    timeSizeU: spec.timeU,
    layout,
    rows: out,
    divider: dividerAt > 0 ? { beforeIndex: dividerAt, y: out[dividerAt]!.y - DIVIDER_H / 2, label } : null,
  };
}

function listPages(items: Item[], ctx: Ctx): LockscreenListPage[] {
  const rows = baseRows(items, ctx);
  const y0 = ctx.contentTopU + HEADER_H + HEADER_GAP;
  const availU = ctx.contentEndU - y0;
  const tryPage = (a: number, b: number, force: boolean): LockscreenListPage | null => {
    const n = b - a;
    const specs = [...(n <= 4 ? [XL] : []), ...(n <= 7 ? [L] : []), M56, M46];
    for (const spec of specs) {
      const page = layoutList(rows.slice(a, b), items.slice(a, b), spec, ctx, y0, availU, force && spec === M46);
      if (page) return page;
    }
    return null;
  };
  const ranges = paginateBy(items.length, (a, b) => tryPage(a, b, false) !== null);
  return ranges.map(([a, b]) => tryPage(a, b, true)!);
}

// ---- grid pages ---------------------------------------------------------

const GRID_FLOOR_U = 2.2;

function buildBlock(
  it: Item,
  col: { x: number; width: number; mark: string },
  page: { startMinute: number; endMinute: number; gridY: number; hourU: number },
  ctx: Ctx,
  cols: number,
): LockscreenGridBlock {
  const { input, palette } = ctx;
  const picked = it.priority !== null;
  const colors = stageColors(ctx.stageById.get(it.set.stageId), input.theme);
  const from = Math.max(it.start, page.startMinute);
  const to = Math.min(it.end, page.endMinute);
  const y = page.gridY + ((from - page.startMinute) / 60) * page.hourU;
  const height = Math.max(0, ((to - from) / 60) * page.hourU - 0.3);
  const artist = artistDisplayName(it.set, input.festival.b2bSeparator);
  const carryOver = it.start < page.startMinute;
  const inlineTime = cols <= 2 && !carryOver ? compactRange(it.start, it.end) : null;
  const text = carryOver ? `↑ ${shortTime(it.start)} ${artist}` : inlineTime ? `${artist} ${inlineTime}` : artist;
  const textMode = height < 4.5 ? 'none' : height < 7.6 ? 'name' : 'full';
  const textW = col.width - 0.8 - 1 - 1.2;
  const timeLine = textMode === 'full' && !inlineTime ? 3 : 0;
  const maxLinesFor = (size: number) => Math.max(0, Math.floor((height - 1.6 - timeLine) / (size * 1.12)));
  const start = cols <= 2 ? 4.8 : 4;
  let size = fitArtistU(text, start, GRID_FLOOR_U, textW);
  let lines = wrapArtist(text, size, textW);
  while (size > GRID_FLOOR_U && lines.length > maxLinesFor(size)) {
    size = Math.round((size - 0.2) * 10) / 10;
    lines = wrapArtist(text, size, textW);
  }
  const maxLines = textMode === 'none' ? 0 : maxLinesFor(size);
  const clamped = clampLines(lines, maxLines);
  return {
    setId: it.set.id,
    stageId: it.set.stageId,
    x: col.x,
    y,
    width: col.width,
    height,
    time: shortTime(it.start),
    artist,
    artistSizeU: size,
    maxLines,
    textMode,
    artistLines: textMode === 'none' ? [] : clamped.lines,
    ellipsis: textMode !== 'none' && clamped.clamped,
    inlineTime,
    priority: it.priority,
    picked,
    fill: picked ? colors.mark : palette.surface,
    edge: colors.mark,
    ink: picked ? colors.ink : palette.text,
    outline: picked && input.theme === 'light' ? '#0b0b12' : null,
    ring: it.priority === 'must',
    carryOver,
    carryLabel: carryOver ? `↑ ${shortTime(it.start)} ${artist}` : null,
  };
}

function gridPageModels(items: Item[], ctx: Ctx): { page: LockscreenGridPage; items: Item[]; span: string }[] {
  const { input } = ctx;
  const stageIds = [...new Set(items.map((i) => i.set.stageId))].sort(
    (a, b) => (ctx.stageOrder.get(a) ?? 1e6) - (ctx.stageOrder.get(b) ?? 1e6),
  );
  const cols = stageIds.length;
  const colW = (100 - 2 * ctx.sideU - GUTTER_W - COL_GAP * (cols - 1)) / cols;
  const columns = stageIds.map((id, i) => {
    const stage = ctx.stageById.get(id);
    const colors = stageColors(stage, input.theme);
    return {
      stageId: id,
      name: stage?.name ?? '',
      short: shortStageName(stage?.name ?? ''),
      x: ctx.sideU + GUTTER_W + i * (colW + COL_GAP),
      width: colW,
      text: colors.text,
      mark: colors.mark,
    };
  });
  const headerY = ctx.contentTopU + HEADER_H + HEADER_GAP;
  const gridY = headerY + STAGE_ROW_H;
  const availU = ctx.contentEndU - gridY - LEGEND_H;
  const first = Math.floor(Math.min(...items.map((i) => i.start)) / 60) * 60;
  const last = Math.ceil(Math.max(...items.map((i) => i.end)) / 60) * 60;
  const { pages, hourU } = gridPages(first, last, items.map((i) => i.start), cols, availU, !!input.onePage);
  return pages.map((p) => {
    const inPage = items.filter((i) => i.end > p.startMinute && i.start < p.endMinute);
    const blocks = inPage.map((it) =>
      buildBlock(it, columns.find((c) => c.stageId === it.set.stageId)!, { ...p, gridY, hourU }, ctx, cols),
    );
    const hoursInPage = (p.endMinute - p.startMinute) / 60;
    const hours = Array.from({ length: hoursInPage + 1 }, (_, i) => {
      const min = p.startMinute + i * 60;
      return { label: shortTime(min), y: gridY + i * hourU, dashed: min === 1440 };
    });
    const page: LockscreenGridPage = {
      kind: 'grid',
      columns,
      gutterWidth: GUTTER_W,
      startMinute: p.startMinute,
      endMinute: p.endMinute,
      hourU,
      headerY,
      gridY,
      hours,
      blocks,
      legend: LEGEND,
      legendX: ctx.sideU + GUTTER_W,
      legendY: gridY + hoursInPage * hourU + 0.3,
    };
    return { page, items: inPage.filter((i) => i.start >= p.startMinute), span: spanLabel(p.startMinute, p.endMinute) };
  });
}

/** Theme-adjusted marks of the stages a page draws, in festival stage order. */
function pageStageMarks(setIds: string[], ctx: Ctx): string[] {
  const shown = new Set(ctx.input.sets.filter((s) => setIds.includes(s.id)).map((s) => s.stageId));
  return [...shown]
    .sort((a, b) => (ctx.stageOrder.get(a) ?? 1e6) - (ctx.stageOrder.get(b) ?? 1e6))
    .map((id) => stageColors(ctx.stageById.get(id), ctx.input.theme).mark);
}

// ---- entry point --------------------------------------------------------

export function buildLockscreenModel(input: LockscreenInput): LockscreenModel {
  const { width, height, theme } = input;
  const heightU = (height / width) * 100;
  const contentTopU = (input.tallClock ? LOCKSCREEN_ZONES.tallTop : LOCKSCREEN_ZONES.top) * heightU;
  const ctx: Ctx = {
    input,
    palette: LOCKSCREEN_PALETTES[theme],
    stageById: new Map(input.stages.map((s) => [s.id, s])),
    stageOrder: new Map(input.stages.map((s, i) => [s.id, i])),
    contentTopU,
    contentEndU: LOCKSCREEN_ZONES.contentEnd * heightU,
    sideU: LOCKSCREEN_ZONES.sidePadU,
  };

  const series: { dayIndex: number; pages: Omit<LockscreenPageModel, 'footer'>[] }[] = [];
  for (const dayIndex of dayIndexesFor(input)) {
    const items = selectItems(input, dayIndex);
    if (!items.length) continue;
    const isGrid = input.mode === 'full' || input.mode === 'stages';
    const bodies = isGrid
      ? gridPageModels(items, ctx).map((g) => ({ body: g.page as LockscreenPageModel['body'], ids: g.items, tail: g.span }))
      : (() => {
          const pages = listPages(items, ctx);
          let at = 0;
          return pages.map((p) => {
            const ids = items.slice(at, at + p.rows.length);
            at += p.rows.length;
            const lastEnd = ids.reduce((a, b) => (b.end > a.end ? b : a));
            const tail = pages.length > 1 ? `to ${formatTime(lastEnd.set.endTime).replace(':00', '')}` : '';
            return { body: p as LockscreenPageModel['body'], ids, tail };
          });
        })();
    const n = bodies.length;
    series.push({
      dayIndex,
      pages: bodies.map((b, i) => {
        const chip = n > 1 ? `${i + 1}/${n}` : null;
        const label =
          input.mode === 'stages'
            ? `${(b.body as LockscreenGridPage).columns.length} ${(b.body as LockscreenGridPage).columns.length === 1 ? 'stage' : 'stages'}`
            : modeLabel(input, items.length);
        const meta = [label, b.tail].filter(Boolean).join(' · ');
        return {
          header: buildHeader(ctx, dayIndex, chip, meta),
          body: b.body,
          dayIndex,
          setIds: b.ids.map((it) => it.set.id),
        };
      }),
    });
  }

  const poster =
    input.style === 'poster'
      ? buildPosterArt({
          stageMarks: input.stages.map((st) => stageColors(st, theme).mark),
          palette: ctx.palette,
          theme,
          sideU: ctx.sideU,
          artEndU: contentTopU - 2,
          contentTopU,
          contentEndU: ctx.contentEndU,
        })
      : null;
  const flat = series.flatMap((s) => s.pages);
  const stamp = savedStamp(input.savedAt);
  const pages: LockscreenPageModel[] = flat.map((p, i) => ({
    ...p,
    ...(poster && { poster: buildPosterPage(poster, p.header.day, pageStageMarks(p.setIds, ctx), ctx.sideU, p.header.y + p.header.height) }),
    footer: {
      text: ['festie.us', `Saved ${stamp}`, flat.length > 1 ? `image ${i + 1} of ${flat.length}` : '', 'set times can change, re-save in Festie']
        .filter(Boolean)
        .join(' · '),
      showMark: theme === 'dark',
      y: ctx.contentEndU + 1.5,
    },
  }));

  return {
    width,
    height,
    heightU,
    theme,
    palette: ctx.palette,
    background:
      theme === 'dark'
        ? { color: DARK_BG, sheet: null, glow: { color: '#00e8d0', alpha: 0.08, cyU: 0.2 * heightU } }
        : { color: DARK_BG, sheet: { color: LIGHT_SHEET, topU: contentTopU - 2, radiusU: 3 }, glow: null },
    contentTopU,
    contentEndU: ctx.contentEndU,
    sideU: ctx.sideU,
    mode: input.mode,
    style: input.style ?? 'standard',
    poster,
    pages,
    empty: pages.length === 0,
  };
}
