import type { NoteSaveStatus } from '@festie/shared/hooks';
import { QUEUED_WRITE_MESSAGE } from '@festie/shared/utils';

interface Props {
  personalNote: string;
  crewNote: string;
  onPersonalChange: (value: string) => void;
  onCrewChange: (value: string) => void;
  personalStatus?: NoteSaveStatus;
  crewStatus?: NoteSaveStatus;
  onRetryPersonal?: () => void;
  onRetryCrew?: () => void;
}

function NoteStatusLine({ status, onRetry }: { status: NoteSaveStatus; onRetry?: () => void }) {
  const failed = status === 'failed';
  return (
    <div role="status" aria-live="polite" className={failed ? 'text-xs mt-1 text-accent-amber' : 'text-xs mt-1 text-text-muted'}>
      {status === 'saving' && 'Saving…'}
      {status === 'saved' && 'Saved'}
      {status === 'queued' && QUEUED_WRITE_MESSAGE}
      {failed && (
        <>
          Not saved.{' '}
          <button
            type="button"
            className="min-h-[44px] px-2 underline cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua"
            onClick={onRetry}
          >
            Retry
          </button>
        </>
      )}
    </div>
  );
}

export default function DetailNotesSection({
  personalNote,
  crewNote,
  onPersonalChange,
  onCrewChange,
  personalStatus = 'idle',
  crewStatus = 'idle',
  onRetryPersonal,
  onRetryCrew,
}: Props) {
  return (
    <div>
      <div className="text-xs font-bold text-text-secondary mb-2.5 uppercase tracking-[1px]" id="notes-label">
        Personal Notes
      </div>
      <textarea
        placeholder='Add notes (e.g., "meet at the rail")…'
        aria-labelledby="notes-label"
        className="w-full min-h-[80px] resize-y text-sm p-3 rounded-sm bg-bg-input border border-border-light text-text-primary"
        value={personalNote}
        onChange={(e) => onPersonalChange(e.target.value)}
      />
      <NoteStatusLine status={personalStatus} onRetry={onRetryPersonal} />

      <div className="mt-2">
        <div className="text-xs font-bold text-accent-aqua mb-2.5 uppercase tracking-[1px]" id="crew-notes-label">
          Crew Note (visible to your crew)
        </div>
        <textarea
          placeholder="Share a note with your crew…"
          aria-labelledby="crew-notes-label"
          className="w-full min-h-[80px] resize-y text-sm p-3 rounded-sm bg-bg-input border border-accent-aqua text-text-primary"
          value={crewNote}
          onChange={(e) => onCrewChange(e.target.value)}
        />
        <NoteStatusLine status={crewStatus} onRetry={onRetryCrew} />
      </div>
    </div>
  );
}
