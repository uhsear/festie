import React, { useRef, useState } from 'react';
import { lineupImportApi } from '@festie/shared/services/lineupImport';
import { matchArtists } from '@festie/shared/services';
import {
  LINEUP_IMPORT_FIELDS,
  LINEUP_IMPORT_LIMITS,
  LINEUP_SAMPLE_CSV,
  buildResultCsv,
  defaultMapping,
  defaultUpdateExisting,
  groupPlanRows,
  importBlocked,
  looksLikeHeader,
  mappingProblems,
  parseLineupTable,
  parseNameList,
  planSummary,
  toImportRows,
  withArtistChoice,
  updateOffBanner,
  type LineupColumnMapping,
  type LineupImportCommitResult,
  type LineupImportField,
  type LineupImportPlan,
  type LineupImportPlanRow,
  type LineupImportRow,
} from '@festie/shared/utils/lineupImport';
import type { TimeReleasePanelData } from '@festie/shared/utils/timeReleases';
import { useToast } from '../../lib/toastContext';
import ConfirmDialog from '../ui/ConfirmDialog';
import LineupImportHistory from './LineupImportHistory';
import SetTimeReleasePanel from './SetTimeReleasePanel';

interface LineupImportProps {
  festivalId: string;
  festivalName: string;
  onDone?: () => void;
}

type Step = 'source' | 'map' | 'preview' | 'result';

const TOO_BIG = 'This is larger than 200 KB. Split it and import it in parts.';

const primaryButton =
  'px-4 py-2 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 disabled:opacity-50 transition-opacity text-sm font-medium';
const secondaryButton =
  'px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary hover:bg-bg-primary/80 disabled:opacity-50 transition-colors text-sm font-medium';
const inputClass =
  'w-full px-2 py-1 rounded bg-bg-primary border border-glass-border text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-aqua';

