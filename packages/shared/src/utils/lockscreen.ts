import type { CrewOverlap, FestivalDay, FestivalSet, Priority, Stage } from '../types/domain';

/**
 * Lock-screen schedule wallpaper layout model. Pure: no DOM, no React Native.
 * Every position and size is in `u` (1u = 1% of image width), so a renderer
 * multiplies by `width / 100` and draws absolutely positioned boxes. `y` values
 * are measured from the top of the image.
 */

export type LockscreenMode = 'picks' | 'full' | 'stages' | 'crew';
export type LockscreenTheme = 'dark' | 'light';
export type LockscreenTier = 'XL' | 'L' | 'M';
/** 'poster' adds stage-colour beams, a panel behind the schedule and a gradient headline; layout and safe zones are the same. */
export type LockscreenStyle = 'standard' | 'poster';

export interface LockscreenPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export interface LockscreenInput {
  festival: { name: string; b2bSeparator?: string };
  sets: FestivalSet[];
  stages: Stage[];
  days: FestivalDay[];
  picks: Record<string, Priority> | undefined;
  /** A festival day index, or 'all' for every day that has something to show. */
  dayIndex: number | 'all';
  mode: LockscreenMode;
  /** Modes picks and crew: priorities to keep. Empty or omitted keeps all. */
  priorities?: Priority[];
  /** Mode stages: stage ids to show; null or omitted = all stages. */
  stageIds?: string[] | null;
  /** Mode crew: from crewStore.crewOverlap. */
  crewOverlap?: Record<string, CrewOverlap>;
  /**
   * Mode crew: true once crewOverlap has loaded for this crew. An empty overlap is also the
   * store's initial value, so rows are marked "solo" only when this is true.
   */
  crewLoaded?: boolean;
  /** The signed-in user's id, so crew initials skip them. */
  selfUserId?: string;
  theme: LockscreenTheme;
  /** Default 'standard'. */
  style?: LockscreenStyle;
  width: number;
  height: number;
  /** "Big iOS clock": content starts at 0.45 instead of 0.38. */
  tallClock?: boolean;
  /** Grid modes: force a single image. */
  onePage?: boolean;
  savedAt: Date;
}

export interface LockscreenPalette {
  text: string;
  text2: string;
  muted: string;
  surface: string;
  border: string;
  must: string;
  want: string;
  maybe: string;
  /** Clash text colour. */
  clash: string;
}

export interface LockscreenBackground {
  color: string;
  /** Light theme: white sheet from `topU` down; the area above stays `color`. */
  sheet: { color: string; topU: number; radiusU: number } | null;
  /** Dark theme: faint aqua radial glow centred at `cyU`. */
  glow: { color: string; alpha: number; cyU: number } | null;
}

export interface LockscreenHeader {
  /** "FRIDAY" */
  day: string;
  /** Font size in u, shrunk to fit the width. */
  daySizeU: number;
  /** "1/2" when more than one image, else null. */
  pageChip: string | null;
  /** "EDC Orlando · Nov 6" */
  metaTop: string;
  /** "My picks · 9", with " · to 7 PM" appended on a split series. */
  metaBottom: string;
  /** Font size in u for metaTop and metaBottom, shrunk so each stays on one line. */
  metaSizeU: number;
  y: number;
  height: number;
}

export interface LockscreenCrewMarks {
  /** Up to 3 initials. */
  initials: string[];
  /** Further members beyond the shown initials. */
  more: number;
  /** True when nobody else picked the set. */
  solo: boolean;
}

export interface LockscreenListRow {
  setId: string;
  /** "7:00" and "PM" */
  time: string;
  period: string;
  /** "to 7:00 PM" */
  until: string;
  artist: string;
  /** Wrapped artist lines, as the renderer must draw them. */
  artistLines: string[];
  stage: string;
  /** Short stage name for the tier M chip. */
  stageShort: string;
  stageText: string;
  stageMark: string;
  /** Chip text colour: higher contrast of near-black or white on stageMark. */
  ink: string;
  /** Null only for crew-mode rows the user did not pick. */
  priority: Priority | null;
  /** "Clashes with Matthias (1h)" for XL/L, "clash" for M; null when none. */
  clash: { label: string; short: 'clash' } | null;
  crew: LockscreenCrewMarks | null;
  y: number;
  height: number;
}

export interface LockscreenListPage {
  kind: 'list';
  tier: LockscreenTier;
  artistSizeU: number;
  timeSizeU: number;
  /** Column positions in u. Marks (priority glyph, clash, crew) anchor to the right edge, `100 - sideU`. */
  layout: { barX: number; timeX: number; timeWidth: number; chipX: number | null; chipWidth: number; artistX: number; artistWidth: number };
  rows: LockscreenListRow[];
  /** Index of the row the "AFTER MIDNIGHT" divider sits above, or null. */
  divider: { beforeIndex: number; y: number; label: string } | null;
}

export interface LockscreenGridColumn {
  stageId: string;
  name: string;
  short: string;
  x: number;
  width: number;
  text: string;
  mark: string;
}

