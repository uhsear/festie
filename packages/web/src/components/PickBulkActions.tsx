import { useMemo, useState } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useFestival, useBulkAddPicks } from '@festie/shared/hooks';
import type { Priority } from '@festie/shared/types';
import { PRIORITY_OPTIONS } from '@festie/shared/constants';
import { buildBulkPickGroups, BULK_SCOPE_LABEL } from '@festie/shared/utils';
import Button from './ui/Button';
import Badge from './ui/Badge';
import PriorityIcon from './ui/PriorityIcon';
import { useUndoNotifier } from '../lib/useUndoNotifier';
import { Layers, Sparkles, ChevronDown } from 'lucide-react';

// M2 bulk pick helpers (before-festival planning). Operates ENTIRELY on the
// cached festivalDataStore.sets / .stages + artist genres — no network reads —
// and applies a whole group in ONE coalesced write via the shared
// `useBulkAddPicks` hook (a single PUT, offline-native + queued).
//
// Groups span every festival day (same scope as mobile), and the result toast
// reports the true count and offers Undo:
//   • "Add all must-see on this stage"  (per stage)
//   • per-genre  (every set whose artists list that genre)
// The chosen priority defaults to must-see (the headline "must-see on a stage"
// ask) but can be switched to want/maybe before applying.

export default function PickBulkActions() {
  const sets = useFestivalStore((s) => s.sets);
  const stages = useFestivalStore((s) => s.stages);
  const { getStageName } = useFestival();
  const { busyKey, add } = useBulkAddPicks(useUndoNotifier());

  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState<Priority>('must');

  const { stages: stageGroups, genres: genreGroups } = useMemo(
    () => buildBulkPickGroups(sets, stages, getStageName),
    [sets, stages, getStageName],
  );

  const hasGroups = stageGroups.length > 0 || genreGroups.length > 0;
  if (!hasGroups) return null;

  return (
    <div className="mb-3 rounded-xl border border-border bg-bg-card">
      <button
        type="button"
        className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 rounded-xl"
        aria-expanded={open}
        aria-label={`Bulk add picks for all days, ${open ? 'collapse' : 'expand'}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles className="w-4 h-4 text-accent-aqua" aria-hidden="true" />
        <span className="text-sm font-semibold">{`Bulk add picks · ${BULK_SCOPE_LABEL}`}</span>
        <ChevronDown
          className={`w-4 h-4 ml-auto text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-border">
          {/* Priority selector — which bucket the bulk add lands in. */}
          <div className="flex items-center gap-2 mb-3" role="radiogroup" aria-label="Priority for bulk add">
            <span className="text-xs text-text-muted">Add as</span>
            {PRIORITY_OPTIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={priority === p.value}
                aria-label={p.label}
                onClick={() => setPriority(p.value)}
                className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-colors ${
                  priority === p.value
                    ? 'border-accent-aqua text-accent-aqua bg-bg-card-hover'
                    : 'border-border text-text-secondary hover:bg-bg-card-hover'
                }`}
              >
                <PriorityIcon priority={p.value} className="w-3 h-3" filled={priority === p.value} />
                {p.short}
              </button>
            ))}
          </div>

          {stageGroups.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-text-secondary">
                <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                By stage
              </div>
              <div className="flex flex-wrap gap-2">
                {stageGroups.map((g) => (
                  <Button
                    key={g.key}
                    variant="secondary"
                    size="sm"
                    type="button"
                    isLoading={busyKey === g.key}
                    disabled={!!busyKey}
                    onClick={() => add(g, priority)}
                    aria-label={`Add all ${g.setIds.length} sets on ${g.label}, all days`}
                  >
                    {g.label}
                    <Badge variant="outline">{g.setIds.length}</Badge>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {genreGroups.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-text-secondary">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                By genre
              </div>
              <div className="flex flex-wrap gap-2">
                {genreGroups.map((g) => (
                  <Button
                    key={g.key}
                    variant="secondary"
                    size="sm"
                    type="button"
                    isLoading={busyKey === g.key}
                    disabled={!!busyKey}
                    onClick={() => add(g, priority)}
                    aria-label={`Add all ${g.setIds.length} ${g.label} sets, all days`}
                  >
                    {g.label}
                    <Badge variant="outline">{g.setIds.length}</Badge>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
