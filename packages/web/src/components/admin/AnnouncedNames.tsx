import React, { useEffect, useMemo, useState } from 'react';
import {
  MAX_LINEUP_LINES,
  coverLineup,
  describeMerge,
  describeParse,
  findNearMatches,
  lineupEntryKey,
  lineupNotices,
  lineupToText,
  mergeLineupPaste,
  parseLineupJson,
  parseLineupText,
} from '@festie/shared/utils';
import type { LineupDraft } from '@festie/shared/utils';
import type { LineupEntry } from '@festie/shared/types';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';

type FormDay = { date?: string; label?: string; sets?: { id: string; artist?: string; artists?: { name: string }[] }[] };

interface Props {
  lineup: LineupDraft[];
  days: FormDay[];
  /** Days as last saved, so the save summary can name acts that a removed set unschedules. */
  savedDays?: FormDay[];
  separator?: string;
  /** Changes whenever a save lands, which clears "Not saved yet". */
  savedAt?: string;
  onChange: (next: LineupDraft[]) => void;
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
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="text"
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={`${FIELD} w-full`}
    />
  );
}

export default function AnnouncedNames({ lineup, days, savedDays, separator, savedAt, onChange }: Props) {
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

  useEffect(() => setUnsaved(false), [savedAt]);

  const datedDays = days.filter((d) => d.date);
  // New lines have no id until the server saves them, so the cover rule gets a stand-in key.
  const keyed = useMemo<LineupEntry[]>(
    () => lineup.map((e, i) => ({ ...e, id: rowKey(e, i), announcedAt: e.announcedAt ?? '' })),
    [lineup],
  );
  const cover = useMemo(() => coverLineup(keyed, days, sep), [keyed, days, sep]);
  const notices = useMemo(() => lineupNotices(keyed, days, sep, savedDays), [keyed, days, savedDays, sep]);

  const parsed = useMemo(
    () => (!text.trim() ? null : jsonMode ? parseLineupJson(text, sep) : parseLineupText(text, sep)),
    [text, jsonMode, sep],
  );
  const merge = useMemo(
    () => (parsed ? mergeLineupPaste(lineup, parsed.entries, { mode, dayDate: dayDate || null, sameAs }) : null),
    [parsed, lineup, mode, dayDate, sameAs],
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

  const apply = () => {
    if (!merge) return;
    if (mode === 'replace' && merge.summary.removed > 0 && !confirmRemoval) {
      setConfirmRemoval(true);
      return;
    }
    onChange(merge.lineup);
    setUnsaved(true);
    setDialog(null);
  };

  const patch = (index: number, change: Partial<LineupDraft>) =>
    onChange(lineup.map((e, i) => (i === index ? { ...e, ...change } : e)));

  const rename = (index: number, value: string) => {
    const entry = lineup[index]!;
    const names = value.split(new RegExp(`\\s+(?:${sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|b2b)\\s+`, 'i')).map((n) => n.trim()).filter(Boolean);
    if (names.length === 0 || names.length > 4) return;
    // A name that survives the rename keeps its links.
    const links = new Map(entry.artists.map((a) => [a.name.toLowerCase(), a.links ?? {}]));
    patch(index, { artists: names.map((name) => ({ name, links: links.get(name.toLowerCase()) ?? {} })) });
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

  return (
    <div className="border-t border-glass-border pt-4" data-testid="announced-names">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h2 className="type-label text-text-primary">Announced names</h2>
        <span className="text-sm text-text-muted">{lineup.length} {lineup.length === 1 ? 'act' : 'acts'}</span>
        {unsaved && <span role="status" className="text-xs text-accent-amber">Not saved yet. Use Save below.</span>}
      </div>
      <p className="text-xs text-text-muted mb-3">
        Add the lineup before the schedule exists. Attendees do not see it yet. Add days and times later with the spreadsheet import.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <button type="button" onClick={() => openDialog('paste')} className={SMALL_BUTTON}>Paste names</button>
        {lineup.length > 0 && (
          <>
            <button type="button" onClick={() => openDialog('edit')} className={SMALL_BUTTON}>Edit names</button>
            <button
              type="button"
              onClick={() => {
                onChange([]);
                setUnsaved(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-sm"
            >
              Remove all
            </button>
          </>
        )}
      </div>

      {notices.length > 0 && (
        <ul className="mb-3 rounded-lg border border-accent-amber/40 p-3 text-xs text-accent-amber list-disc list-inside" aria-label="Lineup notices">
          {notices.map((n) => <li key={n}>{n}</li>)}
        </ul>
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
                      onChange={(e) => patch(index, { status: e.target.checked ? 'cancelled' : 'announced' })}
                    />
                    Cancelled
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted whitespace-nowrap">{stateChip(entry, index)}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${label}`}
                      onClick={() => {
                        onChange(lineup.filter((_, i) => i !== index));
                        setUnsaved(true);
                      }}
                      className="px-2 py-1 rounded-lg bg-accent-coral/20 text-accent-coral text-xs"
                    >
                      Remove
                    </button>
                  </div>
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
              {merge.summary.removed} {merge.summary.removed === 1 ? 'entry is' : 'entries are'} not in this paste. Click again to remove {merge.summary.removed === 1 ? 'it' : 'them'}.
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
    </div>
  );
}
