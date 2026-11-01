import React, { useState } from 'react';
import {
  commitLineupImport,
  formatImportCounts,
  previewLineupImport,
  type LineupImportResult,
} from '@festie/shared/services/admin';
import { ApiClientError } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';

interface LineupImportProps {
  festivalId: string;
  onSuccess?: () => void;
}

/**
 * CSV/TSV lineup import: the server dry-runs the paste, the admin reviews each
 * row's stage, day and status, then commits the same text.
 */
export default function LineupImport({ festivalId, onSuccess }: LineupImportProps) {
  const [importText, setImportText] = useState('');
  const [preview, setPreview] = useState<LineupImportResult | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast, toastError } = useToast();

  const hasErrors = !!preview && (preview.counts.error > 0 || preview.errors.length > 0);

  const handleParse = async (nextUpdateExisting = updateExisting) => {
    if (!importText.trim()) {
      toast('Paste some lineup data first', 'error');
      return;
    }
    try {
      setLoading(true);
      setPreview(await previewLineupImport(festivalId, importText, { updateExisting: nextUpdateExisting }));
    } catch (err: unknown) {
      setPreview(null);
      toastError(err, "Couldn't preview the lineup. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!preview || hasErrors) return;
    try {
      setLoading(true);
      const result = await commitLineupImport(festivalId, importText, { updateExisting });
      toast(`Imported ${result.imported} new sets and updated ${result.updated}.`, 'success');
      setImportText('');
      setPreview(null);
      onSuccess?.();
    } catch (err: unknown) {
      const rejected = err instanceof ApiClientError ? (err.details?.preview as LineupImportResult | undefined) : undefined;
      if (rejected) setPreview(rejected);
      toastError(err, "Couldn't import the lineup. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="type-heading text-text-primary mb-3">Import Lineup from CSV/TSV</h2>

        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 mb-4">
          <p className="text-sm text-text-muted">
            Columns:{' '}
            <code className="bg-bg-primary/50 px-1.5 py-0.5 rounded text-xs">artist, stage, day, start, end, link</code>{' '}
            (header optional; day can be a label, a date or a number)
          </p>
        </div>

        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="Paste CSV or TSV data here…"
          rows={8}
          className="w-full px-4 py-3 rounded-lg bg-bg-primary border border-glass-border text-text-primary placeholder-text-muted font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        />

        <button
          onClick={() => void handleParse()}
          disabled={loading}
          className="mt-3 px-4 py-2 rounded-lg bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 disabled:opacity-50 transition-colors text-sm font-medium"
        >
          Preview
        </button>
      </div>

      {preview && preview.errors.length > 0 && (
        <div className="bg-accent-coral/20 border border-accent-coral/30 rounded-lg p-4">
          <h4 className="font-semibold text-accent-coral mb-2">Issues Found</h4>
          <ul className="space-y-1">
            {preview.errors.map((error, i) => (
              <li key={i} className="text-sm text-accent-coral">
                • {error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && preview.missing.length > 0 && (
        <p className="text-sm text-text-muted">
          {preview.missing.length} sets in this festival are not in your file. Import never deletes sets. Remove them
          in the editor if you need to.
        </p>
      )}

      {preview && (
        <div>
          <h4 className="font-semibold text-text-primary mb-3">{formatImportCounts(preview.counts)}</h4>
          <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Lineup import preview</caption>
                <thead>
                  <tr className="border-b border-glass-border">
                    {['Line', 'Artist', 'Stage', 'Day', 'Start', 'End', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-text-muted font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-glass-border">
                  {preview.rows.map((row) => {
                    const isError = row.status === 'error';
                    return (
                      <tr
                        key={row.line}
                        className={
                          isError ? 'bg-accent-coral/20 text-accent-coral' : 'hover:bg-bg-primary/20 transition-colors'
                        }
                      >
                        <td className="px-4 py-2">{row.line}</td>
                        <td className="px-4 py-2">{row.artist}</td>
                        <td className="px-4 py-2">{row.stageName ?? '—'}</td>
                        <td className="px-4 py-2">{row.dayLabel ?? '—'}</td>
                        <td className="px-4 py-2 text-xs">{row.startTime || '—'}</td>
                        <td className="px-4 py-2 text-xs">{row.endTime || '—'}</td>
                        <td className="px-4 py-2">
                          {row.status}
                          {isError && row.message ? `: ${row.message}` : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <label className="flex items-center gap-2 mt-4 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={updateExisting}
              disabled={loading}
              onChange={(e) => {
                // The row statuses depend on this flag, so preview again with the new value.
                setUpdateExisting(e.target.checked);
                void handleParse(e.target.checked);
              }}
            />
            Update sets that match (keeps everyone&apos;s picks)
          </label>

          <div className="flex items-center gap-2 justify-end mt-4">
            {hasErrors && (
              <span className="text-sm text-accent-coral">Fix the rows marked in red, then preview again.</span>
            )}
            <button
              onClick={() => {
                setImportText('');
                setPreview(null);
              }}
              className="px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary hover:bg-bg-primary/80 transition-colors text-sm font-medium"
            >
              Clear
            </button>
            <button
              onClick={handleImport}
              disabled={loading || hasErrors}
              className="px-4 py-2 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 disabled:opacity-50 transition-opacity text-sm font-medium inline-flex items-center gap-2"
            >
              {loading && (
                <span
                  aria-hidden="true"
                  className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"
                />
              )}
              {`Import ${preview.counts.new} new${updateExisting ? `, update ${preview.counts.update}` : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
