import { useId, useState } from 'react';
import { Bell } from 'lucide-react';
import type { NoteSaveStatus } from '@festie/shared/hooks';
import { reminderNoteSummary } from '@festie/shared/utils';
import Button from '../ui/Button';
import DetailReminderPicker from './DetailReminderPicker';
import { NoteStatusLine } from './DetailNotesSection';

interface Props {
  myReminder: number | undefined;
  reminderBusy: number | null | 'clear';
  onReminderClick: (minutes: number | null) => Promise<void>;
  canRemind: boolean;
  personalNote: string;
  onPersonalChange: (value: string) => void;
  personalStatus?: NoteSaveStatus;
  onRetryPersonal?: () => void;
  /** Called when the panel opens or the note gains focus, so a half-height sheet can grow. */
  onExpand?: () => void;
}

export default function DetailReminderNotePanel({
  myReminder,
  reminderBusy,
  onReminderClick,
  canRemind,
  personalNote,
  onPersonalChange,
  personalStatus = 'idle',
  onRetryPersonal,
  onExpand,
}: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div>
      <Button
        variant="outline"
        type="button"
        fullWidth
        aria-expanded={open}
        aria-controls={panelId}
        icon={<Bell className="w-4 h-4" aria-hidden="true" />}
        onClick={() => {
          if (!open) onExpand?.();
          setOpen((o) => !o);
        }}
      >
        {reminderNoteSummary(myReminder, !!personalNote, canRemind)}
      </Button>
      {open && (
        <div id={panelId} className="mt-3 flex flex-col gap-4">
          {canRemind && (
            <DetailReminderPicker
              myReminder={myReminder}
              reminderBusy={reminderBusy}
              onReminderClick={onReminderClick}
            />
          )}
          <div>
            <label
              htmlFor={`${panelId}-note`}
              className="block text-xs font-bold text-text-secondary mb-2.5 uppercase tracking-[1px]"
            >
              Your note
            </label>
            <textarea
              id={`${panelId}-note`}
              placeholder='Private note, e.g. "meet at the rail"'
              className="w-full min-h-[80px] resize-y text-sm p-3 rounded-sm bg-bg-input border border-border-light text-text-primary"
              value={personalNote}
              onFocus={onExpand}
              onChange={(e) => onPersonalChange(e.target.value)}
            />
            <NoteStatusLine status={personalStatus} onRetry={onRetryPersonal} />
          </div>
        </div>
      )}
    </div>
  );
}
