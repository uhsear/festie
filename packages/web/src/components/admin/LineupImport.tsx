import React, { useRef, useState } from 'react';
import { lineupImportApi } from '@festie/shared/services/lineupImport';
import {
  LINEUP_IMPORT_FIELDS,
  LINEUP_IMPORT_LIMITS,
  LINEUP_SAMPLE_CSV,
  buildResultCsv,
  defaultMapping,
  looksLikeHeader,
  mappingProblems,
  parseLineupTable,
  planSummary,
  toImportRows,
  type LineupColumnMapping,
  type LineupImportCommitResult,
  type LineupImportField,
  type LineupImportPlan,
  type LineupImportRow,
} from '@festie/shared/utils/lineupImport';
import { useToast } from '../../lib/toastContext';
import ConfirmDialog from '../ui/ConfirmDialog';
import LineupImportHistory from './LineupImportHistory';

interface LineupImportProps {
  festivalId: string;
  festivalName: string;
  onDone?: () => void;
}

type Step = 'source' | 'map' | 'preview' | 'result';
type RowFilter = 'all' | 'error' | 'new' | 'changed';

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
  const [filter, setFilter] = useState<RowFilter>('all');
  const [result, setResult] = useState<LineupImportCommitResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
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
    setTable(parsed.rows);
    setLines(parsed.lines);
    applyHeader(looksLikeHeader(parsed.rows[0] ?? []), parsed.rows);
    setStep('map');
  };

  const runPreview = async (nextRows: LineupImportRow[], update = updateExisting, create = createMissing) => {
    if (nextRows.length === 0) {
      toast('No rows left to import.', 'error');
      setStep('source');
      return;
    }
    setLoading(true);
    try {
      setPlan(await lineupImportApi.preview(festivalId, { rows: nextRows, updateExisting: update, createMissing: create, skipSpotify: false }));
      setStep('preview');
    } catch (err: unknown) {
      toastError(err, "Couldn't check the rows. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCheckRows = () => {
    const nextRows = toImportRows(table, mapping, hasHeader, lines);
    setRows(nextRows);
    void runPreview(nextRows);
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
      const res = await lineupImportApi.commit(festivalId, { rows, updateExisting, createMissing, skipSpotify: false });
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
        <li>A column you don&apos;t map is left alone. An empty cell in a mapped column clears that value, so an empty time becomes TBA.</li>
        <li>Imports never delete sets.</li>
        <li>Sets that start after midnight and before 6 AM belong to the night before. Put a 1 AM Saturday set on Friday.</li>
        <li>Write a B2B set as &apos;Kai b2b Mira&apos;. Each artist gets their own link.</li>
      </ul>
      <button type="button" className={primaryButton} onClick={handleNext}>
        Next: match columns
      </button>
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

  const renderPreview = (p: LineupImportPlan) => {
    const blocked = p.counts.error > 0 || p.problems.length > 0;
    const shown = p.rows.filter((r) => filter === 'all' || r.status === filter);
    const chips: [string, number][] = [
      ['New', p.counts.new],
      ['Will change', p.counts.changed],
      ['Unchanged', p.counts.unchanged],
      ['Errors', p.counts.error],
    ];
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {chips.map(([label, n]) => (
            <span key={label} className="px-3 py-1 rounded-full bg-bg-card border border-glass-border text-sm text-text-primary">
              {label} {n}
            </span>
          ))}
        </div>
        {p.newStages.length > 0 && (
          <p className="text-sm text-text-muted">New stages: {p.newStages.map((s) => s.name).join(', ')}</p>
        )}
        {p.newDays.length > 0 && (
          <p className="text-sm text-text-muted">
            New days: {p.newDays.map((d) => `${d.label} (${d.date})`).join(', ')}
          </p>
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
        <label className="flex items-center gap-2 text-sm text-text-primary">
          Filter rows
          <select className={`${inputClass} w-auto`} value={filter} onChange={(e) => setFilter(e.target.value as RowFilter)}>
            <option value="all">All</option>
            <option value="error">Errors</option>
            <option value="new">New</option>
            <option value="changed">Changes</option>
          </select>
        </label>
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
            <tbody className="divide-y divide-glass-border">
              {shown.map((r) => {
                const source = rows.find((x) => x.row === r.row);
                const isError = r.status === 'error';
                return (
                  <tr key={r.row} className={isError ? 'bg-accent-coral/10 align-top' : 'align-top'}>
                    <td className="px-3 py-2">{r.row}</td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2">{r.artists.join(' b2b ') || '—'}</td>
                    <td className="px-3 py-2">{r.dayLabel ?? '—'}</td>
                    <td className="px-3 py-2">{r.stageName ?? '—'}</td>
                    <td className="px-3 py-2">{r.startTime ?? 'TBA'}</td>
                    <td className="px-3 py-2">{r.endTime ?? 'TBA'}</td>
                    <td className="px-3 py-2 space-y-1">
                      {r.changes.map((c) => (
                        <p key={c}>{c}</p>
                      ))}
                      {r.warnings.map((w) => (
                        <p key={w} className="text-text-muted">{w}</p>
                      ))}
                      {r.errors.map((e) => (
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
                      ))}
                      {isError && (
                        <button type="button" className="text-xs text-accent-coral underline" onClick={() => removeRow(r.row)}>
                          Remove row
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {p.counts.error > 0 && (
          <button type="button" className={secondaryButton} disabled={loading} onClick={() => void runPreview(rows)}>
            Check again
          </button>
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
          <button type="button" className={secondaryButton} onClick={() => setStep('map')}>
            Back
          </button>
          <button type="button" className={primaryButton} disabled={loading || blocked} onClick={() => setConfirmOpen(true)}>
            Approve
          </button>
          {blocked && p.counts.error > 0 && (
            <span className="text-sm text-accent-coral">
              Fix or remove the {p.counts.error} rows with errors to continue.
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
        Spotify linked {r.spotifyMatched} artists.
      </p>
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
      <LineupImportHistory festivalId={festivalId} festivalName={festivalName} refreshKey={historyKey} />
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
