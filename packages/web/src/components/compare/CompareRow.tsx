import React, { memo } from 'react';
import { formatTime } from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { stageTextColor } from '../ui/StageBadge';
import CompareCell from './CompareCell';

interface ColumnProfile {
  id: string;
  isMe: boolean;
}

interface CompareRowProps {
  set: FestivalSet;
  mine: Priority | undefined;
  others: Array<{ profileId: string; priority: Priority }>;
  columns: ColumnProfile[];
  stageColor: string;
  stageName: string;
  isConsensus: boolean;
}

function pickFor(
  profileId: string,
  isMe: boolean,
  mine?: Priority,
  others?: Array<{ profileId: string; priority: Priority }>,
): Priority | undefined {
  if (isMe) return mine;
  return others?.find((o) => o.profileId === profileId)?.priority;
}

export default memo(function CompareRow({
  set,
  mine,
  others,
  columns,
  stageColor,
  stageName,
  isConsensus,
}: CompareRowProps) {
  const theme = useUIStore((s) => s.theme);
  const pickedCount = columns.filter((c) => pickFor(c.id, c.isMe, mine, others)).length;
  return (
    <tr className="border-t border-border">
      <th scope="row" className="sticky left-0 bg-bg-primary z-10 py-3 pr-3 align-top text-left pl-2.5">
        <div className="font-semibold text-text-primary truncate max-w-[180px]">{set.artist}</div>
        <div className="text-xs text-text-secondary">
          {formatTime(set.startTime)}
          {'–'}
          {formatTime(set.endTime)}
        </div>
        <div className="text-xs" style={{ color: stageTextColor(stageColor, theme) }}>
          {stageName}
        </div>
        {/* Overlap (aqua) once 2+ crew picked the set; a lone pick stays neutral. */}
        <div
          className={`mt-1 inline-block type-caption px-1.5 py-0.5 rounded font-semibold ${
            pickedCount >= 2 ? 'bg-accent-aqua/15 text-accent-aqua' : 'bg-[var(--color-overlay-2)] text-text-muted'
          }`}
          data-testid="compare-picked-count"
        >
          {pickedCount} of {columns.length} picked
          {isConsensus ? ' · everyone' : ''}
        </div>
      </th>
      {columns.map((c) => (
        <CompareCell key={c.id} priority={pickFor(c.id, c.isMe, mine, others)} />
      ))}
    </tr>
  );
});
