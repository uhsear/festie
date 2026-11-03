import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAdminPickInsight } from '@festie/shared/services/admin';
import { pickClashRows, picksCsvFileName, picksPerSetCsv } from '@festie/shared/utils';
import { ADMIN_QUERY_OPTIONS, adminKeys } from './adminQueries';

const EXPORT_HINT_ID = 'pick-insight-export-hint';

function downloadCsv(csv: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Overlapping sets that many people picked, plus a counts-only CSV of picks per set. */
export default function FestivalPickInsight({ festivalId }: { festivalId: string }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: adminKeys.pickInsight(festivalId),
    queryFn: () => fetchAdminPickInsight(festivalId),
    ...ADMIN_QUERY_OPTIONS,
  });

  const rows = data ? pickClashRows(data) : [];

  return (
    <div>
      <h2 className="type-heading text-text-primary mb-1">Clashing picks</h2>
      <p className="text-xs text-text-muted mb-4">
        Sets that overlap in time, ranked by how many people picked both. Pairs picked by fewer than{' '}
        {data?.minPairPeople ?? 5} people are hidden.
      </p>
      {isPending && <p className="text-sm text-text-muted">Loading…</p>}
      {isError && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-text-muted">Couldn't load clashing picks.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="px-4 py-2 min-h-11 rounded-lg bg-bg-card border border-glass-border text-text-primary hover:bg-bg-card/80 transition-colors text-sm font-medium focus-visible:ring-2 focus-visible:ring-accent-aqua"
          >
            Retry
          </button>
        </div>
      )}
      {data && (
        <>
          {rows.length === 0 ? (
            <p className="text-sm text-text-muted">
              No clash was picked by {data.minPairPeople} or more people yet.
            </p>
          ) : (
            <ul className="list-none bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 space-y-3">
              {rows.map((row) => (
                <li key={row.key} aria-label={row.a11y}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 mb-1">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary break-words">{row.title}</div>
                      <div className="text-xs text-text-muted break-words">{row.detail}</div>
                    </div>
                    <div className="text-sm font-medium text-text-muted">{row.peopleText}</div>
                  </div>
                  <div aria-hidden="true" className="h-2 rounded-full bg-bg-primary/30 overflow-hidden">
                    <div
                      style={{ transform: `scaleX(${row.barPct / 100})` }}
                      className="h-full w-full origin-left bg-accent-aqua transition-transform duration-[var(--duration-med)] ease-[var(--ease-out)] motion-reduce:transition-none"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="mt-4">
        <button
          type="button"
          disabled={!data}
          aria-describedby={EXPORT_HINT_ID}
          onClick={() => data && downloadCsv(picksPerSetCsv(data), picksCsvFileName(festivalId))}
          className="px-4 py-2 min-h-11 rounded-lg bg-bg-card border border-glass-border text-text-primary hover:bg-bg-card/80 disabled:opacity-50 transition-colors text-sm font-medium focus-visible:ring-2 focus-visible:ring-accent-aqua"
        >
          Export picks per set
        </button>
        <p id={EXPORT_HINT_ID} className="text-xs text-text-muted mt-1">
          One row per set, with counts only. No names or user IDs.
        </p>
      </div>
    </div>
  );
}
