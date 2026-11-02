import React, { memo } from 'react';
import { Link } from '@tanstack/react-router';
import { artistDisplayName, formatTime } from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { stageTextColor } from '../ui/StageBadge';
import CompareCell from './CompareCell';

interface ColumnProfile {
  /** Profile id; keys `picks`. */
  id: string;
  isMe: boolean;
}

interface CompareRowProps {
  set: FestivalSet;
  mine: Priority | undefined;
  /** Every column's pick, keyed by profile id. */
  picks: Record<string, Priority | undefined>;
  topPriority: Priority;
  columns: ColumnProfile[];
  stageColor: string;
  stageName: string;
  isConsensus: boolean;
  b2bSeparator?: string;
  onAdd?: (setId: string, priority: Priority) => void;
}

export default memo(function CompareRow({
  set,
  mine,
  picks,
  topPriority,
  columns,
  stageColor,
  stageName,
  isConsensus,
  b2bSeparator,
  onAdd,
}: CompareRowProps) {
  const theme = useUIStore((s) => s.theme);
  const pickedCount = columns.filter((c) => picks[c.id]).length;
  const artist = artistDisplayName(set, b2bSeparator);
  return (
    <tr className="border-t border-border">
      <th scope="row" className="sticky left-0 bg-bg-primary z-10 py-3 pr-3 align-top text-left pl-2.5">
        <Link to="/set/$setId" params={{ setId: set.id }} aria-label={`Open ${artist}`} className="block">
          <div className="font-semibold text-text-primary truncate max-w-[180px]">{artist}</div>
          <div className="text-xs text-text-secondary">
            {formatTime(set.startTime)}
            {'–'}
            {formatTime(set.endTime)}
          </div>
        </Link>
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
        <CompareCell
          key={c.id}
          priority={picks[c.id]}
          onAdd={c.isMe && !mine && onAdd ? () => onAdd(set.id, topPriority) : undefined}
          label={`Add ${artist} to my picks`}
        />
      ))}
    </tr>
  );
});
