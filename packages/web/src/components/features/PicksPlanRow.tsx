import { memo, useCallback } from 'react';
import { Bell, FileText, ArrowRightLeft } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useMyPick, useMyNote, useMyReminder, usePickActions, usePickClear, useSetMove } from '@festie/shared/hooks';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { COPY, PRIORITY_OPTIONS, clashMinutes } from '@festie/shared/constants';
import {
  formatSetTimeRange,
  artistDisplayName,
  resolveStageColor,
  reminderLeadLabel,
  reminderLeadA11y,
} from '@festie/shared/utils';
import StageBadge from '../ui/StageBadge';
import PriorityIcon from '../ui/PriorityIcon';
import ClashHatch from '../ui/ClashHatch';
import { useToast } from '../../lib/toastContext';
import { useUndoNotifier } from '../../hooks/useUndoNotifier';
import { cn } from '@/lib/utils';
import ArtistName, { RowOpenButton } from './ArtistName';

interface PicksPlanRowProps {
  set: FestivalSet;
  hasClash: boolean;
  /** Whole minutes this set overlaps another pick; absent for a tight change with no overlap. */
  clashMin?: number;
}

/**
 * One row on the web Picks page: the main button opens the set panel, with note,
 * reminder and clash markers under the name. A small priority control sits beside
 * it as a sibling (never a nested button). Tapping the active priority clears the
 * pick with an Undo toast.
 */
function PicksPlanRow({ set, hasClash, clashMin }: PicksPlanRowProps) {
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const setDetailSet = useUIStore((s) => s.setDetailSet);
  const current = useMyPick(set.id);
  const myNote = useMyNote(set.id);
  const reminder = useMyReminder(set.id);
  const { savePick } = usePickActions();
  // Not useFestival(): it subscribes to the whole profile, so every pick write would re-render each row.
  const stage = useFestivalStore((s) => s.stages.find((st) => st.id === set.stageId));
  const { toast } = useToast();
  const clearPick = usePickClear(useUndoNotifier());
  const move = useSetMove(set);

  const b2bSeparator = currentFestival?.b2bSeparator;
  const artist = artistDisplayName(set, b2bSeparator);
  const stageName = stage?.name || '';
  const stageColor = resolveStageColor(stage?.color, 'var(--text-muted)');
  const time = formatSetTimeRange(set) || 'TBA';
  const hasNote = !!myNote;
  const hasReminder = reminder != null;

  const onPriority = useCallback(
    async (value: Priority) => {
      if (current === value) {
        clearPick(set.id, artist);
        return;
      }
      if (!currentFestival) return;
      try {
        await savePick(currentFestival.id, set.id, value);
      } catch (err) {
        toast(mapErrorToUserMessage(err, "Couldn't save your pick. Try again."), 'error');
      }
    },
    [current, clearPick, set.id, artist, currentFestival, savePick, toast],
  );

  const label =
    `${artist}, ${time}, ${stageName}` +
    (hasNote ? ', has note' : '') +
    (hasReminder ? `, reminder ${reminderLeadA11y(reminder)} before` : '') +
    (hasClash ? ', clash' : '') +
    (move ? `, ${move.a11y}` : '');

  return (
    <div className="flex items-center gap-2 pl-4 pr-2 py-2 w-full bg-bg-card border border-border rounded-lg mb-2">
      {/* Phone: the name gets the full line, time and stage sit under it. sm+: time | name | stage in one row. */}
      <div className="relative flex flex-1 flex-col gap-y-1 min-w-0 py-1 text-left rounded-xl sm:flex-row sm:items-center sm:gap-x-3">
        <RowOpenButton label={label} onClick={() => setDetailSet(set)} />
        <div className="order-1 min-w-0 sm:order-2 sm:flex-1">
          <div className="text-sm font-bold break-words [overflow-wrap:anywhere] line-clamp-2">
            <ArtistName set={set} separator={b2bSeparator} />
          </div>
          {(hasNote || hasReminder || hasClash || !!move) && (
            <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
              {hasNote && (
                <span className="inline-flex items-center">
                  <FileText className="w-4 h-4" aria-hidden="true" />
                  <span className="sr-only">Has note</span>
                </span>
              )}
              {hasReminder && (
                <span className="inline-flex items-center gap-0.5 tabular-nums">
                  <Bell className="w-4 h-4" aria-hidden="true" />
                  {reminderLeadLabel(reminder)}
                  <span className="sr-only">Reminder {reminderLeadA11y(reminder)} before</span>
                </span>
              )}
              {hasClash && (
                <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-clash)]">
                  <ClashHatch className="h-4 w-1.5" />
                  {COPY.clash.badge}
                  {clashMin ? <span data-clash-minutes className="tabular-nums">{clashMinutes(clashMin)}</span> : null}
                </span>
              )}
              {move && (
                <span data-testid="set-moved-chip" aria-hidden="true" className="inline-flex items-center gap-0.5 font-semibold">
                  <ArrowRightLeft className="w-4 h-4" aria-hidden="true" />
                  {move.chip}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="order-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:contents">
          <div className="text-xs text-text-muted font-semibold tabular-nums whitespace-nowrap sm:order-1 sm:w-36 sm:shrink-0">{time}</div>
          <StageBadge variant="pick" stageName={stageName} stageColor={stageColor} className="sm:order-3 sm:max-w-40" />
        </div>
      </div>

      <div role="group" aria-label={`Priority for ${artist}`} className="flex items-center">
        {PRIORITY_OPTIONS.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={current === p.value}
            aria-label={p.label}
            onClick={() => onPriority(p.value)}
            className={cn(
              'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl cursor-pointer transition-colors',
              'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
              current === p.value ? 'text-accent-aqua' : 'text-text-muted hover:bg-bg-card-hover',
            )}
          >
            <PriorityIcon priority={p.value} className="w-4 h-4" filled={current === p.value} />
            <span className="sr-only">{p.short}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default memo(PicksPlanRow);
