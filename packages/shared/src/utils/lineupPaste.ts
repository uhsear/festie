import type { Artist, LineupEntry } from '../types/domain';
import { lineupEntryKey, lineupNameKey } from './lineupCover';

// Paste parser and merge for the announced lineup (web admin "Announced names").
// Text mode: one billing line per row. "A b2b B" is one line with two artists, "| text" after the
// names sets the poster name, and "# Heading" lines start tiers. JSON mode takes the side files.

/** An entry as the form holds it: new lines have no id or announcedAt until the server saves them. */
export type LineupDraft = Omit<LineupEntry, 'id' | 'announcedAt'> & { id?: string; announcedAt?: string };

export const MAX_LINEUP_LINES = 500;
export const MAX_LINEUP_ARTISTS = 4;

// Mirrors ALLOWED_LINK_PLATFORMS in lib/constants.ts; any other key is dropped here so the server never sees it.
const LINK_PLATFORMS = ['spotify', 'soundcloud', 'instagram', 'twitter', 'tiktok', 'facebook', 'website'];
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type LineFlagKind =
  | 'list'
  | 'too_many'
  | 'brackets'
  | 'stray'
  | 'long'
  | 'presents'
  | 'invalid'
  | 'duplicate';

export interface LineFlag {
  /** 1-based line (text) or position in the array (JSON). */
  line: number;
  kind: LineFlagKind;
  message: string;
  /** A blocking flag disables "Add": the server would refuse the save. */
  blocking: boolean;
}

export interface ParsedLine {
  line: number;
  artists: Artist[];
  displayName: string | null;
  /** Set by a heading above the line. null means no heading, so a merge keeps the old tier. */
  tier: number | null;
  /** JSON mode only. */
  id?: string;
  dayDate?: string | null;
  status?: 'announced' | 'cancelled';
}

export interface ParseResult {
  entries: ParsedLine[];
  flags: LineFlag[];
  /** Empty lines that were skipped. */
  skipped: number;
  /** JSON mode: keys that were dropped, with how many times each appeared. */
  dropped: Record<string, number>;
  linksKept: number;
  b2b: number;
  /** JSON mode only: set when the text is not a lineup list. */
  error?: string;
}

const emptyResult = (): ParseResult => ({ entries: [], flags: [], skipped: 0, dropped: {}, linksKept: 0, b2b: 0 });

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const unbalanced = (s: string) =>
  [['(', ')'], ['[', ']']].some(([open, close]) => s.split(open!).length !== s.split(close!).length);

