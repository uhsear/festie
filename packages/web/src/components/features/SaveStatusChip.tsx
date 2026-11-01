import React from 'react';
import { Check, Loader2, CloudOff, AlertTriangle } from 'lucide-react';
import { useSaveStatus } from '@festie/shared/hooks';
import type { SaveStatusKind } from '@festie/shared/utils';
import { cn } from '../../lib/utils';

const ICON: Record<SaveStatusKind, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>> = {
  saved: Check,
  saving: Loader2,
  syncing: Loader2,
  offline: CloudOff,
  failed: AlertTriangle,
};

/** Lineup header save state. Amber for offline and failed; coral stays reserved for danger and SOS. */
export default function SaveStatusChip() {
  const status = useSaveStatus();
  if (!status) return null;
  const Icon = ICON[status.kind];
  const spins = status.kind === 'saving' || status.kind === 'syncing';
  const amber = status.kind === 'offline' || status.kind === 'failed';
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="save-status-chip"
      className={cn(
        'ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium',
        amber ? 'text-accent-amber' : 'text-text-muted',
      )}
    >
      <Icon className={cn('w-3 h-3', spins && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
      {status.label}
    </span>
  );
}
