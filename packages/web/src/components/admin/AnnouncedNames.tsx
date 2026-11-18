import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createArtist, matchArtists } from '@festie/shared/services';
import type { ArtistCandidate } from '@festie/shared/services';
import {
  MAX_LINEUP_LINES,
  coverLineup,
  describeMerge,
  describeParse,
  findNearMatches,
  lineupEntryKey,
  lineupNotices,
  lineupToText,
  matchCandidateSets,
  mergeLineupPaste,
  parseLineupJson,
  parseLineupText,
} from '@festie/shared/utils';
import type { LineupDraft } from '@festie/shared/utils';
import type { Artist, LineupEntry } from '@festie/shared/types';
import type { LineupInterestCounts } from '@festie/shared/services';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import Dialog from '../ui/Dialog';
import ArtistSlotMatch from './ArtistSlotMatch';
import type { SlotMatch } from './ArtistSlotMatch';

type FormSet = {
  id: string;
  artist?: string;
  artists?: Artist[];
  stageId?: string;
  startTime?: string | null;
  [key: string]: unknown;
};
type FormDay = { date?: string; label?: string; sets?: FormSet[] };

interface Props<D extends FormDay> {
  lineup: LineupDraft[];
  days: D[];
  /** Days as last saved, so the save summary can name acts that a removed set unschedules. */
  savedDays?: FormDay[];
  /** The lineup as last saved, so the save summary can count marks on entries this save removes. */
  savedLineup?: LineupDraft[];
  /** Stages of the festival, for "Copy to day...". */
  stages?: { id: string; name: string }[];
  separator?: string;
  /** Changes whenever a save lands, which clears "Not saved yet". */
  savedAt?: string;
  /** Marks per entry id (admin demand view). A row shows "N marked" when it has any. */
  interestCounts?: LineupInterestCounts;
  /** `nextDays` comes with a change that also edits sets: Cancelled removes the act's sets, Copy to day adds one. */
  onChange: (next: LineupDraft[], nextDays?: D[]) => void;
}

type Filter = 'all' | 'tba' | 'unscheduled' | 'cancelled';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'tba', label: 'Day TBA' },
  { key: 'unscheduled', label: 'Not scheduled yet' },
  { key: 'cancelled', label: 'Cancelled' },
];

const FIELD =
  'px-2 py-1.5 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua';
const SMALL_BUTTON =
  'px-3 py-1.5 rounded-lg bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium';

const nameKey = (name: string) => name.trim().toLowerCase();
/** The match route takes at most this many names per call. */
const MATCH_BATCH = 500;
type NameMatch = { name: string; match: SlotMatch };
type DraftArtist = LineupDraft['artists'][number];

const joinNames = (e: LineupDraft, sep: string) => e.artists.map((a) => a.name).join(` ${sep} `);

/** An id-less entry is new, so its row key falls back to the position. */
const rowKey = (e: LineupDraft, i: number) => e.id ?? `new-${i}`;

