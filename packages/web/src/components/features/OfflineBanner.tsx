import React, { useState } from 'react';
import { CloudOff } from 'lucide-react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { cn } from '../../lib/utils';
import { useOfflineQueueContext } from '../../hooks/useOfflineQueueBridge';
import PendingSyncSheet from './PendingSyncSheet';

/**
 * Banner surfacing the offline-sync state. Three states, in priority order:
 *
 *  1. FAILED  — failedSync.length > 0: an amber (delivery.failed) bar "{n} change(s)
 *     couldn't sync" with a button that opens the PendingSyncSheet to retry or
 *     dismiss each one. Highest priority because dropped writes are the thing
 *     the user most needs to know about.
 *  2. OFFLINE — offlineMode: a slim, persistent status row (neutral ground, amber on the
 *     icon only) "Offline, showing your saved schedule", plus the pending count. It carries
 *     no action, so it cannot be dismissed and the state stays visible while it is true.
 *  3. SYNCING — online with pendingSync > 0: aqua "Syncing {n} change(s)…" with
 *     a Sync-now escape hatch.
 *
 * The banner is kept for actions: FAILED (Review) and SYNCING (Sync now) are full bars.
 * Neither is dismissible, so a silent drop can't slip by.
 */
export default function OfflineBanner() {
  const offlineMode = useUIStore((state) => state.offlineMode);
  const pendingSync = useUIStore((state) => state.pendingSync);
  const failedSync = useUIStore((state) => state.failedSync);
  const failedCount = failedSync.length;
  const queue = useOfflineQueueContext();

  const [sheetOpen, setSheetOpen] = useState(false);

  const handleFlush = () => {
    queue?.processQueue().catch(() => {});
  };

  // ── State resolution (FAILED > OFFLINE > SYNCING) ─────────────────
  const showFailed = failedCount > 0;
  const showOffline = offlineMode;
  const showSyncing = !offlineMode && pendingSync > 0;

  // The failed sheet can be open even when no other banner state is active.
  if (!showFailed && !showOffline && !showSyncing) {
    return sheetOpen ? <PendingSyncSheet onClose={() => setSheetOpen(false)} /> : null;
  }

  // FAILED takes the bar; offline/syncing render only when there's no failure.
  const isOfflineRow = showOffline && !showFailed;
  let tone: string;
  let message: string;
  if (showFailed) {
    tone = 'bg-delivery-failed border-b border-delivery-failed/60 text-[var(--text-on-light-accent)]';
    message = `${failedCount} change${failedCount === 1 ? '' : 's'} couldn't sync`;
  } else if (showOffline) {
    tone = 'bg-bg-secondary border-b border-border text-text-secondary';
    message = 'Offline, showing your saved schedule. Changes sync when you reconnect.';
  } else {
    tone = 'bg-accent-aqua/90 border-b border-accent-aqua/20 text-[var(--text-on-light-accent)]';
    message = `Syncing ${pendingSync} pending change${pendingSync === 1 ? '' : 's'}…`;
  }

  return (
    <>
      <div
        className={cn(
          'relative shrink-0 z-40 px-4 flex items-center justify-between gap-3',
          isOfflineRow ? 'py-1' : 'py-2 backdrop-blur-xl',
          tone,
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3 min-w-0">
          {isOfflineRow ? (
            <CloudOff className="w-4 h-4 text-accent-amber flex-shrink-0" aria-hidden="true" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-bg-primary animate-pulse flex-shrink-0" />
          )}
          <span className={cn('font-medium', isOfflineRow ? 'text-xs' : 'text-sm')}>{message}</span>
          {!showFailed && pendingSync > 0 && (
            <span
              className={cn(
                'ml-1 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0',
                isOfflineRow ? 'bg-text-secondary/10' : 'bg-bg-primary/20',
              )}
            >
              {pendingSync}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {showFailed && (
            <button
              onClick={() => setSheetOpen(true)}
              className="text-xs font-bold text-inherit px-2 py-1 rounded bg-bg-primary/10 hover:bg-bg-primary/20 min-h-[44px]"
            >
              Review
            </button>
          )}
          {!showFailed && showSyncing && (
            <button
              onClick={handleFlush}
              className="text-xs font-bold text-inherit px-2 py-1 rounded bg-bg-primary/10 hover:bg-bg-primary/20 min-h-[44px]"
            >
              Sync now
            </button>
          )}
        </div>
      </div>

      {sheetOpen && <PendingSyncSheet onClose={() => setSheetOpen(false)} />}
    </>
  );
}
