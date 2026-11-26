import { Footprints, MapPin } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import { COPY } from '@festie/shared/constants';
import {
  artistDisplayName,
  formatTime,
  fmtDurationMinutes,
  fmtZonedClock,
  resolveStageColor,
} from '@festie/shared/utils';
import type { MyDay, MyDayItem } from '@festie/shared/utils';
import type { FestivalSet } from '@festie/shared/types';
import StageBadge from '../ui/StageBadge';
import PriorityIcon from '../ui/PriorityIcon';
import ArtistName, { RowOpenButton } from './ArtistName';

interface MyDayListProps {
  myDay: MyDay;
  onOpenSet: (set: FestivalSet) => void;
  timeZone?: string;
  /** True when a day heading (h2) sits above the list, so section titles drop to h3. */
  underDayHeading?: boolean;
}

/** One-day itinerary: picks in time order by part of day, with gaps, walks and meet-ups. */
export default function MyDayList({ myDay, onOpenSet, timeZone, underDayHeading }: MyDayListProps) {
  const Heading = underDayHeading ? 'h3' : 'h2';
  const b2bSeparator = useFestivalStore((state) => state.currentFestival?.b2bSeparator);
  const { getStageName, getStageColor } = useFestival();
  const stageColor = (stageId: string) => resolveStageColor(getStageColor(stageId), 'var(--color-text-muted)');

  const renderSet = (item: Extract<MyDayItem, { kind: 'set' }>) => {
    const { set, walkFromPrev, clashLabel } = item;
    const name = artistDisplayName(set, b2bSeparator);
    const stageName = getStageName(set.stageId) || '';
    return (
      <div key={item.key}>
        {walkFromPrev && (
          <p className="flex items-center gap-1.5 px-1 py-1 text-xs text-text-muted">
            <Footprints className="w-4 h-4" aria-hidden="true" />
            {COPY.myDay.walk(walkFromPrev.minutes, getStageName(walkFromPrev.fromStageId) || '')}
          </p>
        )}
        <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 w-full min-h-[44px] text-left bg-bg-card border border-border rounded-lg mb-2 hover:bg-bg-card-hover">
          <RowOpenButton
            label={`${name}, ${formatTime(set.startTime)}${stageName ? `, ${stageName}` : ''}`}
            onClick={() => onOpenSet(set)}
          />
          <span className="text-xs text-text-muted font-semibold tabular-nums min-w-[100px]">
            {formatTime(set.startTime)}
            {set.endTime ? ` – ${formatTime(set.endTime)}` : ''}
          </span>
          <span className="flex-1 basis-40 text-sm font-bold min-w-[10rem] break-words">
            <ArtistName set={set} separator={b2bSeparator} />
          </span>
          <PriorityIcon priority={item.priority} className="w-4 h-4" />
          <StageBadge variant="pick" stageName={stageName} stageColor={stageColor(set.stageId)} />
          {clashLabel && (
            <span className="max-w-full truncate rounded-full bg-[var(--color-clash-tint)] px-2 py-0.5 text-xs font-semibold text-[var(--color-clash)]">
              {clashLabel}
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderItem = (item: MyDayItem) => {
    if (item.kind === 'set') return renderSet(item);
    if (item.kind === 'gap') {
      return (
        <p
          key={item.key}
          className="mb-2 rounded-lg border border-dashed border-border px-4 py-2 text-xs text-text-muted"
        >
          {COPY.myDay.free(fmtDurationMinutes(item.minutes))}
        </p>
      );
    }
    return (
      <div
        key={item.key}
        className="mb-2 flex items-center gap-x-3 rounded-lg border border-border px-4 py-3 text-sm"
      >
        <MapPin className="w-4 h-4 shrink-0 text-accent-aqua" aria-hidden="true" />
        <span className="flex-1 min-w-0">
          <span className="font-semibold">{COPY.myDay.meet(item.label)}</span>
          {item.location && <span className="text-text-muted"> · {item.location}</span>}
        </span>
        <span className="text-xs text-text-muted font-semibold tabular-nums">
          {fmtZonedClock(item.startMs, timeZone)}
        </span>
      </div>
    );
  };

  return (
    <div>
      {myDay.sections.map((section) => (
        <section key={section.part} aria-label={section.title} className="mb-4">
          <Heading className="mb-3 pb-2.5 border-b border-border text-sm font-medium text-text-secondary">
            {section.title}
          </Heading>
          {section.items.map(renderItem)}
        </section>
      ))}
      {myDay.unscheduled.length > 0 && (
        <section aria-label={COPY.myDay.unscheduled} className="mb-4">
          <Heading className="mb-3 pb-2.5 border-b border-border text-sm font-medium text-text-secondary">
            {COPY.myDay.unscheduled}
          </Heading>
          {myDay.unscheduled.map((set) => (
            <div
              key={set.id}
              className="relative flex items-center gap-x-3 px-4 py-3 w-full min-h-[44px] text-left bg-bg-card border border-border rounded-lg mb-2 hover:bg-bg-card-hover"
            >
              <RowOpenButton label={artistDisplayName(set, b2bSeparator)} onClick={() => onOpenSet(set)} />
              <span className="flex-1 text-sm font-bold min-w-0 break-words [overflow-wrap:anywhere] line-clamp-2">
                <ArtistName set={set} separator={b2bSeparator} />
              </span>
              <StageBadge variant="pick" stageName={getStageName(set.stageId) || ''} stageColor={stageColor(set.stageId)} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
