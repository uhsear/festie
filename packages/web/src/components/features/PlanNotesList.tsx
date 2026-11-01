import { Bell, StickyNote } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import { COPY } from '@festie/shared/constants';
import { artistDisplayName, formatTime, reminderLeadLabel } from '@festie/shared/utils';
import type { PlanListItem, PlanListKind } from '@festie/shared/utils';
import type { FestivalDay, FestivalSet } from '@festie/shared/types';
import EmptyState from '../ui/EmptyState';
import PriorityIcon from '../ui/PriorityIcon';

interface PlanNotesListProps {
  kind: PlanListKind;
  items: PlanListItem[];
  days: FestivalDay[];
  onOpenSet: (set: FestivalSet) => void;
}

/** Every set with a reminder, or every set with a note, grouped by day. */
export default function PlanNotesList({ kind, items, days, onOpenSet }: PlanNotesListProps) {
  const b2bSeparator = useFestivalStore((state) => state.currentFestival?.b2bSeparator);
  const { getStageName } = useFestival();

  if (items.length === 0) {
    const isReminders = kind === 'reminders';
    return (
      <EmptyState
        icon={isReminders ? <Bell className="w-9 h-9" aria-hidden="true" /> : <StickyNote className="w-9 h-9" aria-hidden="true" />}
        title={isReminders ? COPY.planLists.remindersEmptyTitle : COPY.planLists.notesEmptyTitle}
        description={isReminders ? COPY.planLists.remindersEmptyBody : COPY.planLists.notesEmptyBody}
      />
    );
  }

  // Items arrive in day order with unscheduled last, so consecutive grouping is enough.
  const groups: Array<{ id: string; heading: string; items: PlanListItem[] }> = [];
  for (const item of items) {
    const day = item.dayIndex == null ? undefined : days[item.dayIndex];
    const id = day ? String(item.dayIndex) : 'unscheduled';
    const last = groups[groups.length - 1];
    if (last && last.id === id) {
      last.items.push(item);
    } else {
      groups.push({ id, heading: day ? day.label || day.date : 'Unscheduled', items: [item] });
    }
  }

  return (
    <div>
      {groups.map((group) => (
        <section key={group.id} aria-label={group.heading} className="mb-4">
          <h3 className="mb-3 pb-2.5 border-b border-border text-sm font-medium text-text-secondary">
            {group.heading}
          </h3>
          {group.items.map((item) => {
            const { set } = item;
            const name = artistDisplayName(set, b2bSeparator);
            const stageName = getStageName(set.stageId) || '';
            const time = set.startTime ? formatTime(set.startTime) : 'TBA';
            return (
              <button
                key={set.id}
                type="button"
                className="flex flex-col gap-1 px-4 py-3 w-full min-h-[44px] text-left bg-bg-card border border-border rounded-xl mb-2 cursor-pointer hover:bg-bg-card-hover focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
                onClick={() => onOpenSet(set)}
              >
                <span className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-sm font-bold">{name}</span>
                  {item.priority && <PriorityIcon priority={item.priority} className="w-4 h-4" />}
                </span>
                <span className="text-xs text-text-muted tabular-nums">
                  {stageName ? `${time} · ${stageName}` : time}
                </span>
                {kind === 'reminders' && item.reminderMinutes != null && (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-accent-aqua">
                    <Bell className="w-3.5 h-3.5" aria-hidden="true" />
                    {reminderLeadLabel(item.reminderMinutes)}
                  </span>
                )}
                {kind === 'notes' && item.note && (
                  <span className="line-clamp-3 whitespace-pre-line text-sm text-text-secondary">{item.note}</span>
                )}
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
