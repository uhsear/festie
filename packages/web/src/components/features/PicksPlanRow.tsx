import { memo, useCallback } from 'react';
import { Bell, FileText, TriangleAlert } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival, usePickClear } from '@festie/shared/hooks';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { COPY, PRIORITY_OPTIONS } from '@festie/shared/constants';
import {
  formatTime,
  artistDisplayName,
  resolveStageColor,
  reminderLeadLabel,
  reminderLeadA11y,
} from '@festie/shared/utils';
import StageBadge from '../ui/StageBadge';
import PriorityIcon from '../ui/PriorityIcon';
import { useToast } from '../../lib/toastContext';
import { useUndoNotifier } from '../../lib/useUndoNotifier';
import { cn } from '@/lib/utils';

interface PicksPlanRowProps {
  set: FestivalSet;
  hasClash: boolean;
}

/**
 * One row on the web Picks page: the main button opens the set panel, with note,
 * reminder and clash markers under the name. A small priority control sits beside
 * it as a sibling (never a nested button). Tapping the active priority clears the
 * pick with an Undo toast.
 */
function PicksPlanRow({ set, hasClash }: PicksPlanRowProps) {
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const setDetailSet = useUIStore((s) => s.setDetailSet);
  const { getMyPick, getMyNote, getMyReminder, savePick } = usePicks();
  const { getStageColor: getStageColorRaw, getStageName } = useFestival();
  const { toast } = useToast();
  const clearPick = usePickClear(useUndoNotifier());

  const b2bSeparator = currentFestival?.b2bSeparator;
  const artist = artistDisplayName(set, b2bSeparator);
  const stageName = getStageName(set.stageId) || '';
  const stageColor = resolveStageColor(getStageColorRaw(set.stageId), 'var(--text-muted)');
  const time = set.startTime ? formatTime(set.startTime) : 'TBA';
  const current = getMyPick(set.id);
  const hasNote = !!getMyNote(set.id);
  const reminder = getMyReminder(set.id);
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
    (hasClash ? ', clash' : '');

  return (
    <div className="flex items-center gap-2 pl-4 pr-2 py-2 w-full bg-bg-card border border-border rounded-xl mb-2">
      <button
        type="button"
        className="flex flex-1 items-center gap-x-3 min-w-0 py-1 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 rounded-lg"
        aria-label={label}
        onClick={() => setDetailSet(set)}
      >
        <div className="text-xs text-text-muted min-w-[56px] font-semibold tabular-nums">{time}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold overflow-hidden text-ellipsis whitespace-nowrap">{artist}</div>
          {(hasNote || hasReminder || hasClash) && (
            <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
              {hasNote && (
                <span className="inline-flex items-center">
                  <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="sr-only">Has note</span>
                </span>
              )}
              {hasReminder && (
                <span className="inline-flex items-center gap-0.5 tabular-nums">
                  <Bell className="w-3.5 h-3.5" aria-hidden="true" />
                  {reminderLeadLabel(reminder)}
                  <span className="sr-only">Reminder {reminderLeadA11y(reminder)} before</span>
                </span>
              )}
              {hasClash && (
                <span className="inline-flex items-center gap-0.5 font-semibold text-[var(--color-text-danger)]">
                  <TriangleAlert className="w-3.5 h-3.5" aria-hidden="true" />
                  {COPY.clash.badge}
                </span>
              )}
            </div>
          )}
        </div>
        <StageBadge variant="pick" stageName={stageName} stageColor={stageColor} />
      </button>

      <div role="group" aria-label={`Priority for ${artist}`} className="flex items-center">
        {PRIORITY_OPTIONS.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={current === p.value}
            aria-label={p.label}
            onClick={() => onPriority(p.value)}
            className={cn(
              'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg cursor-pointer transition-colors',
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