export interface LockscreenGridBlock {
  setId: string;
  stageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** "7:00" style start label. */
  time: string;
  artist: string;
  /** Artist font size in u after fitting. */
  artistSizeU: number;
  /** Lines the block height allows for the artist; 0 = show no text. */
  maxLines: number;
  /** 'name' under two lines of height, 'none' under 4.5u. */
  textMode: 'full' | 'name' | 'none';
  /** Wrapped artist lines (never split inside a word; an overlong word ends in an ellipsis), clamped to `maxLines`. */
  artistLines: string[];
  /** True when the name was clamped; the last line ends with an ellipsis. */
  ellipsis: boolean;
  /** Modes with 1-2 columns: time goes inline after the name, e.g. "1-2:25"; the lines already include it. */
  inlineTime: string | null;
  priority: Priority | null;
  picked: boolean;
  /** Fill: stage mark colour when picked, palette surface otherwise. */
  fill: string;
  /** Left edge stripe colour (stage mark). */
  edge: string;
  ink: string;
  /** Sunlight picked blocks add an ink outline; null otherwise. */
  outline: string | null;
  /** Must-see: inset ring in the text colour. */
  ring: boolean;
  /** Set started before this image's first hour: draw "↑ 4:30 Joshwa", square top corners. */
  carryOver: boolean;
  /** Carry-over label, e.g. "↑ 4:30 Joshwa"; null otherwise. */
  carryLabel: string | null;
}

export interface LockscreenGridPage {
  kind: 'grid';
  columns: LockscreenGridColumn[];
  gutterWidth: number;
  /** Festival-day minutes of the first and last hour line. */
  startMinute: number;
  endMinute: number;
  hourU: number;
  /** Top of the stage header row, and top of the hour axis. */
  headerY: number;
  gridY: number;
  hours: { label: string; y: number; dashed: boolean }[];
  blocks: LockscreenGridBlock[];
  legend: string;
  /** Right of the hour gutter, so the legend never covers the last hour label. */
  legendX: number;
  legendY: number;
}

export interface LockscreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Poster style art. Beams sit above the content band; the panel is the content band. */
export interface LockscreenPosterArt {
  beams: Array<LockscreenRect & { color: string }>;
  panel: LockscreenRect & { radiusU: number; fill: string; border: string };
  /** Headline gradient end colours. */
  headline: { from: string; to: string };
}

export interface LockscreenPosterPage {
  /** One colour per character of header.day. */
  dayColors: string[];
  /** Stage-colour segments under the header; replaces the hairline. */
  rule: Array<LockscreenRect & { color: string }>;
}

export type LockscreenPage = LockscreenListPage | LockscreenGridPage;

export interface LockscreenPageModel {
  header: LockscreenHeader;
  /** Footer text and whether to draw the Festie mark (dark theme only). */
  footer: { text: string; showMark: boolean; y: number };
  body: LockscreenPage;
  /** Festival day index this image shows. */
  dayIndex: number;
  /** Set ids drawn (not carry-over repeats) on this image. */
  setIds: string[];
  /** Poster style only. */
  poster?: LockscreenPosterPage;
}

export interface LockscreenModel {
  width: number;
  height: number;
  /** Image height in u: height / width * 100. */
  heightU: number;
  theme: LockscreenTheme;
  palette: LockscreenPalette;
  background: LockscreenBackground;
  /** Content band in u from the image top. */
  contentTopU: number;
  contentEndU: number;
  sideU: number;
  mode: LockscreenMode;
  style: LockscreenStyle;
  /** Null for the standard style. */
  poster: LockscreenPosterArt | null;
  pages: LockscreenPageModel[];
  /** True when nothing matched the filters. */
  empty: boolean;
}

export const LOCKSCREEN_PRESETS: readonly LockscreenPreset[] = [
  { id: 'iphone-16-pro-max', label: 'iPhone 16/17 Pro Max', width: 1320, height: 2868 },
  { id: 'iphone-15-pro-max', label: 'iPhone 14/15 Pro Max, 15/16 Plus', width: 1290, height: 2796 },
  { id: 'iphone-14-plus', label: 'iPhone 14 Plus', width: 1284, height: 2778 },
  { id: 'iphone-air', label: 'iPhone Air', width: 1260, height: 2736 },
  { id: 'iphone-16-pro', label: 'iPhone 16 Pro, 17, 17 Pro', width: 1206, height: 2622 },
  { id: 'iphone-15', label: 'iPhone 15, 15 Pro, 16', width: 1179, height: 2556 },
  { id: 'iphone-12', label: 'iPhone 12-14, 16e', width: 1170, height: 2532 },
  { id: 'galaxy-s24', label: 'iPhone 12/13 mini, Galaxy S24', width: 1080, height: 2340 },
  { id: 'pixel-9', label: 'Pixel 9', width: 1080, height: 2424 },
  { id: 'generic', label: 'Other phone (9:19.5)', width: 1290, height: 2796 },
];

/** Fractions of image height. Estimates until measured on devices (spec 7.3). */
export const LOCKSCREEN_ZONES = {
  top: 0.38,
  tallTop: 0.45,
  // The schedule runs past the torch and camera buttons: they are see-through and
  // sit in the bottom corners, and users asked for the whole day on one image.
  contentEnd: 0.92,
  footerEnd: 0.96,
  sidePadU: 6,
} as const;

