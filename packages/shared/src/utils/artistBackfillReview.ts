// The artist backfill dry-run report, sorted into STOP (do not run), REVIEW (look first) and INFO.
// Pure and platform-neutral. The rules follow the owner's offline checker for the same report.
// The report shape is BackfillReport in lib/artist-backfill.ts; shared cannot import server code,
// so every list is read loosely and a list this file does not know about is only shown, never judged.

export interface BackfillReportInput {
  counts?: Record<string, number>;
  [list: string]: unknown;
}

export interface BackfillFinding {
  kind: string;
  count: number;
  /** The first few entries as one line each. */
  examples: string[];
}

export interface BackfillReview {
  stop: BackfillFinding[];
  review: BackfillFinding[];
  info: { counts: Record<string, number> };
}

export interface ClassifyOptions {
  /** Pairs of festival ids that are copies of each other: the same artist in both is expected. */
  copyPairs?: Array<[string, string]>;
  /** How many examples each finding keeps. Default 5. */
  maxExamples?: number;
}

type Entry = Record<string, unknown>;

const LEAD_KEYS = ['festivalId', 'setId', 'ownerId', 'artist', 'name', 'key'];
const PAIR_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['before', 'after'],
  ['from', 'to'],
  ['kept', 'dropped'],
];

const text = (v: unknown): string =>
  Array.isArray(v) ? v.map(String).join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : String(v);

/** One line for a report entry: where it is, who, then "before -> after" when it changes something. */
export function describeBackfillEntry(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return String(entry);
  const e = entry as Entry;
  const used = new Set<string>();
  const arrows: string[] = [];
  for (const [from, to] of PAIR_KEYS) {
    if (from in e && to in e) {
      arrows.push(`${text(e[from])} -> ${text(e[to])}`);
      used.add(from).add(to);
    }
  }
  const keys = [...LEAD_KEYS.filter((k) => k in e), ...Object.keys(e).filter((k) => !LEAD_KEYS.includes(k))];
  return [...keys.filter((k) => !used.has(k)).map((k) => text(e[k])), ...arrows].join(' | ');
}

