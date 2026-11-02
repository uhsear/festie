import { useState } from 'react';
import {
  artistNamesOf,
  joinArtistNames,
  setEngagementLabel,
  startsAfterMidnight,
  withArtistNames,
} from '@festie/shared/utils';
import type { Artist } from '@festie/shared/types';

const MAX_ARTISTS_PER_SET = 4;

export interface SetRow {
  id: string;
  artist?: string;
  stageId?: string;
  startTime?: string | null;
  endTime?: string | null;
  artists?: Artist[];
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
  separator?: string;
  onSetArtists: (artists: Artist[]) => void;
  /** Picks and reminders for this set; absent when it has neither. */
  engagement?: { picks: number; reminders: number };
  /** True once engagement has loaded for the festival. */
  showEngagement?: boolean;
  onField: (field: string, value: string | null) => void;
  onRemove: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  issues?: string[];
  /** Fields (target.field) the issues name, so the matching input gets aria-invalid. */
  issueFields?: string[];
  status?: 'new' | 'changed' | null;
}

/**
 * Edits one set row (artists, stage, startTime, endTime) inside a day.
 * A B2B set holds up to 4 artists; each keeps its own links and photo by index.
 */
const FIELD_LABEL = 'flex flex-col gap-1 min-w-0';
const FIELD_CAPTION = 'text-xs text-text-muted md:sr-only';

export default function SetEditor({
  set: s,
  dayLabel,
  stages,
  separator,
  onSetArtists,
  engagement,
  showEngagement,
  onField,
  onRemove,
  selected = false,
  onToggleSelect,
  issues = [],
  issueFields = [],
  status = null,
}: SetEditorProps) {
  const invalid = (field: string) => (issueFields.includes(field) ? true : undefined);
  const [drafts, setDrafts] = useState<string[]>(() => artistNamesOf(s));
  const [origin, setOrigin] = useState<Artist[] | undefined>(() => s.artists);

  const changeDrafts = (next: string[], nextOrigin = origin) => {
    setDrafts(next);
    setOrigin(nextOrigin);
    onSetArtists(withArtistNames(nextOrigin, next));
  };

  return (
    <div
      data-issue-key={`set:${s.id}`}
      data-issue={issues.length > 0 ? 'true' : undefined}
      className={`grid grid-cols-2 gap-2 rounded-lg border border-glass-border p-3 md:grid-cols-[auto_1fr_140px_90px_90px_auto] md:rounded-none md:border-0 md:p-0 ${
        status ? 'border-l-2 border-l-accent-aqua md:pl-2' : ''
      } ${issues.length > 0 ? 'ring-1 ring-accent-coral md:p-1' : ''}`}
    >
      <div className="col-span-2 flex items-center gap-2 md:col-span-1 md:flex-col md:gap-1 md:pt-1.5">
        <input
          type="checkbox"
          aria-label={`Select ${s.artist || 'set'}`}
          checked={selected}
          onChange={() => onToggleSelect?.()}
        />
        {status && <span className="text-xs text-accent-aqua">{status === 'new' ? 'New' : 'Changed'}</span>}
      </div>
      <div className={`${FIELD_LABEL} col-span-2 md:col-span-1`}>
        <span className={FIELD_CAPTION}>Artist</span>
        <div className="space-y-1">
          {drafts.map((name, i) => {
            const label = i === 0 ? 'Artist' : `B2B artist ${i + 1}`;
            return (
              <div key={i} className="flex gap-1">
                <input
                  type="text"
                  placeholder={i === 0 ? 'Artist name' : label}
                  aria-label={label}
                  aria-invalid={i === 0 ? invalid('artist') : undefined}
                  value={name}
                  onChange={(e) => changeDrafts(drafts.map((d, j) => (j === i ? e.target.value : d)))}
                  className="flex-1 min-w-0 px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent-aqua"
                />
                {i > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      changeDrafts(
                        drafts.filter((_, j) => j !== i),
                        origin?.filter((_, j) => j !== i),
                      )
                    }
                    className="px-2 rounded bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
                    aria-label={`Remove ${name.trim() || 'artist'}`}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          {drafts.length < MAX_ARTISTS_PER_SET && (
            <button
              type="button"
              onClick={() => changeDrafts([...drafts, ''])}
              className="text-xs text-accent-aqua hover:underline"
            >
              + B2B artist
            </button>
          )}
        </div>
      </div>
      <label className={`${FIELD_LABEL} col-span-2 md:col-span-1`}>
        <span className={FIELD_CAPTION}>Stage</span>
        <select
          value={s.stageId || ''}
          aria-label="Stage"
          aria-invalid={invalid('stageId')}
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
          aria-invalid={invalid('startTime')}
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
          aria-invalid={invalid('endTime')}
          value={s.endTime && s.endTime !== 'TBA' ? s.endTime : ''}
          onChange={(e) => onField('endTime', e.target.value || null)}
          className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
        />
      </label>
      <button
        type="button"
        onClick={onRemove}
        className="col-span-2 md:col-span-1 px-2 py-1.5 md:py-0 rounded bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
        aria-label={`Remove ${joinArtistNames(drafts, separator) || 'artist'}`}
      >
        <span className="md:hidden">Remove set</span>
        <span className="hidden md:inline">×</span>
      </button>
      {issues.length > 0 && (
        <div className="col-span-full space-y-0.5">
          {issues.map((m, i) => (
            <p key={i} className="text-xs text-accent-coral">
              {m}
            </p>
          ))}
        </div>
      )}
      {startsAfterMidnight(s.startTime) && (
        <p className="col-span-full text-xs text-text-muted">
          After midnight. Shows as part of {dayLabel || "this day's"} night.
        </p>
      )}
      {showEngagement && (
        <p className="col-span-full text-xs text-text-muted">
          {setEngagementLabel(engagement ?? { picks: 0, reminders: 0 })}
        </p>
      )}
    </div>
  );
}
