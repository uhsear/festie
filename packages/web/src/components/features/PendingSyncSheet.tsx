import React from 'react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import type { FailedSyncItem } from '@festie/shared/stores/uiStore';
import { timeAgo } from '@festie/shared/utils';
import { clearPersistedFailed, dismissFailed } from '@festie/shared/services';
import Sheet from '../ui/Sheet';

/**
 * Re-enqueue a single failed mutation through the global web offline queue and
 * kick a drain, then drop it from the failed list. Feature-detects
 * window.__festieQueue so it's a no-op if the bridge isn't mounted yet.
 */
function retryItem(item: FailedSyncItem): Promise<unknown> {
  const q = typeof window !== 'undefined' ? window.__festieQueue : undefined;
  let settled: Promise<unknown> = Promise.resolve();
  if (q?.queueMutation) {
    settled = Promise.resolve(
      q.queueMutation({
        type: 'api',
        url: item.url,
        method: item.method,
        body: item.body,
        clientId: item.clientId,
      }),
    )
      .then(() => q.processQueue?.())
      .catch(() => {
        /* a re-failure will re-add it to the list via processQueue */
      });
  }
  // Optimistically clear it (store and storage); if the retry fails again the queue re-reports it.
  dismissItem(item.clientId);
  return settled;
}

/** Drop a failed item from the list AND from storage, so a reload does not bring it back. */
function dismissItem(clientId: string): void {
  dismissFailed(clientId).catch((err) => console.warn('PendingSyncSheet: dismiss failed', err));
}

interface PendingSyncSheetProps {
  onClose: () => void;
}

/**
 * A bottom sheet (shared ui/Sheet) listing offline writes that couldn't sync (uiStore
 * failedSync). Each row offers Retry (re-enqueue + drain) and Dismiss; the
 * footer offers Retry all / Dismiss all. Opened from OfflineBanner's failed
 * state — this is the user-facing half of the "no silent drops" contract.
 */
export default function PendingSyncSheet({ onClose }: PendingSyncSheetProps) {
  const failedSync = useUIStore((state) => state.failedSync);
  const clearFailedSync = useUIStore((state) => state.clearFailedSync);

  // Rows are dismissed before a retry resolves, so hold the sheet open until
  // every retry settles; a re-failure then re-adds the rows instead of closing it.
  const [retrying, setRetrying] = React.useState(0);

  // If the list empties (e.g. user dismissed the last item), close the sheet.
  React.useEffect(() => {
    if (failedSync.length === 0 && retrying === 0) onClose();
  }, [failedSync.length, retrying, onClose]);

  const handleRetry = (items: FailedSyncItem[]) => {
    setRetrying((n) => n + 1);
    void Promise.all(items.map(retryItem)).finally(() => setRetrying((n) => n - 1));
  };

  // Snapshot before mutating the store as we iterate.
  const handleRetryAll = () => handleRetry([...failedSync]);

  if (failedSync.length === 0 && retrying === 0) return null;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`${failedSync.length} change${failedSync.length === 1 ? '' : 's'} couldn't sync`}
    >
      <ul className="divide-y divide-border-default">
        {failedSync.map((item) => (
          <li key={item.clientId} className="py-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary truncate">{item.label}</p>
              <p className="text-xs text-text-secondary mt-0.5">
                <span className="text-[var(--color-text-danger)]">{item.error}</span>
                <span className="mx-1">·</span>
                {timeAgo(item.at)}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => handleRetry([item])}
                className="text-xs font-bold px-3 rounded bg-accent-aqua/15 text-accent-aqua hover:bg-accent-aqua/25 min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
              >
                Retry
              </button>
              <button
                onClick={() => dismissItem(item.clientId)}
                className="text-xs font-medium px-3 rounded text-text-secondary hover:text-text-primary min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-default">
        <button
          onClick={() => {
            clearFailedSync();
            void clearPersistedFailed();
          }}
          className="text-xs font-medium px-3 min-h-11 rounded text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
        >
          Dismiss all
        </button>
        <button
          onClick={handleRetryAll}
          className="text-xs font-bold px-3 min-h-11 rounded bg-accent-aqua/15 text-accent-aqua hover:bg-accent-aqua/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
        >
          Retry all
        </button>
      </div>
    </Sheet>
  );
}