/** The artists input and the poster-name input commit on blur, so typing "A b2b B" is not re-split on every key. */
function EditableText({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  /** Returns an error message to refuse the edit; the draft then resets to the saved text. */
  onCommit: (next: string) => string | null | void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft === value) return;
    const refused = onCommit(draft);
    setError(refused || null);
    if (refused) setDraft(value);
  };
  return (
    <div>
      <input
        type="text"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className={`${FIELD} w-full`}
      />
      {error && <p role="alert" className="mt-1 text-xs text-accent-coral">{error}</p>}
    </div>
  );
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export default function AnnouncedNames<D extends FormDay>({
  lineup,
  days,
  savedDays,
  savedLineup,
  stages = [],
  separator,
  savedAt,
  interestCounts,
  onChange,
}: Props<D>) {
  const sep = separator || 'b2b';
  const [filter, setFilter] = useState<Filter>('all');
  const [unsaved, setUnsaved] = useState(false);
  const [dialog, setDialog] = useState<null | 'paste' | 'edit'>(null);
  const [text, setText] = useState('');
  const [jsonMode, setJsonMode] = useState(false);
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const [dayDate, setDayDate] = useState('');
  const [sameAs, setSameAs] = useState<Record<number, string>>({});
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  // Rows waiting for the "N people marked this act" confirm, as positions in `lineup`.
  const [pendingRemoval, setPendingRemoval] = useState<number[] | null>(null);
  const [cancelNotes, setCancelNotes] = useState<Record<string, string>>({});
  const [copyFor, setCopyFor] = useState<number | null>(null);
  const [copyDay, setCopyDay] = useState('');
  const [copyStage, setCopyStage] = useState('');
  const [matchFor, setMatchFor] = useState<number | null>(null);
  const [linked, setLinked] = useState<string[]>([]);

  useEffect(() => {
    setUnsaved(false);
    setCancelNotes({});
  }, [savedAt]);

  // Names with no artist id that fit an artist Festie already has, by lower-cased name.
  const [matches, setMatches] = useState<Record<string, NameMatch>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const latestLineup = useRef(lineup);
  latestLineup.current = lineup;
  const matchRun = useRef(0);

  /** Asks the server which unlinked names match an artist (one call per 500 names), then links the clear ones. */
  const matchNames = async (list: LineupDraft[]) => {
    const run = ++matchRun.current;
    const names = [
      ...new Map(list.flatMap((e) => e.artists).filter((a) => !a.id && a.name.trim()).map((a) => [nameKey(a.name), a.name.trim()])).values(),
    ];
    if (names.length === 0) return setMatches({});
    try {
      const found = [];
      for (let i = 0; i < names.length; i += MATCH_BATCH) {
        found.push(...(await matchArtists(names.slice(i, i + MATCH_BATCH).map((name) => ({ name })))));
      }
      if (run !== matchRun.current) return;
      const next: Record<string, NameMatch> = {};
      const linkTo = new Map<string, ArtistCandidate>();
      found.forEach((f, i) => {
        const name = names[i]!;
        if (f.outcome === 'linked' && f.candidates[0]) {
          linkTo.set(nameKey(name), f.candidates[0]);
          next[nameKey(name)] = { name, match: { kind: 'linked', candidate: f.candidates[0] } };
        } else if (f.outcome === 'pick') next[nameKey(name)] = { name, match: { kind: 'pick', name, candidates: f.candidates } };
      });
      if (linkTo.size > 0) {
        onChange(
          latestLineup.current.map((e) => ({
            ...e,
            artists: e.artists.map((a) => {
              const c = a.id ? undefined : linkTo.get(nameKey(a.name));
              return c ? { ...a, id: c.id, name: c.name } : a;
            }),
          })),
        );
      }
      setMatches(next);
      setReviewOpen(false);
    } catch (err) {
      // Offline or refused: the names stay free text and the server resolves them on save.
      console.warn('Could not match the announced names', err);
    }
  };

  const changeNamed = (key: string, only: (a: DraftArtist) => boolean, change: (a: DraftArtist) => DraftArtist) =>
    onChange(latestLineup.current.map((e) => ({ ...e, artists: e.artists.map((a) => (nameKey(a.name) === key && only(a) ? change(a) : a)) })));

  const pickFor = (key: string, name: string, c: ArtistCandidate) => {
    changeNamed(key, (a) => a.id !== c.id, (a) => ({ ...a, id: c.id, name: c.name }));
    setMatches((m) => ({ ...m, [key]: { name, match: { kind: 'linked', candidate: c } } }));
  };

  const notThisOne = (key: string, name: string, c: ArtistCandidate) => {
    changeNamed(key, (a) => a.id === c.id, ({ id: _id, ...rest }) => rest);
    setMatches((m) => ({ ...m, [key]: { name, match: { kind: 'pick', name, candidates: [c] } } }));
  };

  const createFor = async (key: string, name: string, label: string): Promise<string | null> => {
    try {
      const created = await createArtist({ name, label });
      pickFor(key, name, { id: created.id, name: created.name, label: created.label, photo: created.photo, platforms: [], lastFestival: null });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Couldn't create the artist. Try again.";
    }
  };

  const matched = Object.entries(matches);
  const needChoice = matched.filter(([, m]) => m.match.kind === 'pick').length;

  const datedDays = days.filter((d) => d.date);
  // New lines have no id until the server saves them, so the cover rule gets a stand-in key.
  const keyed = useMemo<LineupEntry[]>(
    () => lineup.map((e, i) => ({ ...e, id: rowKey(e, i), announcedAt: e.announcedAt ?? '' })),
    [lineup],
  );
  const cover = useMemo(() => coverLineup(keyed, days, sep), [keyed, days, sep]);
  const notices = useMemo(() => lineupNotices(keyed, days, sep, savedDays), [keyed, days, savedDays, sep]);

  /** Marks on an entry, open and converted together. Converted marks still show demand. */
  const marksOf = (entry: LineupDraft) => {
    const counts = entry.id ? interestCounts?.[entry.id] : undefined;
    return counts ? counts.open + counts.converted : 0;
  };
  const totalMarks = (entries: LineupDraft[]) => entries.reduce((sum, e) => sum + marksOf(e), 0);
  /** "12 people marked it." for one entry, "They carry 12 marks." for several (one person can mark many acts). */
  const marksPhrase = (entries: LineupDraft[]) => {
    const total = totalMarks(entries);
    if (total === 0) return '';
    return entries.length === 1 ? ` ${total} ${plural(total, 'person', 'people')} marked it.` : ` They carry ${total} marks.`;
  };

  // Saved entries that this form no longer holds, and the marks they carry.
  const presentIds = new Set(lineup.map((e) => e.id));
  const removedMarked = (savedLineup ?? []).filter((e) => e.id && !presentIds.has(e.id) && marksOf(e) > 0);
  const saveNotices = removedMarked.length
    ? [
        ...notices,
        `${removedMarked.length} ${plural(removedMarked.length, 'entry with marks', 'entries with marks')} will be removed (${totalMarks(removedMarked)} marks).`,
      ]
    : notices;

  const parsed = useMemo(
    () => (!text.trim() ? null : jsonMode ? parseLineupJson(text, sep) : parseLineupText(text, sep)),
    [text, jsonMode, sep],
  );
  const merge = useMemo(
    () => (parsed ? mergeLineupPaste(lineup, parsed.entries, {
          mode,
          dayDate: dayDate || null,
          sameAs,
          exactTiers: parsed.hasHeadings || dialog === 'edit',
          exactNames: dialog === 'edit',
        }) : null),
    [parsed, lineup, mode, dayDate, sameAs, dialog],
  );
  const nearMatches = useMemo(() => (parsed ? findNearMatches(lineup, parsed.entries) : []), [parsed, lineup]);
  const blocking = parsed?.flags.filter((f) => f.blocking) ?? [];
  const tooMany = (merge?.lineup.length ?? 0) > MAX_LINEUP_LINES;
  const canApply = !!parsed && !parsed.error && parsed.entries.length > 0 && blocking.length === 0 && !tooMany;

  const openDialog = (kind: 'paste' | 'edit') => {
    setDialog(kind);
    setText(kind === 'edit' ? lineupToText(lineup, sep) : '');
    setJsonMode(false);
    setMode(kind === 'edit' ? 'replace' : 'add');
    setDayDate('');
    setSameAs({});
    setConfirmRemoval(false);
  };

  // Entries a replace would drop, so the confirm can say how many people marked them.
  const keptIds = new Set(merge?.lineup.map((e) => e.id));
  const droppedByMerge = merge ? lineup.filter((e) => e.id && !keptIds.has(e.id)) : [];

  const apply = () => {
    if (!merge) return;
    if (mode === 'replace' && merge.summary.removed > 0 && !confirmRemoval) {
      setConfirmRemoval(true);
      return;
    }
    onChange(merge.lineup);
    setUnsaved(true);
    setDialog(null);
    void matchNames(merge.lineup);
  };

  const patch = (index: number, change: Partial<LineupDraft>) =>
    onChange(lineup.map((e, i) => (i === index ? { ...e, ...change } : e)));

  const removeRows = (indices: number[]) => {
    const drop = new Set(indices);
    onChange(lineup.filter((_, i) => !drop.has(i)));
    setUnsaved(true);
  };

  /** An entry with marks needs a confirm: a removed act takes its marks with it. */
  const requestRemoval = (indices: number[]) => {
    if (indices.some((i) => marksOf(lineup[i]!) > 0)) setPendingRemoval(indices);
    else removeRows(indices);
  };

  /** Cancelling an act takes its covering sets off the grid in the same edit, so no struck-through act sits on the timetable. */
  const setCancelled = (index: number, on: boolean) => {
    const entry = lineup[index]!;
    const key = rowKey(entry, index);
    const status = on ? ('cancelled' as const) : ('announced' as const);
    const next = lineup.map((e, i) => (i === index ? { ...e, status } : e));
    const setIds = new Set(on ? (cover[key]?.setIds ?? []) : []);
    setCancelNotes((prev) => {
      const rest = { ...prev };
      delete rest[key];
      return rest;
    });
    if (setIds.size === 0) return onChange(next);
    const count = setIds.size;
    setCancelNotes((prev) => ({
      ...prev,
      [key]: `Its ${count} ${plural(count, 'set is', 'sets are')} removed too. To drop one set only, delete that set instead.`,
    }));
    onChange(next, days.map((d) => ({ ...d, sets: (d.sets ?? []).filter((set) => !setIds.has(set.id)) })));
  };

  const openCopy = (index: number) => {
    setCopyFor(index);
    setCopyDay('');
    setCopyStage(stages.length === 1 ? stages[0]!.id : '');
  };

  /** Adds a set with the act's artists and poster name and no times to the chosen day. The next Save writes it. */
  const copyToDay = () => {
    if (copyFor === null) return;
    const entry = lineup[copyFor]!;
    const dayIndex = Number(copyDay);
    const set: FormSet = {
      id: `set-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      artist: joinNames(entry, sep),
      stageId: copyStage,
      startTime: '',
      endTime: '',
      artists: entry.artists.map((a) => ({ ...a })),
      ...(entry.displayName ? { displayName: entry.displayName } : {}),
    };
    onChange(lineup, days.map((d, i) => (i === dayIndex ? { ...d, sets: [set, ...(d.sets ?? [])] } : d)));
    setUnsaved(true);
    setCopyFor(null);
  };

  const openMatch = (index: number) => {
    setMatchFor(index);
    setLinked(lineup[index]!.linkedSetIds ?? []);
  };

  const matchCandidates = matchFor === null ? [] : matchCandidateSets(lineup[matchFor]!, days, sep);

  /** Links stay a hand-made list: ids the dialog could not show (a deleted set) are kept as they were. */
  const saveLinks = () => {
    if (matchFor === null) return;
    const offered = new Set(matchCandidates.map((c) => c.setId));
    const kept = (lineup[matchFor]!.linkedSetIds ?? []).filter((id) => !offered.has(id));
    patch(matchFor, { linkedSetIds: [...kept, ...linked.filter((id) => offered.has(id))].slice(0, 10) });
    setUnsaved(true);
    setMatchFor(null);
  };

  const setWhen = (setId: string, dayIndex: number) => {
    const set = days[dayIndex]?.sets?.find((s) => s.id === setId);
    const day = days[dayIndex]?.label || days[dayIndex]?.date || `Day ${dayIndex + 1}`;
    const stage = stages.find((st) => st.id === set?.stageId)?.name;
    return [day, stage, set?.startTime || 'Time TBA'].filter(Boolean).join(' · ');
  };

  const rename = (index: number, value: string): string | null => {
    const entry = lineup[index]!;
    const names = value.split(new RegExp(`\\s+(?:${sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|b2b)\\s+`, 'i')).map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) return 'Enter at least one artist name.';
    if (names.length > 4) return 'A line holds at most 4 artists. Put the full text in the poster name instead.';
    // A name that survives the rename keeps its links.
    const links = new Map(entry.artists.map((a) => [a.name.toLowerCase(), a.links ?? {}]));
    patch(index, { artists: names.map((name) => ({ name, links: links.get(name.toLowerCase()) ?? {} })) });
    return null;
  };

  const rows = lineup
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => {
      if (filter === 'tba') return !entry.dayDate;
      if (filter === 'cancelled') return entry.status === 'cancelled';
      if (filter === 'unscheduled') return entry.status !== 'cancelled' && cover[rowKey(entry, index)]?.state !== 'scheduled';
      return true;
    });

  const duplicates = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<number>();
    lineup.forEach((e, i) => {
      const key = lineupEntryKey(e);
      if (seen.has(key)) dup.add(i);
      seen.add(key);
    });
    return dup;
  }, [lineup]);

  const stateChip = (entry: LineupDraft, index: number) => {
    if (entry.status === 'cancelled') return 'Cancelled';
    const n = cover[rowKey(entry, index)]?.setIds.length ?? 0;
    return n > 0 ? `Scheduled (${n} ${n === 1 ? 'set' : 'sets'})` : 'Announced';
  };

  /** "12 marked" for an entry that people marked. Open and converted both count: converted marks still show demand. */
  const markedLabel = (entry: LineupDraft) => {
    const total = marksOf(entry);
    return total > 0 ? `${total} marked` : null;
  };

  const pendingMarked = pendingRemoval ? pendingRemoval.filter((i) => marksOf(lineup[i]!) > 0).length : 0;
  return (
    <div className="border-t border-glass-border pt-4" data-testid="announced-names">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h2 className="type-label text-text-primary">Announced names</h2>
        <span className="text-sm text-text-muted">{lineup.length} {lineup.length === 1 ? 'act' : 'acts'}</span>
        {unsaved && <span role="status" className="text-xs text-accent-amber">Not saved yet. Use Save below.</span>}
      </div>
      <p className="text-xs text-text-muted mb-3">
        Add the lineup before the schedule exists. Attendees do not see it yet.
      </p>
      {lineup.length > 0 && (
        <ul className="text-xs text-text-muted mb-3 space-y-0.5 list-disc list-inside" aria-label="Ways to add days and times">
          <li>Spreadsheet: export, fill in stages and times in a sheet, then import. The preview shows every change before you save.</li>
          <li>Copy to day…: for small fixes, put one act on a day and stage, without times.</li>
          <li>Matches set…: for small fixes, tell Festie that this act and that set are the same.</li>
        </ul>
      )}
      <div className="flex flex-wrap gap-2 mb-3">
        <button type="button" onClick={() => openDialog('paste')} className={SMALL_BUTTON}>Paste names</button>
        {lineup.length > 0 && (
          <>
            <button type="button" onClick={() => openDialog('edit')} className={SMALL_BUTTON}>Edit names</button>
            <button
              type="button"
              onClick={() => requestRemoval(lineup.map((_, i) => i))}
              className="px-3 py-1.5 rounded-lg bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-sm"
            >
              Remove all
            </button>
          </>
        )}
      </div>

      {saveNotices.length > 0 && (
        <ul className="mb-3 rounded-lg border border-accent-amber/40 p-3 text-xs text-accent-amber list-disc list-inside" aria-label="Lineup notices">
          {saveNotices.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}

      {matched.length > 0 && (
        <div className="mb-3 rounded-lg border border-glass-border p-3 text-xs text-text-primary space-y-2" data-testid="artist-matches">
          <p className="flex flex-wrap items-center gap-2">
            <span>
              {matched.length} {matched.length === 1 ? 'name matches an artist' : 'names match artists'} already in Festie.
              {needChoice > 0 && ` ${needChoice} ${needChoice === 1 ? 'needs' : 'need'} a choice.`}
            </span>
            <button type="button" aria-expanded={reviewOpen} onClick={() => setReviewOpen((v) => !v)} className="text-accent-aqua hover:underline">
              {reviewOpen ? 'Hide' : 'Review'}
            </button>
          </p>
          {reviewOpen && (
            <ul className="space-y-2">
              {matched.map(([key, { name, match }]) => (
                <li key={key} className="space-y-1">
                  <span className="text-text-muted">{name}</span>
                  <ArtistSlotMatch
                    name={name}
                    match={match}
                    onPick={(c) => pickFor(key, name, c)}
                    onNotThisOne={() => match.kind === 'linked' && notThisOne(key, name, match.candidate)}
                    onCreate={(note) => createFor(key, name, note)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {lineup.length > 0 && (
        <>
          <div role="group" aria-label="Filter announced acts" className="flex flex-wrap gap-2 mb-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1 rounded-lg text-xs ${filter === f.key ? 'bg-accent-aqua/20 text-accent-aqua' : 'bg-bg-primary text-text-muted'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="space-y-2 max-h-[32rem] overflow-y-auto">
            {rows.map(({ entry, index }) => {
              const dayGone = !!entry.dayDate && !datedDays.some((d) => d.date === entry.dayDate);
              const label = joinNames(entry, sep);
              return (
                <div key={rowKey(entry, index)} className="grid grid-cols-1 md:grid-cols-[2fr_2fr_5rem_9rem_auto_auto] gap-2 items-center rounded-lg border border-glass-border p-2">
                  <EditableText label={`Artists for ${label}`} value={label} onCommit={(v) => rename(index, v)} />
                  <EditableText
                    label={`Poster name for ${label}`}
                    placeholder="Poster name"
                    value={entry.displayName ?? ''}
                    onCommit={(v) => patch(index, { displayName: v.trim() || null })}
                  />
                  <select
                    aria-label={`Tier for ${label}`}
                    value={entry.tier ?? ''}
                    onChange={(e) => patch(index, { tier: e.target.value ? Number(e.target.value) : null })}
                    className={FIELD}
                  >
                    <option value="">No tier</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => <option key={t} value={t}>Tier {t}</option>)}
                  </select>
                  <select
                    aria-label={`Day for ${label}`}
                    value={entry.dayDate ?? ''}
                    onChange={(e) => patch(index, { dayDate: e.target.value || null })}
                    className={FIELD}
                  >
                    <option value="">Day TBA</option>
                    {dayGone && <option value={entry.dayDate!}>Day removed ({entry.dayDate})</option>}
                    {datedDays.map((d) => <option key={d.date} value={d.date}>{d.label || d.date}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-text-primary">
                    <input
                      type="checkbox"
                      checked={entry.status === 'cancelled'}
                      onChange={(e) => setCancelled(index, e.target.checked)}
                    />
                    Cancelled
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted whitespace-nowrap">{stateChip(entry, index)}</span>
                    {markedLabel(entry) && <span className="text-xs text-accent-aqua whitespace-nowrap">{markedLabel(entry)}</span>}
                    <button
                      type="button"
                      aria-label={`Remove ${label}`}
                      onClick={() => requestRemoval([index])}
                      className="px-2 py-1 rounded-lg bg-accent-coral/20 text-accent-coral text-xs"
                    >
                      Remove
                    </button>
                  </div>
                  {entry.status !== 'cancelled' && (
                    <div className="md:col-span-6 flex flex-wrap items-center gap-2">
                      {cover[rowKey(entry, index)]?.state === 'announced' && (
                        <button type="button" aria-label={`Copy ${label} to a day`} onClick={() => openCopy(index)} className={SMALL_BUTTON}>
                          Copy to day…
                        </button>
                      )}
                      <button type="button" aria-label={`Matches set for ${label}`} onClick={() => openMatch(index)} className={SMALL_BUTTON}>
                        Matches set…
                      </button>
                      {(entry.linkedSetIds ?? []).length > 0 && (
                        <span className="text-xs text-text-muted">
                          Linked to {entry.linkedSetIds.length} {plural(entry.linkedSetIds.length, 'set', 'sets')} by hand
                        </span>
                      )}
                    </div>
                  )}
                  {cancelNotes[rowKey(entry, index)] && (
                    <p role="status" className="md:col-span-6 text-xs text-accent-amber">{cancelNotes[rowKey(entry, index)]}</p>
                  )}
                  {duplicates.has(index) && (
                    <p className="md:col-span-6 text-xs text-accent-coral">This act is listed twice. Remove one line before you save.</p>
                  )}
                </div>
              );
            })}
            {rows.length === 0 && <p className="text-xs text-text-muted">No acts match this filter.</p>}
          </div>
        </>
      )}

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === 'edit' ? 'Edit names' : 'Paste names'}
        description="One name per line. 'A b2b B' is one line with two artists. To show a different name on the poster, add it after a bar. Start a tier with a # heading."
      >
        <div className="space-y-3">
          <textarea
            aria-label={jsonMode ? 'Lineup JSON' : 'Names'}
            rows={8}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSameAs({});
              setConfirmRemoval(false);
            }}
            className={`${FIELD} w-full font-mono`}
          />
          {dialog === 'paste' && (
            <>
              <label className="flex items-center gap-2 text-xs text-text-muted">
                <input type="checkbox" checked={jsonMode} onChange={(e) => setJsonMode(e.target.checked)} />
                Advanced: paste lineup JSON
              </label>
              <fieldset className="text-xs text-text-primary space-y-1">
                <legend className="text-text-muted">When names are already listed</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="lineup-mode" checked={mode === 'add'} onChange={() => setMode('add')} />
                  Add and update
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="lineup-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                  Replace list
                </label>
              </fieldset>
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                Day
                <select aria-label="Paste for day" value={dayDate} onChange={(e) => setDayDate(e.target.value)} className={FIELD}>
                  <option value="">No day (TBA)</option>
                  {datedDays.map((d) => <option key={d.date} value={d.date}>{d.label || d.date}</option>)}
                </select>
              </label>
            </>
          )}

          {parsed?.error && <p role="alert" className="text-xs text-accent-coral">{parsed.error}</p>}
          {parsed && !parsed.error && (
            <div className="text-xs space-y-1" aria-live="polite">
              <p className="text-text-primary">{describeParse(parsed)}</p>
              {parsed.skipped > 0 && <p className="text-text-muted">{parsed.skipped} empty {parsed.skipped === 1 ? 'line' : 'lines'} skipped.</p>}
              {merge && lineup.length > 0 && <p className="text-text-primary">{describeMerge(merge.summary, mode)}</p>}
              {parsed.flags.map((f, i) => (
                <p key={i} className={f.blocking ? 'text-accent-coral' : 'text-accent-amber'}>{f.message}</p>
              ))}
              {tooMany && <p className="text-accent-coral">A lineup holds at most {MAX_LINEUP_LINES} names.</p>}
              {nearMatches.length > 0 && (
                <div className="space-y-1">
                  <p className="text-text-muted">New entries that look like an existing one:</p>
                  {nearMatches.map((m) => (
                    <div key={m.line} className="flex items-center gap-2 text-text-primary">
                      <span>{m.name}</span>
                      <button
                        type="button"
                        aria-pressed={sameAs[m.line] === m.existingId}
                        onClick={() =>
                          setSameAs((prev) => {
                            const next = { ...prev };
                            if (next[m.line] === m.existingId) delete next[m.line];
                            else next[m.line] = m.existingId;
                            return next;
                          })
                        }
                        className="px-2 py-0.5 rounded bg-accent-aqua/20 text-accent-aqua"
                      >
                        Same act as {m.existingName}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {confirmRemoval && merge && (
            <p role="alert" className="text-xs text-accent-coral">
              {merge.summary.removed} {merge.summary.removed === 1 ? 'entry is' : 'entries are'} not in this paste.{marksPhrase(droppedByMerge)} Click again to remove {merge.summary.removed === 1 ? 'it' : 'them'}.
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={() => setDialog(null)} className="flex-1 min-h-11">Cancel</Button>
            <Button type="button" disabled={!canApply} onClick={apply} className="flex-1 min-h-11">
              {dialog === 'edit' ? 'Update list' : mode === 'replace' ? 'Replace list' : 'Add'}
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(o) => !o && setPendingRemoval(null)}
        title={pendingRemoval && pendingRemoval.length > 1 ? 'Remove these acts?' : 'Remove this act?'}
        description={
          pendingRemoval
            ? pendingRemoval.length === 1
              ? `${marksPhrase([lineup[pendingRemoval[0]!]!]).trim()} Remove it anyway? Use Cancelled to keep their marks.`
              : `${pendingMarked} of these ${pendingRemoval.length} acts ${plural(pendingMarked, 'has', 'have')} marks.${marksPhrase(pendingRemoval.map((i) => lineup[i]!))} Remove them anyway? Use Cancelled to keep their marks.`
            : ''
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (pendingRemoval) removeRows(pendingRemoval);
          setPendingRemoval(null);
        }}
      />

      <Dialog
        open={copyFor !== null}
        onOpenChange={(o) => !o && setCopyFor(null)}
        title="Copy to day"
        description="For small fixes: put one act on a day and stage, without times."
      >
        <div className="space-y-3">
          {days.length === 0 || stages.length === 0 ? (
            <p className="text-xs text-text-muted">Add {days.length === 0 ? 'a day' : 'a stage'} to the festival first.</p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                Day
                <select aria-label="Copy to day" value={copyDay} onChange={(e) => setCopyDay(e.target.value)} className={FIELD}>
                  <option value="">Choose a day</option>
                  {days.map((d, i) => <option key={i} value={i}>{d.label || d.date || `Day ${i + 1}`}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                Stage
                <select aria-label="Copy to stage" value={copyStage} onChange={(e) => setCopyStage(e.target.value)} className={FIELD}>
                  <option value="">Choose a stage</option>
                  {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
              </label>
            </>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={() => setCopyFor(null)} className="flex-1 min-h-11">Cancel</Button>
            <Button type="button" disabled={copyDay === '' || !copyStage} onClick={copyToDay} className="flex-1 min-h-11">Add set</Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={matchFor !== null}
        onOpenChange={(o) => !o && setMatchFor(null)}
        title="Matches set"
        description="For small fixes: tell Festie that this act and that set are the same."
      >
        <div className="space-y-3">
          {matchCandidates.length === 0 ? (
            <p className="text-xs text-text-muted">No set shares an artist name with this act yet.</p>
          ) : (
            <ul className="space-y-1">
              {matchCandidates.map((c) => {
                const byName =
                  matchFor !== null &&
                  (cover[rowKey(lineup[matchFor]!, matchFor)]?.setIds ?? []).includes(c.setId) &&
                  !linked.includes(c.setId);
                const checked = byName || linked.includes(c.setId);
                return (
                  <li key={c.setId}>
                    <label className="flex items-center gap-2 text-xs text-text-primary">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={byName || (!checked && linked.length >= 10)}
                        onChange={(e) => setLinked((prev) => (e.target.checked ? [...prev, c.setId] : prev.filter((id) => id !== c.setId)))}
                      />
                      <span>{c.names.join(` ${sep} `)} · {setWhen(c.setId, c.dayIndex)}{byName ? ' (same name)' : ''}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={() => setMatchFor(null)} className="flex-1 min-h-11">Cancel</Button>
            <Button type="button" onClick={saveLinks} className="flex-1 min-h-11">Save links</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
