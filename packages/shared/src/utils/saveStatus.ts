export type SaveStatusKind = 'failed' | 'offline' | 'saving' | 'syncing' | 'saved';

/**
 * The lineup header's save-state chip. The first matching state wins, so a
 * failure is never hidden behind "Saving…" or "Saved". Null renders nothing.
 */
export function saveStatus(i: {
  savesInFlight: number;
  failedPicks: number;
  failedSync: number;
  offline: boolean;
  pendingSync: number;
  lastSavedAt: number | null;
}): { kind: SaveStatusKind; label: string } | null {
  if (i.failedPicks + i.failedSync > 0) return { kind: 'failed', label: 'Not saved' };
  if (i.offline && i.pendingSync > 0) return { kind: 'offline', label: 'Offline, will sync' };
  if (i.savesInFlight > 0) return { kind: 'saving', label: 'Saving…' };
  if (i.pendingSync > 0) return { kind: 'syncing', label: 'Syncing…' };
  if (i.lastSavedAt !== null) return { kind: 'saved', label: 'Saved' };
  return null;
}
