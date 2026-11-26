import { useRef } from 'react';
import { LINEUP_SAMPLE_CSV } from '@festie/shared/utils/lineupImport';
import { downloadText, primaryButton, secondaryButton } from './lineupImportShared';

interface LineupImportSourceProps {
  text: string;
  onTextChange: (value: string) => void;
  onChooseFile: (file: File | undefined) => void;
  onExport: () => void;
  onNext: () => void;
  onCheckList: () => void;
  /** An organizer reads the plain-language wording (plan-v3 5.8). */
  organizer?: boolean;
}

export default function LineupImportSource({
  text,
  onTextChange,
  onChooseFile,
  onExport,
  onNext,
  onCheckList,
  organizer = false,
}: LineupImportSourceProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
  <div className="space-y-4">
    <label className="block text-sm text-text-primary">
      {organizer ? 'Upload your spreadsheet, or paste a list of names, one per line.' : 'Paste cells from Google Sheets or Excel, or paste CSV'}
      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={8}
        className="mt-2 w-full px-4 py-3 rounded-xl bg-bg-primary border border-glass-border text-text-primary placeholder-text-muted font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent-aqua"
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
          onChooseFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <button type="button" className={secondaryButton} onClick={() => fileInput.current?.click()}>
        Choose file
      </button>
      <button
        type="button"
        className="min-h-11 text-sm text-accent-aqua underline"
        onClick={() => downloadText('festie-lineup-sample.csv', LINEUP_SAMPLE_CSV)}
      >
        Download sample CSV
      </button>
      <button type="button" className="min-h-11 text-sm text-accent-aqua underline" onClick={onExport}>
        Export lineup CSV
      </button>
      <span className="text-sm text-text-muted">Up to 500 rows and 200 KB.</span>
    </div>
    <ul className="bg-bg-card/60 border border-glass-border rounded-xl p-4 text-sm text-text-muted space-y-1 list-disc list-inside">
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
      <button type="button" className={primaryButton} onClick={onNext}>
        Next: match columns
      </button>
      <button type="button" className={secondaryButton} onClick={onCheckList}>
        Check as a list of names
      </button>
    </div>
  </div>
  );
}
