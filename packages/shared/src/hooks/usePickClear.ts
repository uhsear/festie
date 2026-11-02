import { useCallback, useRef } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import { UNDO_WINDOW_MS } from '../utils/crewWrites';
import { mapErrorToUserMessage } from '../services/errors';
import type { UndoNotifier } from './useUndoableRemove';

/**
 * Clear a pick at once, with an Undo toast. The clear is sent immediately so the
 * pick leaves every surface (clash prompt, cards, grid, counts); Undo writes the
 * old priority and reminder back. Offline, both writes share the clear's
 * clientIds, so the queue collapses clear + undo to the restored value.
 */
export function usePickClear(notify: UndoNotifier): (setId: string, label: string) => void {
  // Held in a ref so callers need not memoise their notifier.
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  return useCallback((setId: string, label: string) => {
    const store = useFestivalStore.getState();
    const festivalId = store.currentFestivalId;
    const prevPriority = store.currentProfile?.picks?.[setId];
    const prevReminder = store.currentProfile?.reminders?.[setId];
    if (!festivalId || !prevPriority) return;

    const clearing = store
      .savePick({ festivalId, setId, priority: null })
      .then(() => true)
      .catch((err: unknown) => {
        notifyRef.current.error(mapErrorToUserMessage(err, "Couldn't clear your pick. Try again."));
        return false;
      });

    const onUndo = async () => {
      // Undo waits for the clear because the clear's reminder write comes second.
      if (!(await clearing)) return;
      const current = useFestivalStore.getState();
      if (current.currentFestivalId !== festivalId) return;
      try {
        await current.savePick({ festivalId, setId, priority: prevPriority });
        if (prevReminder != null) {
          await useFestivalStore.getState().saveReminder({ festivalId, setId, minutes: prevReminder });
        }
      } catch (err) {
        notifyRef.current.error(mapErrorToUserMessage(err, "Couldn't undo. Pick the set again."));
      }
    };

    notifyRef.current.undo(`Removed ${label}`, () => void onUndo(), UNDO_WINDOW_MS);
  }, []);
}
