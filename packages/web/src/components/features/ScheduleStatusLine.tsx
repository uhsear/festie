import React, { useEffect, useState } from 'react';
import { Check, Loader2, CloudOff, AlertTriangle } from 'lucide-react';
import { useSaveStatus } from '@festie/shared/hooks';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestivalDataStore } from '@festie/shared/stores/festivalDataStore';
import { formatLastSynced, offlineReadyLabel } from '@festie/shared/utils';
import type { SaveStatusKind } from '@festie/shared/utils';
import { cn } from '../../lib/utils';

const ICON: Record<SaveStatusKind, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>> = {
  saved: Check,
  saving: Loader2,
  syncing: Loader2,
  offline: CloudOff,
  failed: AlertTriangle,
};

/**
 * One status line for the Lineup and Picks header: schedule freshness ("Updated 4m ago",
 * plus "Offline-ready" when offline) and the save state (Saving, Saved, Syncing, Offline, Not saved).
 * It keeps a fixed height, so nothing below shifts when "Saved" appears or clears.
 * Amber for offline and failed; coral stays reserved for danger and SOS.
 */
export default function ScheduleStatusLine({ showFreshness }: { showFreshness: boolean }) {
  const status = useSaveStatus();
  const offlineMode = useUIStore((s) => s.offlineMode);
  const cachedAt = useFestivalDataStore((s) => s._festivalCachedAt);

  // Re-render on a 30s tick so "Updated N ago" keeps advancing from the device clock, offline too.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!showFreshness || cachedAt == null) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [showFreshness, cachedAt]);

  const updated = showFreshness ? formatLastSynced(cachedAt) : null;
  const offlineReady = offlineMode && offlineReadyLabel(cachedAt) === 'offline-ready';
  const Icon = status ? ICON[status.kind] : null;
  const spins = status?.kind === 'saving' || status?.kind === 'syncing';
  const amber = status?.kind === 'offline' || status?.kind === 'failed';

  return (
    <span
      data-testid="schedule-status-line"
      className="ml-auto inline-flex h-6 shrink-0 items-center gap-2 whitespace-nowrap text-xs font-medium tabular-nums text-text-muted"
    >
      {updated && (
        <span data-testid="last-synced-badge" className={cn(offlineReady && 'text-accent-amber')}>
          {updated}
          {offlineReady ? ' · Offline-ready' : ''}
        </span>
      )}
      {/* Live region on the save state only; "Updated N ago" changes every minute and must not be announced. */}
      <span role="status" aria-live="polite" className="inline-flex items-center">
        {status && Icon && (
          <span data-testid="save-status-chip" className={cn('inline-flex items-center gap-1', amber && 'text-accent-amber')}>
            <Icon className={cn('w-3 h-3', spins && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
            {status.label}
          </span>
        )}
      </span>
    </span>
  );
}