const columnLetter = (index: number) => {
  let n = index;
  let letter = '';
  do {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letter;
};

const downloadText = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'festival';

/**
 * Lineup import wizard: source, column match, server-checked preview, result.
 * The server plans every check; the admin approves the plan, then commits the
 * same rows.
 */
export default function LineupImport({ festivalId, festivalName, onDone }: LineupImportProps) {
  const [step, setStep] = useState<Step>('source');
  const [text, setText] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [lines, setLines] = useState<number[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<LineupColumnMapping>({});
  const [rows, setRows] = useState<LineupImportRow[]>([]);
  const [plan, setPlan] = useState<LineupImportPlan | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [createMissing, setCreateMissing] = useState(true);
  const [moveDays, setMoveDays] = useState(false);
  const [listMode, setListMode] = useState(false);
  // Rows where the admin chose "Create new" over a "Did you mean" suggestion.
  const [keepNew, setKeepNew] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<LineupImportCommitResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  // Names in the preview that fit an artist Festie already has, and those that fit more than one.
  const [nameMatches, setNameMatches] = useState<{ matching: number; pick: string[] } | null>(null);
  const [releases, setReleases] = useState<TimeReleasePanelData | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Whether the last checked mapping had a set_id column. Update turns on by default only when that changes.
  const checkedWithSetId = useRef<boolean | null>(null);
  const { toast, toastError } = useToast();

  const checkSize = (value: string) => {
    if (new Blob([value]).size > LINEUP_IMPORT_LIMITS.maxBytes) {
      toast(TOO_BIG, 'error');
      return false;
    }
    return true;
  };

  const applyHeader = (header: boolean, data = table) => {
    setHasHeader(header);
    setMapping(defaultMapping(data, header));
  };

  const handleChooseFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > LINEUP_IMPORT_LIMITS.maxBytes) return toast(TOO_BIG, 'error');
    setText(await file.text());
  };

  const handleNext = () => {
    if (!text.trim()) return toast('Paste some lineup data first', 'error');
    if (!checkSize(text)) return;
    const parsed = parseLineupTable(text);
    if (parsed.rows.length === 0) return toast('No rows found in that data.', 'error');
    checkedWithSetId.current = null;
    setTable(parsed.rows);
    setLines(parsed.lines);
    applyHeader(looksLikeHeader(parsed.rows[0] ?? []), parsed.rows);
    setStep('map');
  };

  /** The import saves names only, so a name that fits two artists cannot be picked here: list it for the set editor. */
  const checkNames = async (checked: LineupImportPlan) => {
    const names = [...new Set(checked.rows.flatMap((r) => r.artists).map((n) => n.trim()).filter(Boolean))];
    setNameMatches(null);
    if (names.length === 0) return;
    try {
      const found = [];
      for (let i = 0; i < names.length; i += 500) found.push(...(await matchArtists(names.slice(i, i + 500).map((name) => ({ name })))));
      setNameMatches({
        matching: found.filter((f) => f.outcome !== 'new').length,
        pick: found.filter((f) => f.outcome === 'pick').map((f) => f.name),
      });
    } catch (err) {
      // The server still resolves the names when the import commits.
      console.warn('Could not match the imported names', err);
    }
  };

  const runPreview = async (nextRows: LineupImportRow[], update = updateExisting, create = createMissing, move = moveDays) => {
    if (nextRows.length === 0) {
      toast('No rows left to import.', 'error');
      setStep('source');
      return;
    }
    setLoading(true);
    try {
      const checked = await lineupImportApi.preview(festivalId, {
        rows: nextRows,
        updateExisting: update,
        createMissing: create,
        skipSpotify: false,
        ...(move ? { moveDays: true } : {}),
      });
      setPlan(checked);
      setStep('preview');
      void checkNames(checked);
    } catch (err: unknown) {
      toastError(err, "Couldn't check the rows. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCheckRows = () => {
    const nextRows = toImportRows(table, mapping, hasHeader, lines);
    const hasSetId = mapping.setId !== undefined;
    const update = checkedWithSetId.current === hasSetId ? updateExisting : defaultUpdateExisting(mapping);
    checkedWithSetId.current = hasSetId;
    setListMode(false);
    setRows(nextRows);
    setUpdateExisting(update);
    void runPreview(nextRows, update);
  };

  // A pasted list of names has no columns to match: each line becomes an announced name.
  const handleCheckList = () => {
    if (!text.trim()) return toast('Paste some lineup data first', 'error');
    if (!checkSize(text)) return;
    const nextRows = parseNameList(text);
    if (nextRows.length === 0) return toast('No names found in that data.', 'error');
    if (nextRows.length > LINEUP_IMPORT_LIMITS.maxRows) {
      return toast(`That list has ${nextRows.length} names. The limit is ${LINEUP_IMPORT_LIMITS.maxRows}. Split it and import it in parts.`, 'error');
    }
    checkedWithSetId.current = null;
    setListMode(true);
    setUpdateExisting(false);
    setRows(nextRows);
    void runPreview(nextRows, false);
  };

  const chooseArtist = (row: number, position: number, artistId: string) => {
    if (!artistId) return;
    const next = withArtistChoice(rows, row, position, artistId);
    setRows(next);
    void runPreview(next);
  };

  const applySuggestion = (row: number, suggestion: string) => {
    const next = rows.map((r) => (r.row === row ? { ...r, artist: suggestion } : r));
    setRows(next);
    void runPreview(next);
  };

  const turnOnUpdate = () => {
    setUpdateExisting(true);
    void runPreview(rows, true, createMissing);
  };

  const editCell = (row: number, field: LineupImportField, value: string) =>
    setRows((prev) => prev.map((r) => (r.row === row ? { ...r, [field]: value } : r)));

  const removeRow = (row: number) => {
    const next = rows.filter((r) => r.row !== row);
    setRows(next);
    void runPreview(next);
  };

  const handleCommit = async () => {
    setLoading(true);
    try {
      const res = await lineupImportApi.commit(festivalId, { rows, updateExisting, createMissing, skipSpotify: false, ...(moveDays ? { moveDays: true } : {}) });
      setConfirmOpen(false);
      if (res.committed) {
        setResult(res.result);
        setStep('result');
        setHistoryKey((k) => k + 1);
      } else {
        setPlan(res.plan);
        setStep('preview');
        toast('The lineup changed since your preview. Check the rows again.', 'error');
      }
    } catch (err: unknown) {
      setConfirmOpen(false);
      toastError(err, "Couldn't import the lineup. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      downloadText(`${slug(festivalName)}-lineup.csv`, await lineupImportApi.exportCsv(festivalId));
    } catch (err: unknown) {
      toastError(err, "Couldn't export the lineup. Try again.");
    }
  };

  const reset = () => {
    setText('');
    setTable([]);
    setLines([]);
    setRows([]);
    setPlan(null);
    setResult(null);
    setListMode(false);
    setKeepNew(new Set());
    setStep('source');
  };

  const renderSource = () => (
    <div className="space-y-4">
      <label className="block text-sm text-text-primary">
        Paste cells from Google Sheets or Excel, or paste CSV
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="mt-2 w-full px-4 py-3 rounded-lg bg-bg-primary border border-glass-border text-text-primary placeholder-text-muted font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          className="hidden"
          aria-label="Lineup file"
          onChange={(e) => {
            void handleChooseFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button type="button" className={secondaryButton} onClick={() => fileInput.current?.click()}>
          Choose file
        </button>
        <button
          type="button"
          className="text-sm text-accent-aqua underline"
          onClick={() => downloadText('festie-lineup-sample.csv', LINEUP_SAMPLE_CSV)}
        >
          Download sample CSV
        </button>
        <button type="button" className="text-sm text-accent-aqua underline" onClick={() => void handleExport()}>
          Export lineup CSV
        </button>
        <span className="text-sm text-text-muted">Up to 500 rows and 200 KB.</span>
      </div>
      <ul className="bg-bg-card/60 border border-glass-border rounded-lg p-4 text-sm text-text-muted space-y-1 list-disc list-inside">
        <li>Export, fill in stages and times in a sheet, then import. The preview shows every change before you save.</li>
        <li>The export also lists announced acts that have no set yet, with no stage or times. Fill those in, or delete rows you are not ready to place. A new set keeps the act&apos;s poster name.</li>
        <li>A column you don&apos;t map is left alone. An empty cell in a mapped column clears that value, so an empty time becomes TBA.</li>
        <li>Imports never delete sets.</li>
        <li>Sets that start after midnight and before 6 AM belong to the night before. Put a 1 AM Saturday set on Friday.</li>
        <li>Write a B2B set as &apos;Kai b2b Mira&apos;. Each artist gets their own link.</li>
        <li>
          No day, stage or time? Those rows join the announced lineup. Paste one name per line and choose
          &quot;Check as a list of names&quot;.
        </li>
      </ul>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={primaryButton} onClick={handleNext}>
          Next: match columns
        </button>
        <button type="button" className={secondaryButton} onClick={handleCheckList}>
          Check as a list of names
        </button>
      </div>
    </div>
  );

  const renderMap = () => {
    const header = hasHeader ? (table[0] ?? []) : [];
    const sample = table[hasHeader ? 1 : 0] ?? [];
    const width = Math.max(0, ...table.map((r) => r.length));
    const problems = mappingProblems(mapping);
    return (
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={hasHeader} onChange={(e) => applyHeader(e.target.checked)} />
          First row is a header
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {LINEUP_IMPORT_FIELDS.map(({ field, label, required }) => (
            <label key={field} className="block text-sm text-text-primary">
              {label}
              {required ? ' (required)' : ''}
              <select
                className={`${inputClass} mt-1`}
                value={mapping[field] ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setMapping((prev) => {
                    const next = { ...prev };
                    if (value === '') delete next[field];
                    else next[field] = Number(value);
                    return next;
                  });
                }}
              >
                <option value="">Don&apos;t import</option>
                {Array.from({ length: width }, (_, i) => (
                  <option key={i} value={i}>
                    {`Column ${columnLetter(i)}${header[i] ? `: ${header[i]}` : ''}${sample[i] ? ` (e.g. ${sample[i]})` : ''}`}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {problems.length > 0 && (
          <ul className="text-sm text-accent-coral list-disc list-inside">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <button type="button" className={secondaryButton} onClick={() => setStep('source')}>
            Back
          </button>
          <button type="button" className={primaryButton} disabled={loading || problems.length > 0} onClick={handleCheckRows}>
            Check rows
          </button>
        </div>
      </div>
    );
  };

  // The Warnings group repeats rows from the outcome groups, so it shows the warnings only and no controls.
  const renderWarnings = (r: LineupImportPlanRow) => (
    <>
      {r.warnings.map((w) => (
        <p key={w} className="text-text-muted">{w}</p>
      ))}
    </>
  );

  const renderNotes = (r: LineupImportPlanRow, source: LineupImportRow | undefined) => (
    <>
      {r.changes.map((c) => (
        <p key={c}>{c}</p>
      ))}
      {r.displayName && <p className="text-text-muted">Poster name kept: {r.displayName}</p>}
      {r.warnings.map((w) => (
        <p key={w} className="text-text-muted">{w}</p>
      ))}
      {r.errors.map((e) =>
        e.code === 'needs_choice' ? (
          <p key={`${e.field}-${e.message}`} className="text-accent-coral">{e.message}</p>
        ) : (
          <div key={`${e.field}-${e.message}`} className="space-y-1">
            <p className="text-accent-coral">{e.message}</p>
            {e.field !== 'row' && source && (
              <input
                className={inputClass}
                aria-label={`Row ${r.row} ${e.field}`}
                list={e.field === 'day' ? 'lineup-import-days' : e.field === 'stage' ? 'lineup-import-stages' : undefined}
                value={source[e.field] ?? ''}
                onChange={(ev) => editCell(r.row, e.field as LineupImportField, ev.target.value)}
              />
            )}
          </div>
        ),
      )}
      {(r.resolutions ?? []).map((x, i) =>
        x.outcome === 'needs_choice' ? (
          <label key={`${x.name}-${i}`} className="block text-sm text-text-primary">
            {`Which ${x.name}?`}
            <select
              className={`${inputClass} mt-1`}
              aria-label={`Row ${r.row} artist ${x.name}`}
              value=""
              disabled={loading}
              onChange={(ev) => chooseArtist(r.row, i, ev.target.value)}
            >
              <option value="">Choose an artist</option>
              {(x.candidates ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {`${x.name} (${c.label || 'no note'})${c.hint ? ` ${c.hint}` : ''}`}
                </option>
              ))}
            </select>
          </label>
        ) : x.outcome === 'did_you_mean' && x.suggestion && !keepNew.has(r.row) ? (
          <div key={`${x.name}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" className="text-accent-aqua underline" onClick={() => applySuggestion(r.row, x.suggestion!)}>
              {`Use ${x.suggestion}`}
            </button>
            <button
              type="button"
              className="text-text-muted underline"
              onClick={() => setKeepNew((prev) => new Set(prev).add(r.row))}
            >
              Create new
            </button>
          </div>
        ) : null,
      )}
      {r.status === 'error' && (
        <button type="button" className="text-xs text-accent-coral underline" onClick={() => removeRow(r.row)}>
          Remove row
        </button>
      )}
    </>
  );

  const renderPreview = (p: LineupImportPlan) => {
    const blocked = importBlocked(p);
    const groups = groupPlanRows(p);
    const updateBanner = updateOffBanner(p.counts, updateExisting);
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <span key={g.key} className="px-3 py-1 rounded-full bg-bg-card border border-glass-border text-sm text-text-primary">
              {g.label} {g.rows.length}
            </span>
          ))}
        </div>
        {nameMatches && nameMatches.matching > 0 && (
          <div role="status" className="space-y-1 text-sm text-text-primary">
            <p>
              {nameMatches.matching} {nameMatches.matching === 1 ? 'name matches an artist' : 'names match artists'} already in Festie.
            </p>
            {nameMatches.pick.length > 0 && (
              <p className="text-accent-amber">
                {nameMatches.pick.join(', ')}: more than one artist has {nameMatches.pick.length === 1 ? 'this name' : 'these names'}. Choose{' '}
                {nameMatches.pick.length === 1 ? 'it' : 'each'} in the rows below.
              </p>
            )}
          </div>
        )}
        {p.newStages.length > 0 && (
          <p className="text-sm text-text-muted">New stages: {p.newStages.map((s) => s.name).join(', ')}</p>
        )}
        {p.newDays.length > 0 && (
          <p className="text-sm text-text-muted">
            New days: {p.newDays.map((d) => `${d.label} (${d.date})`).join(', ')}
          </p>
        )}
        {updateBanner && (
          <div role="status" className="flex flex-wrap items-center gap-3 bg-accent-aqua/10 border border-accent-aqua/30 rounded-lg p-3 text-sm text-text-primary">
            <span>{updateBanner}</span>
            <button type="button" className={secondaryButton} disabled={loading} onClick={turnOnUpdate}>
              Turn on Update
            </button>
          </div>
        )}
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={updateExisting}
              disabled={loading}
              onChange={(e) => {
                setUpdateExisting(e.target.checked);
                void runPreview(rows, e.target.checked, createMissing);
              }}
            />
            Update sets that match
          </label>
          <p className="text-xs text-text-muted">
            Sets match by artist and day. When this is off, matching sets stay as they are.
          </p>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={createMissing}
              disabled={loading}
              onChange={(e) => {
                setCreateMissing(e.target.checked);
                void runPreview(rows, updateExisting, e.target.checked);
              }}
            />
            Create new stages and days
          </label>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={moveDays}
              disabled={loading}
              onChange={(e) => {
                setMoveDays(e.target.checked);
                void runPreview(rows, updateExisting, createMissing, e.target.checked);
              }}
            />
            Move sets to the day in the file
          </label>
          <p className="text-xs text-text-muted">
            For rows with a set id. When this is off, a row with another day is skipped and the other rows still import.
          </p>
        </div>
        {p.problems.length > 0 && (
          <div role="alert" className="bg-accent-coral/20 border border-accent-coral/30 rounded-lg p-4">
            <ul className="space-y-1 text-sm text-accent-coral">
              {p.problems.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        <datalist id="lineup-import-days">
          {p.days.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        <datalist id="lineup-import-stages">
          {p.stages.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <div className="bg-bg-card/60 border border-glass-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Lineup import preview</caption>
            <thead>
              <tr className="border-b border-glass-border">
                {['Row', 'Status', 'Artists', 'Day', 'Stage', 'Start', 'End', 'Notes'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-text-muted font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            {groups
              .filter((g) => g.rows.length > 0)
              .map((g) => (
                <tbody key={g.key} className="divide-y divide-glass-border">
                  <tr className="bg-bg-primary/60">
                    <th colSpan={8} scope="colgroup" className="px-3 py-2 text-left text-text-primary font-medium">
                      {g.label} ({g.rows.length})
                    </th>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={`${g.key}-${r.row}`} className={r.status === 'error' ? 'bg-accent-coral/10 align-top' : 'align-top'}>
                      <td className="px-3 py-2">{r.row}</td>
                      <td className="px-3 py-2">{r.status}</td>
                      <td className="px-3 py-2">{r.artists.join(' b2b ') || '—'}</td>
                      <td className="px-3 py-2">{r.dayLabel ?? (r.target === 'announced' ? 'Announced' : '—')}</td>
                      <td className="px-3 py-2">{r.stageName ?? '—'}</td>
                      <td className="px-3 py-2">{r.target === 'announced' ? '—' : (r.startTime ?? 'TBA')}</td>
                      <td className="px-3 py-2">{r.target === 'announced' ? '—' : (r.endTime ?? 'TBA')}</td>
                      <td className="px-3 py-2 space-y-1">{g.key === 'warnings' ? renderWarnings(r) : renderNotes(r, rows.find((x) => x.row === r.row))}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
          </table>
        </div>
        {p.counts.error > 0 && (
          <button type="button" className={secondaryButton} disabled={loading} onClick={() => void runPreview(rows)}>
            Check again
          </button>
        )}
        {(p.unmatchedActs ?? []).length > 0 && (
          <details open={(p.unmatchedActs ?? []).length <= 5} className="text-sm text-accent-amber rounded-lg border border-accent-amber/40 p-3">
            <summary>
              {(p.unmatchedActs ?? []).length} announced {(p.unmatchedActs ?? []).length === 1 ? 'act matches' : 'acts match'} no set on the
              days this import fills. Fix the spelling in your file, or link the set by hand with Matches set… after the import.
            </summary>
            <ul className="mt-2 space-y-1">
              {(p.unmatchedActs ?? []).map((a) => (
                <li key={a.entryId}>
                  {a.name} ({a.dayLabel})
                </li>
              ))}
            </ul>
          </details>
        )}
        {p.missingFromFile.length > 0 && (
          <details className="text-sm text-text-muted">
            <summary>
              {p.missingFromFile.length} sets in this festival are not in your file. They stay as they are.
            </summary>
            <ul className="mt-2 space-y-1">
              {p.missingFromFile.map((m) => (
                <li key={m.setId}>
                  {m.artist} ({m.dayLabel})
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="flex items-center gap-3">
          <button type="button" className={secondaryButton} onClick={() => setStep(listMode ? 'source' : 'map')}>
            Back
          </button>
          <button type="button" className={primaryButton} disabled={loading || blocked} onClick={() => setConfirmOpen(true)}>
            Approve
          </button>
          {blocked && p.counts.error > 0 && (
            <span className="text-sm text-accent-coral">
              Fix or remove the {p.counts.error} {p.counts.error === 1 ? 'row' : 'rows'} with errors to continue.
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderResult = (r: LineupImportCommitResult) => (
    <div className="space-y-4">
      <p role="status" className="bg-accent-aqua/10 border border-accent-aqua/30 rounded-lg p-4 text-sm text-text-primary">
        Import done. Added {r.created} sets, updated {r.updated}, created {r.newStages} stages and {r.newDays} days.
        {r.announced || r.announcedUpdated
          ? ` Announced lineup: ${r.announced ?? 0} added, ${r.announcedUpdated ?? 0} updated.`
          : ''}
        {r.skipped > 0 && ` Skipped ${r.skipped} ${r.skipped === 1 ? 'row' : 'rows'} that name another day.`}
      </p>
      {r.rows.some((x) => x.status === 'skipped') && (
        <section aria-label="Skipped rows" className="space-y-1">
          <h3 className="text-sm font-medium text-text-primary">Skipped rows</h3>
          <ul className="text-sm text-text-muted space-y-1">
            {r.rows
              .filter((x) => x.status === 'skipped')
              .map((x) => (
                <li key={x.row}>{`Row ${x.row}, ${x.artist}: ${x.message}`}</li>
              ))}
          </ul>
        </section>
      )}
      {r.warnings.length > 0 && (
        <ul className="text-sm text-text-muted space-y-1">
          {r.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondaryButton}
          onClick={() => downloadText(`${slug(festivalName)}-import-${new Date().toISOString().slice(0, 10)}.csv`, buildResultCsv(r))}
        >
          Download result CSV
        </button>
        <button type="button" className={secondaryButton} onClick={reset}>
          Import another file
        </button>
        <button type="button" className={primaryButton} onClick={() => onDone?.()}>
          Done
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h2 className="type-heading text-text-primary">Import lineup into {festivalName}</h2>
        {step === 'source' && renderSource()}
        {step === 'map' && renderMap()}
        {step === 'preview' && plan && renderPreview(plan)}
        {step === 'result' && result && renderResult(result)}
      </div>
      <SetTimeReleasePanel festivalId={festivalId} refreshKey={historyKey} onLoaded={setReleases} />
      <LineupImportHistory festivalId={festivalId} festivalName={festivalName} refreshKey={historyKey} releases={releases} />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Approve import?"
        description={`${plan ? planSummary(plan.counts, updateExisting) : ''} You can undo this import from Import history.`}
        confirmLabel="Import"
        busy={loading}
        onConfirm={handleCommit}
      />
    </div>
  );
}
