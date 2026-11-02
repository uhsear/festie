import { useState } from 'react';
import { artistNamesOf, joinArtistNames, startsAfterMidnight, withArtistNames } from '@festie/shared/utils';
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
  onField: (field: string, value: string | null) => void;
  onRemove: () => void;
}

/**
 * Edits one set row (artists, stage, startTime, endTime) inside a day.
 * A B2B set holds up to 4 artists; each keeps its own links and photo by index.
 */
export default function SetEditor({
  set: s,
  dayLabel,
  stages,
  separator,
  onSetArtists,
  onField,
  onRemove,
}: SetEditorProps) {
  const [drafts, setDrafts] = useState<string[]>(() => artistNamesOf(s));
  const [origin, setOrigin] = useState<Artist[] | undefined>(() => s.artists);

  const changeDrafts = (next: string[], nextOrigin = origin) => {
    setDrafts(next);
    setOrigin(nextOrigin);
    onSetArtists(withArtistNames(nextOrigin, next));
  };

  return (
    <div className="grid grid-cols-[1fr_140px_90px_90px_auto] gap-2">
      <div className="space-y-1">
        {drafts.map((name, i) => {
          const label = i === 0 ? 'Artist' : `B2B artist ${i + 1}`;
          return (
            <div key={i} className="flex gap-1">
              <input
                type="text"
                placeholder={i === 0 ? 'Artist name' : label}
                aria-label={label}
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
      <input
        type="time"
        aria-label="Start time"
        value={s.startTime && s.startTime !== 'TBA' ? s.startTime : ''}
        onChange={(e) => onField('startTime', e.target.value || 'TBA')}
        className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
      />
      <input
        type="time"
        aria-label="End time"
        value={s.endTime && s.endTime !== 'TBA' ? s.endTime : ''}
        onChange={(e) => onField('endTime', e.target.value || null)}
        className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
      />
      <button
        type="button"
        onClick={onRemove}
        className="px-2 rounded bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
        aria-label={`Remove ${joinArtistNames(drafts, separator) || 'artist'}`}
      >
        ×
      </button>
      {startsAfterMidnight(s.startTime) && (
        <p className="col-span-full text-xs text-text-muted">
          After midnight. Shows as part of {dayLabel || "this day's"} night.
        </p>
      )}
    </div>
  );
}