/** The per-line checks of the paste dialog. Names are the artist names after the B2B split. */
function flagLine(line: number, names: string[], displayName: string | null): LineFlag[] {
  const flags: LineFlag[] = [];
  const add = (kind: LineFlagKind, message: string, blocking = false) => flags.push({ line, kind, message, blocking });
  if (names.length > MAX_LINEUP_ARTISTS) {
    add('too_many', `Line ${line} has more than 4 artists. Split the line, or put the full text after a bar as the name on the poster.`, true);
  }
  if (names.some((n) => n.split(',').length > 2)) {
    add('list', `Line ${line} looks like a list. Split it on the commas, or keep it as one name.`);
  }
  if (names.some(unbalanced) || (displayName && unbalanced(displayName))) {
    add('brackets', `Line ${line} has a ( or ) with no partner.`);
  }
  if (names.some((n) => /[,;:(/-]$/.test(n))) add('stray', `Line ${line} ends with a stray character.`);
  if (names.some((n) => n.length > 60)) add('long', `Line ${line} is long. Is it one name?`);
  if (/presents/i.test(`${names.join(' ')} ${displayName ?? ''}`)) add('presents', `Line ${line}: check this split.`);
  return flags;
}

function flagDuplicates(entries: ParsedLine[]): LineFlag[] {
  const first = new Map<string, number>();
  const flags: LineFlag[] = [];
  for (const entry of entries) {
    const key = lineupEntryKey(entry);
    const seen = first.get(key);
    if (seen === undefined) first.set(key, entry.line);
    else flags.push({ line: entry.line, kind: 'duplicate', message: `Line ${entry.line} repeats line ${seen}.`, blocking: true });
  }
  return flags;
}

function headingTier(text: string, current: number | null): number | null {
  const explicit = /^tier\s*([1-9])$/i.exec(text.trim());
  if (explicit) return Number(explicit[1]);
  return Math.min(9, (current ?? 0) + 1);
}

/** Parses pasted text. `separator` is the festival's B2B word; " b2b " always splits too. */
export function parseLineupText(text: string, separator = 'b2b'): ParseResult {
  const result = emptyResult();
  const splitRe = new RegExp(`\\s+(?:${escapeRe(separator || 'b2b')}|b2b)\\s+`, 'i');
  let tier: number | null = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (!trimmed) {
      result.skipped++;
      return;
    }
    const heading = /^#+\s*(.*)$/.exec(trimmed);
    if (heading) {
      tier = headingTier(heading[1]!, tier);
      return;
    }
    const bar = trimmed.indexOf('|');
    const namePart = bar === -1 ? trimmed : trimmed.slice(0, bar);
    const displayName = bar === -1 ? null : trimmed.slice(bar + 1).trim() || null;
    const names = namePart.split(splitRe).map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) return;
    result.entries.push({ line, artists: names.map((name) => ({ name, links: {} })), displayName, tier });
    result.flags.push(...flagLine(line, names, displayName));
  });
  result.flags.push(...flagDuplicates(result.entries));
  result.b2b = result.entries.filter((e) => e.artists.length > 1).length;
  return result;
}

const ENTRY_KEYS = new Set(['id', 'artists', 'displayName', 'tier', 'dayDate', 'status']);
const LIST_KEYS = ['candidates', 'acts', 'lineup', 'entries'];

function countDropped(dropped: Record<string, number>, key: string) {
  dropped[key] = (dropped[key] ?? 0) + 1;
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  return /^https?:\/\/\S+$/i.test(value) ? value : null;
}

/** Parses pasted JSON: an array of entries, or an object that holds one under candidates, acts or lineup. */
export function parseLineupJson(text: string, separator = 'b2b'): ParseResult {
  const result = emptyResult();
  const fail = (): ParseResult => ({
    ...emptyResult(),
    error: 'This is not a lineup list. Check the JSON, or paste one name per line instead.',
  });
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail();
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? (LIST_KEYS.map((k) => (data as Record<string, unknown>)[k]).find(Array.isArray) as unknown[] | undefined)
      : undefined;
  if (!list) return fail();

  list.forEach((item, index) => {
    const line = index + 1;
    const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    const rawArtists = Array.isArray(obj?.artists) ? (obj!.artists as unknown[]) : [];
    const artists: Artist[] = [];
    for (const raw of rawArtists) {
      const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
      const name = typeof a?.name === 'string' ? a.name.trim() : '';
      if (!a || !name) continue;
      const links: Record<string, string> = {};
      for (const [platform, url] of Object.entries((a.links as Record<string, unknown>) ?? {})) {
        const safe = LINK_PLATFORMS.includes(platform) ? safeUrl(url) : null;
        if (safe) {
          links[platform] = safe;
          result.linksKept++;
        } else if (url) countDropped(result.dropped, `links.${platform}`);
      }
      for (const key of Object.keys(a)) if (key !== 'name' && key !== 'links') countDropped(result.dropped, key);
      artists.push({ name: name.slice(0, 300), links });
    }
    if (!obj || artists.length === 0) {
      result.flags.push({ line, kind: 'invalid', message: `Entry ${line} has no artists.`, blocking: true });
      return;
    }
    for (const key of Object.keys(obj)) if (!ENTRY_KEYS.has(key)) countDropped(result.dropped, key);
    const parsed: ParsedLine = {
      line,
      artists,
      displayName: typeof obj.displayName === 'string' ? obj.displayName.trim().slice(0, 300) || null : null,
      tier: Number.isInteger(obj.tier) && (obj.tier as number) >= 1 && (obj.tier as number) <= 9 ? (obj.tier as number) : null,
    };
    if (typeof obj.id === 'string' && ID_RE.test(obj.id)) parsed.id = obj.id;
    if (typeof obj.dayDate === 'string' && DATE_RE.test(obj.dayDate)) parsed.dayDate = obj.dayDate;
    if (obj.status === 'announced' || obj.status === 'cancelled') parsed.status = obj.status;
    result.entries.push(parsed);
    result.flags.push(...flagLine(line, artists.map((a) => a.name), parsed.displayName));
  });
  void separator;
  result.flags.push(...flagDuplicates(result.entries));
  result.b2b = result.entries.filter((e) => e.artists.length > 1).length;
  return result;
}

