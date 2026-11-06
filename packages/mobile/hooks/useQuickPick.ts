import { useCallback } from 'react';
import { useFestivalDataStore, useFestivalStore, useUIStore } from '@festie/shared/stores';
import { usePicks, usePickClear } from '@festie/shared/hooks';
import { COPY } from '@festie/shared/constants';
import { mapErrorToUserMessage } from '@festie/shared/services';
import { artistDisplayName, nextPickInCycle } from '@festie/shared/utils';
import type { Priority } from '@festie/shared/types';
import { useHaptics } from './useHaptics';
import { QUICK_PICK_ACTIONS, priorityForAction } from '../lib/quickPick';
import { undoNotifier } from '../lib/undoNotifier';

const HOLD_DELAY_MS = 350;

/** Hold-to-pick for schedule blocks: setPick saves, holdToPick returns the gesture props. */
export function useQuickPick() {
  const haptics = useHaptics();
  const { savePick } = usePicks();
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const clearPick = usePickClear(undoNotifier);

  const setPick = useCallback(
    (setId: string, priority: Priority | null) => {
      if (!currentFestival) return;
      // Clearing offers Undo, like the Schedule cards.
      if (priority === null) {
        const found = useFestivalStore.getState().sets.find((s) => s.id === setId);
        clearPick(setId, found ? artistDisplayName(found, currentFestival.b2bSeparator) : 'pick');
        return;
      }
      // savePick rolls back and records the error in the store (rollbackKeys); blocks have no Retry chip, so say so.
      savePick(currentFestival.id, setId, priority).catch((err) => {
        haptics.warning();
        useUIStore
          .getState()
          .showToast(mapErrorToUserMessage(err, "Couldn't save your pick. Try again."), { kind: 'error' });
      });
    },
    [currentFestival, savePick, clearPick, haptics],
  );

  const holdToPick = useCallback(
    (setId: string, current: Priority | null | undefined) => ({
      onLongPress: () => {
        haptics.select();
        setPick(setId, nextPickInCycle(current));
      },
      delayLongPress: HOLD_DELAY_MS,
      accessibilityActions: QUICK_PICK_ACTIONS.map((a) => ({ ...a })),
      onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
        const next = priorityForAction(e.nativeEvent.actionName);
        if (next !== undefined) setPick(setId, next);
      },
      accessibilityHint: COPY.grid.holdHint,
    }),
    [haptics, setPick],
  );

  return { setPick, holdToPick };
}
