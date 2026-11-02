import Papa from 'papaparse';
import type { Artist } from '../types/domain';
import { artistNamesOf, joinArtistNames } from './setArtists';

export type LineupImportRowStatus = 'new' | 'changed' | 'unchanged' | 'error';

export interface LineupImportRow {
  row: number;
  /** An exported set_id: the server matches it before artist and day. */
  setId?: string;
  artist: string;
  day?: string;
  date?: string;
  stage?: string;
  startTime?: string;
  endTime?: string;
  stageColor?: string;
  link?: string;
}

export interface LineupImportRequest {
  rows: LineupImportRow[];
  updateExisting: boolean;
  createMissing: boolean;
  skipSpotify: boolean;
}

export interface LineupImportPlanRow {
  row: number;
  status: LineupImportRowStatus;
  setId?: string;
  artists: string[];
  dayLabel?: string;
  stageName?: string;
  startTime?: string | null;
  endTime?: string | null;
  changes: string[];
  errors: {
    field: 'artist' | 'day' | 'date' | 'stage' | 'startTime' | 'endTime' | 'link' | 'row';
    message: string;
  }[];
  warnings: string[];
}

export interface LineupImportPlanCounts {
  new: number;
  changed: number;
  unchanged: number;
  error: number;
  newStages: number;
  newDays: number;
  missingFromFile: number;
}

export interface LineupImportPlan {
  festivalName: string;
  counts: LineupImportPlanCounts;
  rows: LineupImportPlanRow[];
  newStages: { name: string; color: string }[];
  newDays: { label: string; date: string }[];
  missingFromFile: { setId: string; artist: string; dayLabel: string }[];
  problems: string[];
  stages: string[];
  days: string[];
}

export interface LineupImportCommitResult {
  importId: string;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  newStages: number;
  newDays: number;
  spotifyMatched: number;
  rows: {
    row: number;
    status: 'created' | 'updated' | 'unchanged' | 'skipped';
    setId?: string;
    artist: string;
    message: string;
  }[];
  warnings: string[];
}

export interface LineupImportHistoryItem {
  id: string;
  createdAt: string;
  createdBy: string | null;
  counts: { created: number; updated: number; newStages: number; newDays: number };
  undoneAt: string | null;
  canUndo: boolean;
}

export interface LineupImportUndoResult {
  removed: number;
  restored: number;
  removedStages: number;
  removedDays: number;
  kept: { setId: string; artist: string; reason: 'picked' | 'edited' }[];
}

export type LineupImportField = 'setId' | 'artist' | 'day' | 'date' | 'stage' | 'startTime' | 'endTime' | 'stageColor' | 'link';

export const LINEUP_IMPORT_FIELDS: {
  field: LineupImportField;
  label: string;
  required: boolean;
  aliases: string[];
}[] = [
  { field: 'artist', label: 'Artist', required: true, aliases: ['artist', 'artists', 'name', 'act', 'performer', 'artistname'] },
  { field: 'day', label: 'Day', required: false, aliases: ['day', 'daylabel', 'dayname'] },
  { field: 'date', label: 'Date', required: false, aliases: ['date'] },
  { field: 'stage', label: 'Stage', required: false, aliases: ['stage', 'stagename', 'venue', 'area'] },
  { field: 'startTime', label: 'Start', required: false, aliases: ['start', 'starttime', 'time', 'from', 'settime'] },
  { field: 'endTime', label: 'End', required: false, aliases: ['end', 'endtime', 'to', 'until', 'finish'] },
  { field: 'stageColor', label: 'Stage colour', required: false, aliases: ['stagecolor', 'stagecolour', 'color', 'colour'] },
  { field: 'link', label: 'Link', required: false, aliases: ['link', 'linkurl', 'url', 'spotify'] },
  { field: 'setId', label: 'Set id', required: false, aliases: ['setid'] },
];

export const LINEUP_IMPORT_LIMITS = { maxRows: 500, maxBytes: 200_000 } as const;

export const LINEUP_SAMPLE_CSV = `artist,stage,day,date,start,end
Aurora Lights,Main Stage,Friday,2026-08-21,21:00,22:30
Kai b2b Mira,Forest,Friday,2026-08-21,23:30,01:30
Night Owl,Main Stage,Friday,2026-08-21,01:00,02:30
`;

/** Field to column index. */
export type LineupColumnMapping = Partial<Record<LineupImportField, number>>;

export const LEGACY_COLUMN_ORDER: LineupColumnMapping = { artist: 0, stage: 1, day: 2, startTime: 3, endTime: 4 };

const normalizeHeader = (cell: string) => cell.toLowerCase().replace(/[^a-z0-9]/g, '');

