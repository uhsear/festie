import React from 'react';
import { CloudOff, AlertTriangle } from 'lucide-react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { FAILED_ROW_LABEL, PENDING_ROW_LABEL, rowSyncState } from '@festie/shared/utils';

/**
 * Row marker for a crew write that has not reached the server. A queued row
 * reads "Not sent yet"; a failed replay points at the PendingSyncSheet, which
 * the coral offline banner opens. Renders nothing for a synced row.
 */
export default function SyncMarker({ item }: { item: { id: string; _optimistic?: boolean } }) {
  const failedIds = useUIStore((s) => s.failedSync).map((f) => f.clientId);
  const state = rowSyncState(item, failedIds);
  if (!state) return null;
  return state === 'failed' ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-amber">
      <AlertTriangle className="w-3 h-3" aria-hidden="true" />
      {FAILED_ROW_LABEL}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary">
      <CloudOff className="w-3 h-3" aria-hidden="true" />
      {PENDING_ROW_LABEL}
    </span>
  );
}
