import type { Dispatch, SetStateAction } from 'react';
import {
  LINEUP_IMPORT_FIELDS,
  mappingProblems,
  type LineupColumnMapping,
} from '@festie/shared/utils/lineupImport';
import { inputClass, primaryButton, secondaryButton } from './lineupImportShared';

interface LineupImportMapProps {
  table: string[][];
  hasHeader: boolean;
  mapping: LineupColumnMapping;
  loading: boolean;
  onHeaderChange: (header: boolean) => void;
  onMappingChange: Dispatch<SetStateAction<LineupColumnMapping>>;
  onBack: () => void;
  onCheck: () => void;
}

const columnLetter = (index: number) => {
  let n = index;
  let letter = '';
  do {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letter;
};

export default function LineupImportMap({
  table,
  hasHeader,
  mapping,
  loading,
  onHeaderChange,
  onMappingChange,
  onBack,
  onCheck,
}: LineupImportMapProps) {
  const header = hasHeader ? (table[0] ?? []) : [];
  const sample = table[hasHeader ? 1 : 0] ?? [];
  const width = Math.max(0, ...table.map((r) => r.length));
  const problems = mappingProblems(mapping);
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-text-primary">
        <input type="checkbox" checked={hasHeader} onChange={(e) => onHeaderChange(e.target.checked)} />
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
                onMappingChange((prev) => {
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
        <ul className="text-sm text-text-danger list-disc list-inside">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="button" className={secondaryButton} onClick={onBack}>
          Back
        </button>
        <button type="button" className={primaryButton} disabled={loading || problems.length > 0} onClick={onCheck}>
          Check rows
        </button>
      </div>
    </div>
  );
}
