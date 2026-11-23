import { pluralize } from '@festie/shared/utils/format';
import { buildResultCsv, type LineupImportCommitResult } from '@festie/shared/utils/lineupImport';
import { downloadText, primaryButton, secondaryButton, slug } from './lineupImportShared';

interface LineupImportResultProps {
  result: LineupImportCommitResult;
  festivalName: string;
  onReset: () => void;
  onDone?: () => void;
}

export default function LineupImportResult({ result: r, festivalName, onReset, onDone }: LineupImportResultProps) {
  return (
  <div className="space-y-4">
    <p role="status" className="bg-accent-aqua/10 border border-accent-aqua/30 rounded-lg p-4 text-sm text-text-primary">
      Import done. Added {pluralize(r.created, 'set')}, updated {r.updated}, created {pluralize(r.newStages, 'stage')} and {pluralize(r.newDays, 'day')}.
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
      <button type="button" className={secondaryButton} onClick={onReset}>
        Import another file
      </button>
      <button type="button" className={primaryButton} onClick={() => onDone?.()}>
        Done
      </button>
    </div>
  </div>
  );
}
