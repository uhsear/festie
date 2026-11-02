import { setEngagementLabel, startsAfterMidnight } from '@festie/shared/utils';

export interface SetRow {
  id: string;
  artist?: string;
  stageId?: string;
  startTime?: string | null;
  endTime?: string | null;
  artists?: Array<{ name: string; id?: string }>;
  [key: string]: unknown;
}

export interface Stage {
  id: string;
  name: string;
  color: string;
}

export interface SetEditorProps {
  set: SetRow;
  dayLabel?: string;
  stages: Stage[];
  /** Picks and reminders for this set; absent when it has neither. */
  engagement?: { picks: number; reminders: number };
  /** True once engagement has loaded for the festival. */
  showEngagement?: boolean;
  onField: (field: string, value: string | null) => void;
  onRemove: () => void;
}

/**
 * Edits one set row (artist, stage, startTime, endTime) inside a day.
 */
const FIELD_LABEL = 'flex flex-col gap-1 min-w-0';
const FIELD_CAPTION = 'text-xs text-text-muted md:sr-only';

export default function SetEditor({
  set: s,
  dayLabel,
  stages,
  engagement,
  showEngagement,
  onField,
  onRemove,
}: SetEditorProps) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg border border-glass-border p-3 md:grid-cols-[1fr_140px_90px_90px_auto] md:rounded-none md:border-0 md:p-0">
      <label className={`${FIELD_LABEL} col-span-2 md:col-span-1`}>
        <span className={FIELD_CAPTION}>Artist</span>
        <input
          type="text"
          placeholder="Artist name"
          aria-label="Artist name"
          value={s.artist || ''}
          onChange={(e) => onField('artist', e.target.value)}
          className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent-aqua"
        />
      </label>
      <label className={`${FIELD_LABEL} col-span-2 md:col-span-1`}>
        <span className={FIELD_CAPTION}>Stage</span>
        <select
          value={s.stageId || ''}
          aria-label="Stage"
          onChange={(e) => onField('stageId', e.target.value)}
          className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
        >
          <option value="">— Stage —</option>
          {stages.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name || st.id}
            </option>
          ))}
        </select>
      </label>
      <label className={FIELD_LABEL}>
        <span className={FIELD_CAPTION}>Start</span>
        <input
          type="time"
          aria-label="Start time"
          value={s.startTime && s.startTime !== 'TBA' ? s.startTime : ''}
          onChange={(e) => onField('startTime', e.target.value || 'TBA')}
          className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
        />
      </label>
      <label className={FIELD_LABEL}>
        <span className={FIELD_CAPTION}>End</span>
        <input
          type="time"
          aria-label="End time"
          value={s.endTime && s.endTime !== 'TBA' ? s.endTime : ''}
          onChange={(e) => onField('endTime', e.target.value || null)}
          className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
        />
      </label>
      <button
        type="button"
        onClick={onRemove}
        className="col-span-2 md:col-span-1 px-2 py-1.5 md:py-0 rounded bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
        aria-label={`Remove ${s.artist || 'artist'}`}
      >
        <span className="md:hidden">Remove set</span>
        <span className="hidden md:inline">×</span>
      </button>
      {startsAfterMidnight(s.startTime) && (
        <p className="col-span-full text-xs text-text-muted">
          After midnight. Shows as part of {dayLabel || "this day's"} night.
        </p>
      )}
      {showEngagement && (
        <p className="col-span-2 md:col-span-5 text-xs text-text-muted">
          {setEngagementLabel(engagement ?? { picks: 0, reminders: 0 })}
        </p>
      )}
    </div>
  );
}