/** `lines[i]` is the 1-based line in the file where `rows[i]` starts. */
export function parseLineupTable(text: string): { rows: string[][]; lines: number[]; delimiter: string; errors: string[] } {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  // Blank lines skew delimiter guessing, so guess without them first.
  const guess = Papa.parse<string[]>(clean, { delimiter: '', skipEmptyLines: 'greedy', header: false, worker: false, preview: 20 });
  // Blank lines are kept here and dropped below, so line numbers can count them.
  const result = Papa.parse<string[]>(clean, {
    delimiter: guess.meta.delimiter,
    skipEmptyLines: false,
    header: false,
    worker: false,
  });
  result.errors.unshift(...guess.errors.filter((e) => e.type === 'Delimiter'));
  const startLine: number[] = [];
  let line = 1;
  for (const raw of result.data) {
    startLine.push(line);
    line += 1 + raw.reduce((n, c) => n + (String(c ?? '').match(/\r\n|\r|\n/g)?.length ?? 0), 0);
  }
  const rows: string[][] = [];
  const lines: number[] = [];
  result.data.forEach((raw, i) => {
    const cells = raw.map((c) => String(c ?? '').trim());
    if (cells.every((c) => !c)) return;
    rows.push(cells);
    lines.push(startLine[i]!);
  });
  const errors = result.errors.map((e) => `Line ${startLine[e.row ?? 0] ?? (e.row ?? 0) + 1}: ${e.message}`);
  return { rows, lines, delimiter: result.meta.delimiter, errors };
}

export function looksLikeHeader(firstRow: string[]): boolean {
  const aliases = new Set(LINEUP_IMPORT_FIELDS.flatMap((f) => f.aliases));
  return firstRow.some((cell) => aliases.has(normalizeHeader(cell)));
}

export function autoMapColumns(header: string[]): LineupColumnMapping {
  const mapping: LineupColumnMapping = {};
  const used = new Set<number>();
  const keys = header.map(normalizeHeader);
  for (const { field, aliases } of LINEUP_IMPORT_FIELDS) {
    const index = keys.findIndex((k, i) => !used.has(i) && aliases.includes(k));
    if (index === -1) continue;
    mapping[field] = index;
    used.add(index);
  }
  return mapping;
}

/** The header's auto-mapping, or the legacy column order cut to the table's width, so a missing column is never mapped. */
export function defaultMapping(rows: string[][], hasHeader: boolean): LineupColumnMapping {
  if (hasHeader) return autoMapColumns(rows[0] ?? []);
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return Object.fromEntries(Object.entries(LEGACY_COLUMN_ORDER).filter(([, i]) => i < width));
}

export function mappingProblems(mapping: LineupColumnMapping): string[] {
  const problems: string[] = [];
  if (mapping.artist === undefined) problems.push('Choose the column that holds the artist.');
  if (mapping.day === undefined && mapping.date === undefined) problems.push('Choose a Day or a Date column.');
  return problems;
}

/** `lines` comes from parseLineupTable, so `row` is the line in the file. */
export function toImportRows(
  rows: string[][],
  mapping: LineupColumnMapping,
  hasHeader: boolean,
  lines?: number[],
): LineupImportRow[] {
  const out: LineupImportRow[] = [];
  const fields = Object.entries(mapping).filter((e): e is [LineupImportField, number] => e[1] !== undefined);
  rows.forEach((cells, i) => {
    if (hasHeader && i === 0) return;
    if (cells.every((c) => !c.trim())) return;
    const item: LineupImportRow = { row: lines?.[i] ?? i + 1, artist: '' };
    for (const [field, col] of fields) item[field] = (cells[col] ?? '').trim();
    out.push(item);
  });
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function planSummary(
  counts: Pick<LineupImportPlanCounts, 'new' | 'changed' | 'unchanged' | 'error' | 'newStages' | 'newDays'>,
  updateExisting: boolean,
): string {
  const parts: string[] = [];
  if (counts.new) parts.push(`Add ${plural(counts.new, 'set')}.`);
  if (updateExisting) {
    if (counts.changed) parts.push(`Update ${counts.changed}.`);
  } else {
    const matching = counts.changed + counts.unchanged;
    if (matching) parts.push(`Leave ${plural(matching, 'matching set')} as they are.`);
  }
  if (counts.newStages) parts.push(`Create ${plural(counts.newStages, 'stage')}.`);
  if (counts.newDays) parts.push(`Create ${plural(counts.newDays, 'day')}.`);
  if (counts.error) parts.push(`${plural(counts.error, 'row')} ${counts.error === 1 ? 'has' : 'have'} errors.`);
  return parts.length ? parts.join(' ') : 'Nothing to change.';
}

export function buildResultCsv(result: LineupImportCommitResult): string {
  return Papa.unparse({
    fields: ['row', 'status', 'set_id', 'artist', 'message'],
    data: result.rows.map((r) => [r.row, r.status, r.setId ?? '', r.artist, r.message]),
  });
}

export interface LineupExportFestival {
  b2bSeparator?: string;
  stages?: { id: string; name: string }[];
  days?: {
    label?: string;
    date?: string;
    sets?: { id: string; artist?: string; artists?: Artist[]; stageId?: string | null; startTime?: string | null; endTime?: string | null }[];
  }[];
}

/** The lineup as a CSV that imports again unchanged: set_id matches each row to its set. */
export function buildLineupCsv(festival: LineupExportFestival): string {
  const stageName = new Map((festival.stages ?? []).map((s) => [s.id, s.name]));
  const time = (t: string | null | undefined) => (t && t !== 'TBA' ? t : '');
  return Papa.unparse({
    fields: ['set_id', 'day', 'stage', 'artist', 'start', 'end'],
    data: (festival.days ?? []).flatMap((d) =>
      (d.sets ?? []).map((s) => [
        s.id,
        d.label || d.date || '',
        stageName.get(s.stageId ?? '') ?? '',
        joinArtistNames(artistNamesOf(s), festival.b2bSeparator),
        time(s.startTime),
        time(s.endTime),
      ]),
    ),
  });
}
