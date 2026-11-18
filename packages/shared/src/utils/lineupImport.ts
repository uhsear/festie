import Papa from 'papaparse';
import type { Artist, LineupEntry } from '../types/domain';
import { coverLineup } from './lineupCover';
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
  /** The poster name a new set takes from the announced act it covers. */
  displayName?: string;
  changes: string[];
  errors: {
    field: 'artist' | 'day' | 'date' | 'stage' | 'startTime' | 'endTime' | 'link' | 'row';
    message: string;
  }[];
  warnings: string[];
  /** The row names another day than the stored set. Nothing is written for it. */
  skipped?: true;
}

export interface LineupImportPlanCounts {
  new: number;
  changed: number;
  unchanged: number;
  error: number;
  skipped: number;
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
  /** Announced acts dated to a day this import fills that no set covers afterwards. Absent from an older server. */
  unmatchedActs?: { entryId: string; name: string; dayLabel: string }[];
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

/** Dry run of "Announce lineup": the push audience, the email audience and who the email skips. */
export interface LineupAnnouncementCount {
  festivalName: string;
  /** People who get the push and inbox row now. */
  recipients: number;
  /** Followers who have not joined: they also get the email. */
  followers: number;
  /** People who went to an earlier edition and do not follow: push and inbox only. */
  priorAttendees: number;
  matchedFestivalNames: string[];
  emailRecipients: number;
  /** People the daily email limit leaves out today. */
  emailCut: number;
  /** 'no_postal_address' when email is off. */
  emailOff: string | null;
}

/** Dry run of "Announce days". `reason` says why a send would be refused. */
export interface DaysAnnouncementCount {
  festivalName: string;
  actsWithDay: number;
  actsTotal: number;
  recipients: number;
  audience: number;
  emailRecipients: number;
  emailCut: number;
  emailOff: string | null;
  reason?: 'draft' | 'set_times_out' | 'no_days' | 'no_audience' | 'already_heard';
}

const DAYS_BLOCKED: Record<NonNullable<DaysAnnouncementCount['reason']>, string> = {
  draft: 'Publish the festival before you announce its days.',
  set_times_out: 'Set times are already out. The set-times alert covered this.',
  no_days: 'Give acts a day before you announce days.',
  no_audience: 'No one follows this festival or has joined it yet.',
  already_heard: 'Everyone who follows has already heard.',
};

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** Who hears the lineup alert, with singular forms, and which earlier editions matched. */
export function lineupAudienceSummary(
  count: Pick<LineupAnnouncementCount, 'followers' | 'priorAttendees' | 'matchedFestivalNames'>,
): string {
  const followers = `${count.followers} ${count.followers === 1 ? 'follower gets' : 'followers get'} push and email.`;
  const prior = `${people(count.priorAttendees)} from earlier editions ${count.priorAttendees === 1 ? 'gets' : 'get'} push only.`;
  const matched = count.matchedFestivalNames.length ? ` Matched editions: ${count.matchedFestivalNames.join(', ')}.` : '';
  return `${followers} ${prior}${matched}`;
}

/** What the email part of a dry run says, or null when everyone who should get one does. */
export function announcementEmailNote(count: Pick<DaysAnnouncementCount, 'emailOff' | 'emailCut'>): string | null {
  if (count.emailOff === 'no_postal_address') return 'Email off: no postal address.';
  if (count.emailCut > 0) {
    return `${people(count.emailCut)} get no email today because of the daily email limit. Press the button again tomorrow to reach them.`;
  }
  return null;
}

/** The text of the "Announce days" panel: the counts, a warning for a partial split, and why a send is blocked. */
export function daysAnnouncementSummary(count: DaysAnnouncementCount) {
  const partial = count.actsWithDay < count.actsTotal;
  return {
    blocked: count.reason ? DAYS_BLOCKED[count.reason] : null,
    counts: `${count.actsWithDay} of ${count.actsTotal} acts have a day. ${people(count.recipients)} get one alert.`,
    warning:
      partial && count.actsWithDay > 0
        ? 'Not every act has a day yet. Each person hears this once, so send it when the days are final.'
        : null,
    emailNote: announcementEmailNote(count),
  };
}

export interface LineupImportHistoryItem {
  id: string;
  createdAt: string;
  createdBy: string | null;
  counts: { created: number; updated: number; newStages: number; newDays: number };
  undoneAt: string | null;
  canUndo: boolean;
  /** Festival dates this import wrote to. Absent from a server that predates set-time releases. */
  touchedDates?: string[];
}

export interface LineupImportUndoResult {
  removed: number;
  restored: number;
  removedStages: number;
  removedDays: number;
  /** Picks that interest conversion made on the removed sets and nobody changed. Absent from an older server. */
  autoPicksRemoved?: number;
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
    // buildLineupCsv prefixes a name that starts like a formula with an apostrophe; take it off again.
    const cells = raw.map((c) => String(c ?? '').replace(/^'(?=[=+\-@\t\r])/, '').trim());
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
  counts: Pick<LineupImportPlanCounts, 'new' | 'changed' | 'unchanged' | 'error' | 'skipped' | 'newStages' | 'newDays'>,
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
  if (counts.skipped) parts.push(`Skip ${plural(counts.skipped, 'row')} that name${counts.skipped === 1 ? 's' : ''} another day.`);
  if (counts.error) parts.push(`${plural(counts.error, 'row')} ${counts.error === 1 ? 'has' : 'have'} errors.`);
  return parts.length ? parts.join(' ') : 'Nothing to change.';
}

/** A file with a set_id column is an export of this lineup, so its changed rows are meant to apply. */
export const defaultUpdateExisting = (mapping: LineupColumnMapping): boolean => mapping.setId !== undefined;

/** The banner for a preview whose changed rows an off Update switch would leave unapplied, or null. */
export function updateOffBanner(counts: Pick<LineupImportPlanCounts, 'changed'>, updateExisting: boolean): string | null {
  if (updateExisting || counts.changed === 0) return null;
  const n = counts.changed;
  return `${n} ${n === 1 ? 'row changes an existing set' : 'rows change existing sets'}. Turn on Update to apply ${n === 1 ? 'it' : 'them'}.`;
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
  /** The announced lineup. Each act that is not scheduled and not cancelled becomes a row with no set id, stage or times. */
  lineup?: LineupEntry[];
}

/**
 * The lineup as a CSV that imports again unchanged: set_id matches each row to its set. After the sets
 * come the announced acts that no set covers, with their day when it resolves, so the organizer fills in
 * stage and times in a sheet. The poster name is not a column: the import copies it from the act.
 */
export function buildLineupCsv(festival: LineupExportFestival): string {
  const stageName = new Map((festival.stages ?? []).map((s) => [s.id, s.name]));
  const time = (t: string | null | undefined) => (t && t !== 'TBA' ? t : '');
  const days = festival.days ?? [];
  const separator = festival.b2bSeparator;
  const lineup = festival.lineup ?? [];
  const cover = coverLineup(lineup, days, separator || 'b2b');
  const setRows = days.flatMap((d) =>
    (d.sets ?? []).map((s) => [
      s.id,
      d.label || d.date || '',
      stageName.get(s.stageId ?? '') ?? '',
      joinArtistNames(artistNamesOf(s), separator),
      time(s.startTime),
      time(s.endTime),
    ]),
  );
  const entryRows = lineup
    .filter((entry) => cover[entry.id]?.state === 'announced')
    .map((entry) => {
      const day = days[cover[entry.id]!.dayIndex];
      return ['', day ? day.label || day.date || '' : '', '', joinArtistNames(entry.artists.map((a) => a.name), separator), '', ''];
    });
  // A spreadsheet runs a cell that starts with = + - or @ as a formula, so those cells get an apostrophe.
  return Papa.unparse({ fields: ['set_id', 'day', 'stage', 'artist', 'start', 'end'], data: [...setRows, ...entryRows] }, { escapeFormulae: true });
}
