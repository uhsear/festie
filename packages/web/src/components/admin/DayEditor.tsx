import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Artist } from '@festie/shared/types';
import SetEditor, { SetRow, Stage } from './SetEditor';

export interface Day {
  id: string;
  label: string;
  date: string;
  sets: SetRow[];
}

export interface DayEditorProps {
  day: Day;
  stages: Stage[];
  separator?: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onLabelChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onRemoveDay: () => void;
  onAddSet: () => void;
  onRemoveSet: (setId: string) => void;
  onSetField: (setId: string, field: string, value: string | null) => void;
  onSetArtists: (setId: string, artists: Artist[]) => void;
  /** Day-level messages. */
  issues?: string[];
  /** Set-level messages by `set:{id}`. */
  issueMap?: Map<string, string[]>;
  /** Fields the set issues name, by set id. */
  issueFields?: Map<string, string[]>;
  changedSetIds?: Set<string>;
  newSetIds?: Set<string>;
  selected?: Set<string>;
  onToggleSelect?: (setId: string) => void;
  onSelectAll?: (ids: string[], on: boolean) => void;
  /** Sets to render: day.sets after the filter and sort. */
  visibleSets?: SetRow[];
  filterQuery?: string;
}

/**
 * One day row with expand/collapse toggle and the sets list for that day.
 */
export default function DayEditor({
  day,
  stages,
  separator,
  isExpanded,
  onToggleExpand,
  onLabelChange,
  onDateChange,
  onRemoveDay,
  onAddSet,
  onRemoveSet,
  onSetField,
  onSetArtists,
  issues = [],
  issueMap,
  issueFields,
  changedSetIds,
  newSetIds,
  selected,
  onToggleSelect,
  onSelectAll,
  visibleSets,
  filterQuery = '',
}: DayEditorProps) {
  const setCount = (day.sets || []).length;
  const shown = visibleSets ?? day.sets ?? [];
  const allShownSelected = shown.length > 0 && shown.every((s) => selected?.has(s.id));

  return (
    <div className="rounded-lg bg-bg-primary/40 border border-glass-border">
      {/* Day header row */}
      <div className="flex gap-2 items-center p-3">
        <button
          type="button"
          onClick={onToggleExpand}
          className="inline-flex items-center justify-center rounded bg-bg-card text-text-secondary hover:text-text-primary transition-colors min-h-11 min-w-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
          aria-label={isExpanded ? 'Collapse day' : 'Expand day'}
          aria-expanded={isExpanded}
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
        <input
          type="text"
          placeholder="Day label"
          aria-label="Day label"
          value={day.label}
          onChange={(e) => onLabelChange(e.target.value)}
          className="flex-1 px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        />
        <input
          type="date"
          aria-label="Day date"
          value={day.date}
          onChange={(e) => onDateChange(e.target.value)}
          className="px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        />
        <span className="text-xs text-text-muted whitespace-nowrap">
          {setCount} {setCount === 1 ? 'artist' : 'artists'}
        </span>
        <button
          onClick={onRemoveDay}
          className="px-2 py-2 rounded-lg bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-sm"
        >
          Remove
        </button>
      </div>
      {issues.length > 0 && (
        <div className="px-3 pb-2 space-y-0.5">
          {issues.map((m, i) => (
            <p key={i} className="text-xs text-accent-coral">
              {m}
            </p>
          ))}
        </div>
      )}

      {/* Expanded: artists/sets list */}
      {isExpanded && (
        <div className="border-t border-glass-border p-3 space-y-2">
          {setCount === 0 ? (
            <p className="text-xs text-text-muted italic">
              No artists yet. Click "Add Artist" to add one, or use Import on the festival list.
            </p>
          ) : shown.length === 0 ? (
            <p className="text-xs text-text-muted italic">No sets match "{filterQuery.trim()}".</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[auto_1fr_140px_90px_90px_auto] gap-2 text-xs text-text-muted px-1">
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={allShownSelected}
                  onChange={(e) =>
                    onSelectAll?.(
                      shown.map((s) => s.id),
                      e.target.checked,
                    )
                  }
                />
                <div>Artist</div>
                <div>Stage</div>
                <div>Start</div>
                <div>End</div>
                <div></div>
              </div>
              {shown.map((s) => (
                <SetEditor
                  key={s.id}
                  selected={selected?.has(s.id) ?? false}
                  onToggleSelect={() => onToggleSelect?.(s.id)}
                  issues={issueMap?.get(`set:${s.id}`) ?? []}
                  issueFields={issueFields?.get(s.id) ?? []}
                  status={newSetIds?.has(s.id) ? 'new' : changedSetIds?.has(s.id) ? 'changed' : null}
                  set={s}
                  dayLabel={day.label}
                  stages={stages}
                  separator={separator}
                  onSetArtists={(artists) => onSetArtists(s.id, artists)}
                  onField={(field, value) => onSetField(s.id, field, value)}
                  onRemove={() => onRemoveSet(s.id)}
                />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={onAddSet}
            className="mt-2 px-3 py-1.5 rounded-lg bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
          >
            + Add Artist
          </button>
        </div>
      )}
    </div>
  );
}
