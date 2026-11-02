import { useCallback, useRef, useState } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import { UNDO_WINDOW_MS } from '../utils/crewWrites';
import { mapErrorToUserMessage } from '../services/errors';
import { bulkAddMessage, type BulkPickGroup } from '../utils/picksPlan';
import type { Priority } from '../types/domain';
import type { UndoNotifier } from './useUndoableRemove';

/**
 * Bulk-add a stage or genre group at one priority. Reports the true count
 * ("Added 3 sets ... (9 already picked).") and offers Undo, which restores only
 * the picks this add changed.
 */
export function useBulkAddPicks(notify: UndoNotifier): {
  busyKey: string | null;
  add: (group: BulkPickGroup, priority: Priority) => Promise<'added' | 'none' | 'failed'>;
} {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // Sync guard: state alone would let two taps in one render both pass.
  const busyRef = useRef(false);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const add = useCallback(async (group: BulkPickGroup, priority: Priority): Promise<'added' | 'none' | 'failed'> => {
    if (busyRef.current || group.setIds.length === 0) return 'none';
    busyRef.current = true;
    setBusyKey(group.key);
    try {
      const store = useFestivalStore.getState();
      const before = { ...(store.currentProfile?.picks ?? {}) };
      const changed = await store.bulkSavePicks(group.setIds, priority);
      const message = bulkAddMessage({ changed, total: group.setIds.length, label: group.label, priority });
      if (changed === 0) {
        notifyRef.current.info(message);
        return 'none';
      }
      const after = useFestivalStore.getState().currentProfile?.picks ?? {};
      // shortcut: a pick changed by hand while the bulk PUT is in flight is also undone; switch to a store-returned diff if that is ever reported.
      const previous: Record<string, Priority | undefined> = {};
      for (const id of group.setIds) if (after[id] !== before[id]) previous[id] = before[id];
      const onUndo = async () => {
        try {
          await useFestivalStore.getState().restorePicks(previous);
          notifyRef.current.info('Undone. Your plan is back to how it was.');
        } catch (err) {
          notifyRef.current.error(mapErrorToUserMessage(err, "Couldn't undo. Try again."));
        }
      };
      notifyRef.current.undo(message, () => void onUndo(), UNDO_WINDOW_MS);
      return 'added';
    } catch (err) {
      notifyRef.current.error(mapErrorToUserMessage(err, "Couldn't add picks. Try again."));
      return 'failed';
    } finally {
      // The ref is only ever set true by the guard above, so no stale write is possible.
      // eslint-disable-next-line require-atomic-updates
      busyRef.current = false;
      setBusyKey(null);
    }
  }, []);

  return { busyKey, add };
}
