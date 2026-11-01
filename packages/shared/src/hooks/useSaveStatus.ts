import { useMemo } from 'react';
import { useFestivalDataStore } from '../stores/festivalDataStore';
import { useUIStore } from '../stores/uiStore';
import { saveStatus, type SaveStatusKind } from '../utils/saveStatus';

/** The lineup header's save-state chip, from profile writes and the offline queue. */
export function useSaveStatus(): { kind: SaveStatusKind; label: string } | null {
  const savesInFlight = useFestivalDataStore((s) => s.savesInFlight);
  const failedPicks = useFestivalDataStore(
    (s) => Object.values(s.pickSync).filter((entry) => entry.state === 'failed').length,
  );
  const lastSavedAt = useFestivalDataStore((s) => s.lastSavedAt);
  const offline = useUIStore((s) => s.offlineMode);
  const pendingSync = useUIStore((s) => s.pendingSync);
  const failedSync = useUIStore((s) => s.failedSync.length);

  return useMemo(
    () => saveStatus({ savesInFlight, failedPicks, failedSync, offline, pendingSync, lastSavedAt }),
    [savesInFlight, failedPicks, failedSync, offline, pendingSync, lastSavedAt],
  );
}