/** One-line summary of a parse: "42 names (1 is b2b) · 247 links kept · dropped keys: day (42)". */
export function describeParse(result: ParseResult): string {
  const n = result.entries.length;
  const parts = [`${n} ${n === 1 ? 'name' : 'names'}${result.b2b ? ` (${result.b2b} ${result.b2b === 1 ? 'is' : 'are'} b2b)` : ''}`];
  if (result.linksKept > 0) parts.push(`${result.linksKept} links kept`);
  const dropped = Object.entries(result.dropped).map(([key, count]) => `${key} (${count})`);
  if (dropped.length > 0) parts.push(`dropped keys: ${dropped.join(', ')}`);
  return parts.join(' · ');
}

// ── Merge ────────────────────────────────────────────────────────────────

export interface MergeOptions {
  /** "add": never remove an entry. "replace": entries that are not in the paste go. */
  mode: 'add' | 'replace';
  /** A day to put every pasted line on. null leaves matched entries on their day and new ones on "Day TBA". */
  dayDate?: string | null;
  /** Pasted line number -> stored entry id, from "Same act as X". */
  sameAs?: Record<number, string>;
}

export interface MergeResult {
  lineup: LineupDraft[];
  summary: { matched: number; added: number; kept: number; removed: number };
  removedEntries: LineupDraft[];
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Which stored entry a pasted line matches: a "Same act as" choice, then its id, then its entry key. */
function findMatch(prev: LineupDraft[], used: Set<number>, parsed: ParsedLine, sameAs?: Record<number, string>): number {
  const free = (i: number) => i >= 0 && !used.has(i);
  const chosen = sameAs?.[parsed.line];
  if (chosen) {
    const i = prev.findIndex((e) => e.id === chosen);
    if (free(i)) return i;
  }
  if (parsed.id) {
    const i = prev.findIndex((e) => e.id === parsed.id);
    if (free(i)) return i;
  }
  const key = lineupEntryKey(parsed);
  return prev.findIndex((e, i) => !used.has(i) && lineupEntryKey(e) === key);
}

const NEAR_MIN_KEY_LENGTH = 4;

export interface NearMatch {
  line: number;
  name: string;
  existingId: string;
  existingName: string;
}

const entryName = (e: { artists: { name: string }[] }) => e.artists.map((a) => a.name).join(' b2b ');

/** New lines whose key is within edit distance 2 of a stored entry that the paste does not match. */
export function findNearMatches(prev: LineupDraft[], parsed: ParsedLine[]): NearMatch[] {
  const used = new Set<number>();
  const fresh: ParsedLine[] = [];
  for (const p of parsed) {
    const i = findMatch(prev, used, p);
    if (i >= 0) used.add(i);
    else fresh.push(p);
  }
  const out: NearMatch[] = [];
  for (const p of fresh) {
    const key = lineupEntryKey(p);
    const near = prev.find((e, i) => {
      if (used.has(i) || !e.id) return false;
      const other = lineupEntryKey(e);
      return Math.min(key.length, other.length) >= NEAR_MIN_KEY_LENGTH && editDistance(key, other) <= 2;
    });
    if (near) out.push({ line: p.line, name: entryName(p), existingId: near.id!, existingName: entryName(near) });
  }
  return out;
}

function mergeLinks(prev: Artist[], next: Artist[]): Artist[] {
  const prevByKey = new Map(prev.map((a) => [lineupNameKey(a.name), a.links ?? {}]));
  return next.map((a) => ({ ...a, links: { ...(prevByKey.get(lineupNameKey(a.name)) ?? {}), ...(a.links ?? {}) } }));
}

/**
 * Merges a parse into the stored list. A matched line keeps the entry's id, links, day, status,
 * announcedAt and linked sets. A heading sets the tier; without one the old tier stays.
 */
export function mergeLineupPaste(prev: LineupDraft[], parsed: ParsedLine[], options: MergeOptions): MergeResult {
  const used = new Set<number>();
  const dayDate = options.dayDate ?? null;
  const matchedAt = new Map<number, LineupDraft>();
  const added: LineupDraft[] = [];
  const pastedOrder: LineupDraft[] = [];
  for (const p of parsed) {
    const i = findMatch(prev, used, p, options.sameAs);
    let draft: LineupDraft;
    if (i >= 0) {
      used.add(i);
      const old = prev[i]!;
      const renamed = options.sameAs?.[p.line] === old.id;
      draft = {
        ...old,
        artists: mergeLinks(old.artists, renamed ? p.artists : old.artists.map((a, k) => ({ ...a, links: p.artists[k]?.links ?? {} }))),
        displayName: p.displayName ?? old.displayName,
        tier: p.tier ?? old.tier,
        dayDate: p.dayDate !== undefined ? p.dayDate : (dayDate ?? old.dayDate),
        status: p.status ?? old.status,
      };
      matchedAt.set(i, draft);
    } else {
      draft = {
        ...(p.id ? { id: p.id } : {}),
        artists: p.artists,
        displayName: p.displayName,
        tier: p.tier,
        dayDate: p.dayDate !== undefined ? p.dayDate : dayDate,
        status: p.status ?? 'announced',
        linkedSetIds: [],
      };
      added.push(draft);
    }
    pastedOrder.push(draft);
  }
  const leftover = prev.filter((_, i) => !used.has(i));
  const summary = { matched: matchedAt.size, added: added.length, kept: 0, removed: 0 };
  if (options.mode === 'replace') {
    summary.removed = leftover.length;
    return { lineup: pastedOrder, summary, removedEntries: leftover };
  }
  summary.kept = leftover.length;
  const lineup = [...prev.map((e, i) => matchedAt.get(i) ?? e), ...added];
  return { lineup, summary, removedEntries: [] };
}

/** "31 matched, 2 new, 85 kept" or "31 matched, 2 new, 85 removed". */
export function describeMerge(summary: MergeResult['summary'], mode: MergeOptions['mode']): string {
  const tail = mode === 'replace' ? `${summary.removed} removed` : `${summary.kept} kept`;
  return `${summary.matched} matched, ${summary.added} new, ${tail}`;
}

/** The "Edit names" text: untiered lines first, then a "# Tier N" heading per tier. It parses back to the same list. */
export function lineupToText(lineup: LineupDraft[], separator = 'b2b'): string {
  const out: string[] = [];
  const line = (e: LineupDraft) => {
    const names = e.artists.map((a) => a.name).join(` ${separator || 'b2b'} `);
    return e.displayName ? `${names} | ${e.displayName}` : names;
  };
  out.push(...lineup.filter((e) => e.tier == null).map(line));
  const tiers = [...new Set(lineup.map((e) => e.tier).filter((t): t is number => t != null))].sort((a, b) => a - b);
  for (const tier of tiers) {
    out.push(`# Tier ${tier}`, ...lineup.filter((e) => e.tier === tier).map(line));
  }
  return out.join('\n');
}