const asList = (report: BackfillReportInput, key: string): Entry[] => {
  const value = report[key];
  return Array.isArray(value) ? (value as Entry[]) : [];
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const lower = (v: unknown): string => str(v).toLowerCase();
/** Case, diacritic and spacing differences vanish: two names with the same key are the same name. */
const nameKey = (v: unknown): string =>
  str(v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
// "(Sunset Set)" tails and " b2b ..." tails drop, so suffix-only differences compare equal.
const baseName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+b2b\s+.*$/, '')
    .trim();

export function classifyBackfillReport(report: BackfillReportInput, opts: ClassifyOptions = {}): BackfillReview {
  const max = opts.maxExamples ?? 5;
  const copyPairs = opts.copyPairs ?? [];
  const stop: BackfillFinding[] = [];
  const review: BackfillFinding[] = [];
  const add = (into: BackfillFinding[], kind: string, items: unknown[], count = items.length) => {
    if (items.length) into.push({ kind, count, examples: items.slice(0, max).map((i) => (typeof i === 'string' ? i : describeBackfillEntry(i))) });
  };
  const counts = report.counts ?? {};

  // A rename that changes only case or diacritics is cosmetic; any other rename changes who the artist is.
  const renames = asList(report, 'renames');
  add(stop, 'renames', renames.filter((r) => nameKey(r.before) !== nameKey(r.after)));
  add(review, 'renamesCaseOnly', renames.filter((r) => nameKey(r.before) === nameKey(r.after)));
  for (const kind of ['needsPick', 'linkConflicts', 'photosNotCopied', 'linksNotCopied']) add(stop, kind, asList(report, kind));
  const { festivals: festivalCount = 0, festivalsToWrite = 0 } = counts;
  if (festivalsToWrite > festivalCount) add(stop, 'festivalsToWrite', [`festivalsToWrite ${festivalsToWrite} > festivals ${festivalCount}`]);

  const byName = asList(report, 'joinedByName');
  add(stop, 'joinedByNameDiffers', byName.filter((e) => lower(e.name) !== lower(e.artist)));

  // artist -> festival -> the set names that joined it
  const byArtist = new Map<string, Map<string, Set<string>>>();
  for (const e of byName) {
    const festivals = byArtist.get(str(e.artist)) ?? new Map<string, Set<string>>();
    const names = festivals.get(str(e.festivalId)) ?? new Set<string>();
    names.add(str(e.name));
    festivals.set(str(e.festivalId), names);
    byArtist.set(str(e.artist), festivals);
  }
  const isCopy = (a: string, b: string) => copyPairs.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
  const suffixJoins: Entry[] = [];
  const crossFestival: string[] = [];
  for (const [artist, festivals] of byArtist) {
    const ids = [...festivals.keys()].sort();
    if (ids.length > 1) crossFestival.push(`${artist} -> ${ids.join(', ')}`);
    ids.forEach((first, i) => {
      for (const second of ids.slice(i + 1)) {
        if (isCopy(first, second)) continue;
        const a = [...(festivals.get(first) ?? [])];
        const b = [...(festivals.get(second) ?? [])];
        if (a.some((x) => b.some((y) => x.toLowerCase() !== y.toLowerCase() && baseName(x) === baseName(y)))) {
          suffixJoins.push({ artist, festivals: [first, second], names: [a, b] });
        }
      }
    });
  }
  add(stop, 'joinedByNameSuffix', suffixJoins);

  add(review, 'joinedByNameAcrossFestivals', crossFestival);
  for (const kind of ['joinedBySpotify', 'b2bSplits', 'b2bNotSplit', 'linkRefiles', 'separateArtists']) add(review, kind, asList(report, kind));
  // Link failures group by message; the count stays the number of failures.
  const failures = new Map<string, number>();
  const failureList = asList(report, 'linkFailures');
  for (const f of failureList) failures.set(str(f.message), (failures.get(str(f.message)) ?? 0) + 1);
  add(review, 'linkFailures', [...failures].map(([message, n]) => `${n} x ${message}`), failureList.length);

  return { stop, review, info: { counts } };
}

/** True when a dry run has nothing left to write. */
export function isIdempotentPlan(report: BackfillReportInput): boolean {
  const c = report.counts ?? {};
  return ['artistsToCreate', 'festivalsToWrite', 'ownersToWrite'].every((k) => c[k] === 0);
}

const BACKFILL_LABELS: Readonly<Record<string, string>> = {
  festivals: 'Festivals',
  sets: 'Sets',
  lineupEntries: 'Lineup entries',
  elements: 'Artist names',
  legacyFlatOnlySets: 'Sets with only an old single name',
  artistsToCreate: 'Artists to create',
  festivalsToWrite: 'Festivals to update',
  ownersToWrite: 'Sets and lineup entries to update',
  renames: 'Name changes',
  renamesCaseOnly: 'Name changes in capital letters only',
  needsPick: 'Names that need you to pick the artist',
  linkConflicts: 'Links that disagree',
  photosNotCopied: 'Photos not copied',
  linksNotCopied: 'Links not copied',
  joinedByName: 'Names matched to an artist',
  joinedByNameDiffers: 'Names matched to an artist with a different spelling',
  joinedByNameSuffix: 'Names matched to an artist apart from a suffix',
  joinedByNameAcrossFestivals: 'Names matched to one artist on several festivals',
  joinedBySpotify: 'Names matched by Spotify link',
  b2bSplits: 'B2B names split into separate artists',
  b2bNotSplit: 'B2B names kept as one artist',
  linkRefiles: 'Links moved to another platform',
  separateArtists: 'Similar names kept as separate artists',
  linkFailures: 'Links that could not be checked',
  splitLinksToPlace: 'Links to place after a B2B split',
  rowFills: 'Artist records to fill from Spotify',
  copyRefreshes: 'Copies to refresh',
  // The names of the Verify checks.
  counts: 'Sets and lineup entries match the run',
  ids: 'Every artist name has an artist record',
  'second dry run': 'A second dry run finds nothing left to change',
};

/** Plain words for a backfill report key. A key this file does not know shows as it came. */
export function backfillLabel(key: string): string {
  return BACKFILL_LABELS[key] ?? key;
}
