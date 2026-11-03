import type { FestivalDay, FestivalSet, Priority, Stage } from '../types/domain';
import { artistDisplayName, formatTime } from './format';
import type { LockscreenMode } from './lockscreen';
import { byStartTime, formatDayChip } from './scheduleFormat';

export type ScheduleImageFormat = 'story' | 'lockscreen' | 'print';

/** `rowHeight` is the fixed row height in image px; both posters scale row text by rowHeight / 108. */
export const SCHEDULE_IMAGE_LAYOUT: Record<
  ScheduleImageFormat,
  { width: number; height: number; topReserve: number; bottomReserve: number; maxRows: number; rowHeight: number }
> = {
  story: { width: 1080, height: 1920, topReserve: 0, bottomReserve: 0, maxRows: 12, rowHeight: 108 },
  lockscreen: { width: 1080, height: 2340, topReserve: 820, bottomReserve: 300, maxRows: 9, rowHeight: 108 },
  // A4 portrait at 150 dpi.
  print: { width: 1240, height: 1754, topReserve: 0, bottomReserve: 0, maxRows: 24, rowHeight: 56 },
};

/**
 * Poster chrome in image px. The web and mobile posters both read these, so they draw
 * the same layout. `padY` is the top or bottom padding where the format has no reserve.
 * Row values are for a 108 px row; posters scale them by rowHeight / 108.
 */
export const SCHEDULE_POSTER_METRICS = {
  padX: 64,
  padY: 96,
  titleSize: 64,
  titleLine: 72,
  daySize: 36,
  dayLine: 44,
  dayGapTop: 4,
  dayGapBottom: 24,
  footerSize: 28,
  footerLine: 36,
  footerGapTop: 14,
  row: {
    base: 108,
    gap: 20,
    barWidth: 10,
    barHeight: 76,
    timeWidth: 190,
    timeSize: 34,
    artistSize: 44,
    artistLine: 52,
    stageSize: 28,
    stageLine: 34,
    prioritySize: 30,
  },
} as const;

export interface ScheduleImageRow {
  setId: string;
  time: string;
  endTime: string;
  artist: string;
  stage: string;
  stageColor: string | null;
  priority: Priority;
}

export interface ScheduleImageModel {
  festivalName: string;
  dayLabel: string;
  rows: ScheduleImageRow[];
  hiddenCount: number;
  tbaCount: number;
  footer: string;
}

const HHMM = /^\d{1,2}:\d{2}$/;
const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const RANK: Record<Priority, number> = { must: 3, 'want-to-see': 2, maybe: 1 };

const hasStart = (set: FestivalSet) => HHMM.test(set.startTime ?? '');

function footerText(hiddenCount: number, tbaCount: number): string {
  const parts: string[] = [];
  if (hiddenCount > 0) parts.push(`+${hiddenCount} more ${hiddenCount === 1 ? 'pick' : 'picks'} in Festie`);
  if (tbaCount > 0) parts.push(`+${tbaCount} with no set time yet`);
  parts.push('festie.us');
  return parts.join(' · ');
}

export function buildScheduleImageModel(args: {
  festival: { name: string; b2bSeparator?: string };
  sets: FestivalSet[];
  stages: Stage[];
  days: FestivalDay[];
  picks: Record<string, Priority> | undefined;
  dayIndex: number;
  format: ScheduleImageFormat;
}): ScheduleImageModel {
  const { festival, sets, stages, days, picks, dayIndex, format } = args;
  const picked = sets.filter((s) => picks?.[s.id] && s.dayIndex === dayIndex);
  const timed = picked.filter(hasStart);
  const tbaCount = picked.length - timed.length;
  const { maxRows } = SCHEDULE_IMAGE_LAYOUT[format];
  const kept = [...timed]
    .sort((a, b) => RANK[picks![b.id]!] - RANK[picks![a.id]!] || byStartTime(a, b))
    .slice(0, maxRows)
    .sort(byStartTime);
  const hiddenCount = timed.length - kept.length;
  const stageById = new Map(stages.map((s) => [s.id, s]));

  const rows = kept.map((set): ScheduleImageRow => {
    const stage = stageById.get(set.stageId);
    return {
      setId: set.id,
      time: formatTime(set.startTime),
      endTime: formatTime(set.endTime),
      artist: artistDisplayName(set, festival.b2bSeparator),
      stage: stage?.name ?? '',
      stageColor: stage?.color && COLOR.test(stage.color) ? stage.color : null,
      priority: picks![set.id]!,
    };
  });

  const day = days[dayIndex];
  const chip = day ? formatDayChip(day) : null;
  const dayLabel = chip ? (chip.date ? `${chip.label} · ${chip.date}` : chip.label) : `Day ${dayIndex + 1}`;
  return { festivalName: festival.name, dayLabel, rows, hiddenCount, tbaCount, footer: footerText(hiddenCount, tbaCount) };
}

/**
 * The selected day when it has something to show, else the first day that does; null when none does.
 * Picks and crew need a timed pick. Full and stages need a timed set.
 */
export function defaultScheduleImageDay(args: {
  sets: FestivalSet[];
  picks: Record<string, Priority> | undefined;
  selectedDay: number;
  mode?: LockscreenMode;
}): number | null {
  const needsPick = !args.mode || args.mode === 'picks' || args.mode === 'crew';
  const withTimedSets = new Set(
    args.sets.filter((s) => (!needsPick || args.picks?.[s.id]) && hasStart(s)).map((s) => s.dayIndex ?? 0),
  );
  if (withTimedSets.has(args.selectedDay)) return args.selectedDay;
  const days = [...withTimedSets].sort((a, b) => a - b);
  return days.length ? days[0]! : null;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

export function scheduleImageFilename(festivalName: string, dayLabel: string, format: ScheduleImageFormat): string {
  return `festie-${slug(festivalName)}-${slug(dayLabel)}-${format}.png`;
}
