import React from 'react';
import Button from '../ui/Button';

interface Props {
  count: number;
  actionLabel: string;
  onAction: () => void;
  onClear: () => void;
  busy?: boolean;
  note?: string;
}

/** Sticky bottom bar for bulk actions on the Users and Festivals lists. */
export default function SelectionBar({ count, actionLabel, onAction, onClear, busy = false, note }: Props) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Selection"
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-glass-border bg-bg-card/95 px-4 py-2 backdrop-blur-xl"
    >
      <div className="flex-1">
        <div className="text-sm text-text-primary">{count} selected</div>
        {note && <div className="text-xs text-text-muted">{note}</div>}
      </div>
      <Button type="button" variant="danger" isLoading={busy} disabled={busy} onClick={onAction} className="min-h-11">
        {actionLabel}
      </Button>
      <Button type="button" variant="secondary" disabled={busy} onClick={onClear} className="min-h-11">
        Clear
      </Button>
    </div>
  );
}
